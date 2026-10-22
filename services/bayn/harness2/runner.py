"""Run upstream Harness2 against Bayn's native typed Jev decisions."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import re
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from harness2.core.proposer import Proposer, ProposerError, Reply
from harness2.core.schedule import run_domain
from harness2.core.spec import BenchPrompts, BenchSpec, ChannelSpec
from harness2.core.tree import SurfaceSpec

UPSTREAM_REVISION = "1cfe254e8d25b15f37048c3730134686abe60335"
MAX_BYTES = 16 * 1024 * 1024


def encode(value):
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), allow_nan=False, ensure_ascii=False
    ).encode()


def identity(value):
    return hashlib.sha256(encode(value)).hexdigest()


def instant(seconds):
    return (
        datetime.fromtimestamp(seconds, timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def read_json(path):
    raw = path.read_bytes()
    if len(raw) > MAX_BYTES:
        raise ValueError("Study input exceeds 16 MiB")
    return json.loads(raw)


def validate_study(value):
    if (
        not isinstance(value, dict)
        or set(value)
        != {
            "schemaVersion",
            "sourceRevision",
            "maximumCalls",
            "maximumWallSeconds",
            "baseline",
            "editor",
            "tasks",
            "validation",
        }
        or value["schemaVersion"] != "bayn.jev-harness2-study.v1"
    ):
        raise ValueError(
            "Malformed Jev Harness2 study; factor-selection studies are removed"
        )
    if not re.fullmatch(r"[0-9a-f]{40}", value["sourceRevision"]):
        raise ValueError("A study requires its exact deployed source revision")
    for name, lower, upper in (
        ("maximumCalls", 8, 512),
        ("maximumWallSeconds", 60, 3600),
    ):
        if type(value[name]) is not int or not lower <= value[name] <= upper:
            raise ValueError(f"{name} is outside its supported bound")
    validate_instructions(value["baseline"])
    if not isinstance(value["editor"], dict) or set(value["editor"]) != {
        "policy",
        "costBasis",
    }:
        raise ValueError("A study requires a frozen editor policy and cost basis")
    if not 1 <= len(value["tasks"]) <= 4 or not 1 <= len(value["validation"]) <= 32:
        raise ValueError(
            "A study requires development and untouched validation observations"
        )
    seen, cutoffs = set(), []
    for group in (value["tasks"], value["validation"]):
        times = []
        for task in group:
            if not isinstance(task, dict) or set(task) != {"id", "observation"}:
                raise ValueError("Tasks require original native Bayn observations")
            if (
                not re.fullmatch(r"[a-z][a-z0-9-]{0,63}", task["id"])
                or task["id"] in seen
            ):
                raise ValueError("Invalid or duplicate task ID")
            seen.add(task["id"])
            observation = task["observation"]
            if observation.get("schemaVersion") != "bayn.jev-observation.v1":
                raise ValueError("Only native Jev observations can be probed")
            times.append(observation["observedAt"])
        if times != sorted(times) or len(set(times)) != len(times):
            raise ValueError("Observations must have unique chronological cutoffs")
        cutoffs.append(times)
    last = datetime.fromisoformat(cutoffs[0][-1].replace("Z", "+00:00")).timestamp()
    first = datetime.fromisoformat(cutoffs[1][0].replace("Z", "+00:00")).timestamp()
    horizon = max(
        task["observation"]["protocol"]["maximumHoldingMinutes"]
        for task in value["tasks"]
    )
    if type(horizon) is not int or not 1 <= horizon <= 60:
        raise ValueError(
            "Development observations require their native holding horizon"
        )
    if first < last + horizon * 60:
        raise ValueError(
            "Validation must follow development by the full native holding horizon"
        )
    if len(encode(value)) > MAX_BYTES:
        raise ValueError("Study input exceeds 16 MiB")
    return value


def validate_instructions(value):
    if not isinstance(value, dict) or set(value) != {"entry"}:
        raise ValueError(
            "Only the native Jev complete-plan question instruction is editable"
        )
    if any(
        not isinstance(text, str) or not 1 <= len(text.strip()) <= 2000
        for text in value.values()
    ):
        raise ValueError(
            "Jev question instructions must contain one to 2000 characters"
        )
    return value


class Storage:
    def __init__(self, bucket, endpoint, study_id):
        self.bucket = bucket
        self.prefix = f"harness2/jev-v1/{study_id}/"
        self.client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            config=Config(
                connect_timeout=5, read_timeout=10, retries={"total_max_attempts": 1}
            ),
        )

    def read(self, key):
        try:
            response = self.client.get_object(Bucket=self.bucket, Key=self.prefix + key)
        except ClientError as error:
            if error.response["Error"]["Code"] in ("NoSuchKey", "404"):
                return None
            raise RuntimeError("Harness2 storage read failed") from None
        with response["Body"] as body:
            raw = body.read(64 * 1024 * 1024 + 1)
        if len(raw) > 64 * 1024 * 1024:
            raise ValueError("Retained Harness2 object exceeds 64 MiB")
        return json.loads(raw)

    def create(self, key, value):
        try:
            self.client.put_object(
                Bucket=self.bucket,
                Key=self.prefix + key,
                Body=encode(value),
                ContentType="application/json",
                IfNoneMatch="*",
            )
            return True
        except ClientError as error:
            if error.response["Error"]["Code"] in (
                "PreconditionFailed",
                "412",
                "ConditionalRequestConflict",
                "409",
            ):
                return False
            raise RuntimeError("Harness2 storage write failed") from None


def retain(storage, key, value):
    if not storage.create(key, value) and storage.read(key) != value:
        raise ValueError("Retained Harness2 evidence conflicts")


def cli(kind, args, timeout):
    completed = subprocess.run(
        ["bayn-research" if kind == "editor" else "bayn-harness2-probe", *args],
        capture_output=True,
        timeout=timeout,
        check=False,
    )
    path = Path(args[1])
    path.with_suffix(".stdout.txt").write_bytes(completed.stdout)
    path.with_suffix(".stderr.txt").write_bytes(completed.stderr)
    if completed.returncode:
        raise RuntimeError(
            "Bayn research command failed; inspect the private retained attempt"
        )


class Calls:
    def __init__(self, study, root, storage, invoke=cli, clock=time.time):
        self.study, self.root, self.storage = study, root, storage
        self.invoke, self.clock = invoke, clock
        self.lock = threading.Lock()
        self.origin = storage.read("registration.json")
        if self.origin is None:
            storage.create("registration.json", {"study": study, "startedAt": clock()})
            self.origin = storage.read("registration.json")
        if self.origin["study"] != study:
            raise ValueError("Study differs from its retained registration")
        self.deadline = self.origin["startedAt"] + study["maximumWallSeconds"]

    def call(self, task_id, label, prompt, purpose=None):
        with self.lock:
            scope = f"{task_id}/{label}"
            prompt_hash = identity({"prompt": prompt, "purpose": purpose})
            slots = [
                self.storage.read(f"calls/{i}.json")
                for i in range(self.study["maximumCalls"])
            ]
            matches = [
                (i, slot)
                for i, slot in enumerate(slots)
                if slot and slot["scope"] == scope
            ]
            kind = "editor" if purpose is not None else "probe"
            fresh = not matches
            if matches:
                index, slot = matches[0]
                if slot["promptHash"] != prompt_hash:
                    raise ValueError("A resumed Harness2 call changed its input")
            else:
                now = self.clock()
                if now >= self.deadline:
                    raise ValueError("Harness2 wall-time budget exhausted")
                task = next(
                    task
                    for task in self.study["tasks"] + self.study["validation"]
                    if task["id"] == task_id
                )
                if kind == "editor":
                    run = {
                        "schemaVersion": "bayn.jev-harness2-editor.v3",
                        "sourceRevision": self.study["sourceRevision"],
                        "studyHash": identity(self.study),
                        "armManifestHashes": [identity(self.study["baseline"])],
                        "captureManifestHash": identity(self.study["tasks"]),
                        "registeredAt": instant(now),
                        "featureCutoff": instant(now),
                        "deadlineAt": instant(min(now + 179, self.deadline)),
                        "attempt": 0,
                        "promptTemplate": prompt,
                        "purpose": purpose,
                        "context": {
                            "memory": {
                                "text": "Only frozen development evidence may guide Jev instruction edits.",
                                "sha256": hashlib.sha256(
                                    b"Only frozen development evidence may guide Jev instruction edits."
                                ).hexdigest(),
                                "availableAt": instant(now),
                            }
                        },
                        **copy.deepcopy(self.study["editor"]),
                    }
                    basis = run["costBasis"]
                    if basis is not None and (
                        basis["effectiveFrom"] > run["featureCutoff"]
                        or basis["effectiveUntil"] < run["deadlineAt"]
                    ):
                        run["costBasis"] = None
                    budget = 1
                else:
                    run = {
                        "schemaVersion": "bayn.jev-harness2-probe.v1",
                        "sourceRevision": self.study["sourceRevision"],
                        "studyId": identity(self.study),
                        "registeredAt": instant(now),
                        "deadlineAt": instant(min(now + 179, self.deadline)),
                        "observation": task["observation"],
                        "instructions": validate_instructions(json.loads(prompt)),
                    }
                    budget = len(task["observation"]["manifest"]["candidateSymbols"])
                if (
                    sum(slot["requestBudget"] for slot in slots if slot) + budget
                    > self.study["maximumCalls"]
                ):
                    raise ValueError("Harness2 model-call budget exhausted")
                slot = {
                    "scope": scope,
                    "promptHash": prompt_hash,
                    "kind": kind,
                    "requestBudget": budget,
                    "run": run,
                }
                for index, previous in enumerate(slots):
                    if previous is None:
                        if not self.storage.create(f"calls/{index}.json", slot):
                            raise ValueError(
                                "A concurrent invocation reserved this study; resume from its retained evidence"
                            )
                        break
                else:
                    raise ValueError("Harness2 model-call budget exhausted")
            receipt_key = f"receipts/{index}.json"
            receipt = self.storage.read(receipt_key)
            if receipt is not None:
                if kind == "probe":
                    directory = self.root / "verification" / str(index)
                    directory.mkdir(parents=True, exist_ok=True)
                    request, output = directory / "run.json", directory / "receipt.json"
                    request.write_bytes(encode(slot["run"]))
                    output.write_bytes(encode(receipt))
                    self.invoke(
                        "probe",
                        ["--verify", str(request), "--receipt", str(output)],
                        30,
                    )
                if receipt["outcome"] != "COMPLETE":
                    raise ValueError("Retained Harness2 attempt is incomplete")
                return receipt
            if kind == "probe" and not fresh:
                raise ValueError("An ambiguous Jev probe cannot be retransmitted")
            remaining = self.deadline - self.clock()
            if remaining <= 0:
                raise ValueError("Harness2 wall-time budget exhausted")
            directory = self.root / "calls" / str(index)
            directory.mkdir(parents=True, exist_ok=True)
            request, output = directory / "run.json", directory / "receipt.json"
            request.write_bytes(encode(slot["run"]))
            if kind == "editor":
                output.unlink(missing_ok=True)
            self.invoke(
                kind,
                ["--run", str(request), "--output", str(output)],
                min(195, remaining),
            )
            receipt = json.loads(output.read_bytes())
            retain(self.storage, receipt_key, receipt)
            if receipt["outcome"] != "COMPLETE":
                raise ValueError(
                    "Harness2 attempt is incomplete; its original evidence is retained"
                )
            return receipt


class Substrate:
    name = "bayn-research"

    def surface(self):
        return SurfaceSpec(
            name="opencode",
            always_on=("instructions.json",),
            always_on_max=8000,
            always_on_cap_reason="Bayn permits a bounded prompt only",
            skill_dir="skills",
            skill_name_rule="",
            trigger_hint="",
            autotrigger_file="instructions.json",
            trigger_line="",
            subagent_requires_mode=False,
            plugin_dir=None,
            hooks_file=None,
            reject_empty_always_on=True,
        )


def native_evidence(receipt):
    def fields(value, names):
        return {name: value[name] for name in names if name in value}

    observations = []
    for row in receipt["requests"]:
        state = row["request"]["state"]
        signals, omitted = {}, {}
        for name in ("candidate", "benchmark"):
            source = state.get(name, {})
            signals[name] = fields(
                source,
                (
                    "symbol",
                    "returnsBps",
                    "minuteLogReturnVolatilityBps",
                    "latestCompletedClose",
                ),
            )
            signals[name]["quote"] = fields(source.get("quote", {}), ("bid", "ask"))
            signals[name]["priceWindow"] = fields(
                source.get("priceWindow", {}),
                ("referencePrice", "rangeHigh", "rangeLow"),
            )
            omitted[name] = {"bars1mCount": len(source.get("bars1m", []))}
        inference = row.get("inference")
        response = inference["response"] if inference is not None else None
        criteria = (
            row["request"].get("questions", {}).get("action", {}).get("criteria", {})
        )
        plan_columns = [
            "stopPriceUsd",
            "targetPriceUsd",
            "estimatedLossUsd",
            "estimatedProfitUsd",
        ]
        plans = [
            (name, value)
            for name, value in criteria.items()
            if name.startswith("plan_")
        ]
        observations.append(
            {
                "symbol": row["symbol"],
                "requestHash": row.get("requestHash"),
                "originalRequestHash": row.get("originalRequestHash"),
                "planCriteria": {
                    "columns": ["choice", *plan_columns],
                    "plans": [
                        [name, *[value[field] for field in plan_columns]]
                        for name, value in plans
                    ],
                    "meanings": list(
                        dict.fromkeys(value["meaning"] for _, value in plans)
                    ),
                    "priceBases": list(
                        dict.fromkeys(value["priceBasis"] for _, value in plans)
                    ),
                    "abstentions": {
                        name: value
                        for name, value in criteria.items()
                        if not name.startswith("plan_")
                    },
                },
                "signals": {
                    "relativeSignals": fields(
                        state.get("relativeSignals", {}),
                        (
                            "lookbackReturnBps",
                            "excessReturnBps",
                            "spreadBps",
                            "rangeLocationPpm",
                        ),
                    ),
                    "entryEconomics": fields(
                        state.get("entryEconomics") or {},
                        (
                            "breakEvenExitBidUsd",
                            "requiredBidRiseBps",
                            "maximumHoldingMinutes",
                            "operatingCostCoverage",
                        ),
                    ),
                    **signals,
                },
                "omittedHistory": omitted,
                "answers": None
                if response is None
                else {
                    name: {
                        "choice": answer.get("choice"),
                        "confidence": answer.get("confidence"),
                        "selectedProbability": answer.get("probabilities", {}).get(
                            answer.get("choice")
                        ),
                    }
                    for name, answer in response["answers"].items()
                },
            }
        )
    return {
        "notice": "Editor summary only. Only the named signals are represented; do not infer missing evidence. Jev received the complete original state and all answer choices; full requests and responses remain in the receipt.",
        "excludedCandidates": receipt["excludedCandidates"],
        "observations": observations,
        "decision": receipt["decision"],
    }


def editor_evidence(files):
    shared = {}
    aliases = {}

    def reference(match):
        execution = json.loads(match.group(1))
        observations = []
        for row in execution["observations"]:
            facts = {
                name: row[name]
                for name in (
                    "symbol",
                    "originalRequestHash",
                    "signals",
                    "planCriteria",
                    "omittedHistory",
                )
            }
            key = identity(facts)
            alias = aliases.setdefault(key, f"facts{len(aliases)}")
            shared[alias] = facts
            observations.append(
                {
                    "sourceFacts": alias,
                    "requestHash": row["requestHash"],
                    "answers": row["answers"],
                }
            )
        return (
            "[BAYN_EXECUTION]\n"
            + encode({**execution, "observations": observations}).decode()
            + "\n[/BAYN_EXECUTION]"
        )

    parts = [
        f"FILE {name}\n"
        + re.sub(
            r"\[BAYN_NATIVE_EVIDENCE\]\n(.*?)\n\[/BAYN_NATIVE_EVIDENCE\]",
            reference,
            value,
            flags=re.DOTALL,
        )
        for name, value in files
    ]
    if shared:
        parts.append(
            "SHARED_NATIVE_FACTS\nEach sourceFacts key references the complete immutable signal and plan terms below.\n"
            + encode(shared).decode()
        )
    return "\n\n".join(parts)


class Adapter:
    def __init__(self, study, root, calls):
        self.study, self.root, self.calls = study, root, calls
        self.substrate = Substrate()
        channel = ChannelSpec("opencode", "bayn/jev-instructions")
        self.spec = BenchSpec(
            name="bayn",
            runs_root=root / "runs",
            install_mode="workspace_config",
            prompts=BenchPrompts(
                work="evaluate typed Jev decisions from frozen native market signals",
                inv_levers="Only edit the Jev complete-plan question instruction in instructions.json. Keep state, criteria, quantities and risk rules fixed.",
                dom_levers="Refine native Jev complete-plan entry question wording.",
                yardstick="Use the supplied source material and behavioral contrasts. Never invent future returns.",
            ),
            channels={"proposer": channel, "selector": channel},
            allow_subagents=False,
        )

    def tasks(self, split="all"):
        return [task["id"] for task in self.study["tasks"]]

    def domain_of(self, task_id):
        return "jev-decisions"

    def task_prompt(self, task_id):
        task = next(task for task in self.study["tasks"] if task["id"] == task_id)
        return json.dumps(
            {"taskId": task_id, "observedAt": task["observation"]["observedAt"]},
            sort_keys=True,
        )

    def task_files(self, task_id):
        return None

    def base_harness(self):
        directory = self.root / "base"
        directory.mkdir(exist_ok=True)
        prompt = json.dumps(self.study["baseline"], sort_keys=True)
        (directory / "instructions.json").write_text(prompt)
        return directory

    def validate_tree(self, tree):
        if set(tree) != {"instructions.json"}:
            raise ValueError("Only instructions.json is editable")
        validate_instructions(json.loads(tree["instructions.json"]))

    def execute(self, task_id, harness_dir, run_id, *, timeout=None):
        prompt = (
            (harness_dir or self.base_harness()) / "instructions.json"
        ).read_text()
        self.validate_tree({"instructions.json": prompt})
        receipt = self.calls.call(task_id, f"probe/{run_id}", prompt)
        directory = self.root / "executions" / identity(run_id)
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "answer.txt").write_text(json.dumps(receipt["decision"]))
        (directory / "trajectory.md").write_text(
            "[ACTION] Evaluate Jev through the native typed API and Bayn decision code\n[BAYN_NATIVE_EVIDENCE]\n"
            + json.dumps(
                native_evidence(receipt), sort_keys=True, separators=(",", ":")
            )
            + "\n[/BAYN_NATIVE_EVIDENCE]"
        )
        if run_id.endswith("/c1"):
            (self.root / "candidate-instructions.json").write_text(prompt)
        return directory

    def delivered(self, run_dir):
        return (run_dir / "answer.txt").is_file()

    def trajectory(self, run_dir, *, obs_trunc):
        return (run_dir / "trajectory.md").read_text()

    def deliverable_text(self, run_dir):
        return (run_dir / "answer.txt").read_text()

    def deliverable_files(self, run_dir):
        return {"decision.json": self.deliverable_text(run_dir)}


class Editor(Proposer):
    def __init__(self, adapter):
        super().__init__(adapter.spec.channels["proposer"])
        self.adapter = adapter

    def call(self, mission, context_dir, label, **kwargs):
        context = Path(context_dir)
        task_text = (context / "task.md").read_text()
        task_id = next(
            task
            for task in self.adapter.tasks()
            if self.adapter.task_prompt(task) == task_text
        )
        baseline_path = context / "base_harness" / "instructions.json"
        if not kwargs.get("harvest") and baseline_path.is_file():
            baseline_hash = identity(validate_instructions(read_json(baseline_path)))
            paths = [context / "harness" / "instructions.json"] + sorted(
                (context / "pool").glob("*/harness/instructions.json")
            )
            compared = {
                str(path.relative_to(context)): identity(
                    validate_instructions(read_json(path))
                )
                for path in paths
            }
            unchanged = all(value == baseline_hash for value in compared.values())
            (context / "instruction-comparison.json").write_bytes(
                encode(
                    {
                        "schemaVersion": "bayn.jev-harness2-reflection-identity.v1",
                        "baselineInstructionsHash": baseline_hash,
                        "comparedInstructions": compared,
                        "change": "NO_INSTRUCTION_CHANGE"
                        if unchanged
                        else "INSTRUCTION_CHANGES_PRESENT",
                    }
                )
            )
            if unchanged:
                reply = Reply(
                    label=label,
                    text="<edits>\ncomponent: entry\nchange: No instruction change\n"
                    "observed: All compared instruction documents equal the baseline. "
                    "Provider output differences cannot be attributed to an instruction edit.\n"
                    "verdict: confounded\n</edits>\nNO_ENTRY",
                    ok=True,
                    attempts=0,
                )
                self._calls.append(reply)
                return reply
        evidence = editor_evidence(
            (str(path.relative_to(context)), path.read_text())
            for path in sorted(context.rglob("*"))
            if path.is_file()
        )
        instruction = (
            "Return a JSON object with exactly one entry string field. Return only that JSON, with no XML tags, notes or context wrapper. The string is bounded to 2000 characters. Keep analysis brief and return the complete JSON within the token budget. "
            "The Bayn executor only receives immutable market state and typed Jev questions. It has no tools, files, skills, scripts, plugins, subagents or alternate APIs. "
            "References to those capabilities in the generic upstream mission do not apply to Bayn. "
            "Never instruct the executor to use them or invent a fallback path. "
            if kwargs.get("harvest")
            else "Follow the mission's reflection format. "
            "Only instructions.json can change in Bayn, so report one component. "
            "Keep analysis brief and finish the requested reflection within 200 words. "
            "Compare only the supplied executions; if they show no reusable behavioral "
            "contrast, retain the edit row and use NO_ENTRY instead of inventing a lesson. "
        )
        try:
            receipt = self.adapter.calls.call(
                task_id,
                f"editor/{label}",
                mission
                + "\n"
                + evidence
                + "\n\n# BAYN EXECUTION CONTRACT\n"
                + instruction.strip(),
                purpose="prompt-edit" if kwargs.get("harvest") else "reflection",
            )
        except (ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
            raise ProposerError(type(error).__name__, attempts=1) from None
        text = receipt["responseText"]
        workspace = None
        if kwargs.get("harvest"):
            try:
                instructions = validate_instructions(json.loads(text))
            except ValueError:
                raise ProposerError(
                    "Editor must return the native instruction JSON document",
                    attempts=1,
                ) from None
            tree = {"instructions.json": encode(instructions).decode()}
            workspace = context / "harness"
            (workspace / "instructions.json").write_text(tree["instructions.json"])
        reply = Reply(label=label, text=text, ok=True, attempts=1, workspace=workspace)
        self._calls.append(reply)
        return reply


def compare_decisions(pairs):
    complete = [
        p
        for p in pairs
        if all(p[arm].get("outcome") == "COMPLETE" for arm in ("baseline", "candidate"))
    ]

    def decision_material(receipt):
        decision = copy.deepcopy(receipt["decision"])
        for selected in decision.get("selected", []):
            selected.pop("probability", None)
        return decision

    changed = sum(
        decision_material(p["baseline"]) != decision_material(p["candidate"])
        for p in complete
    )
    selections = {}
    for arm in ("baseline", "candidate"):
        selections[arm] = sum(
            len(p[arm]["decision"].get("selected", [])) for p in complete
        )
    return {
        "schemaVersion": "bayn.jev-harness2-comparison.v1",
        "pairs": pairs,
        "completePairs": len(complete),
        "incompletePairs": len(pairs) - len(complete),
        "changedDecisions": changed,
        "selectedEntries": selections,
        "decisionImprovement": "NO_OBSERVED_CHANGE"
        if complete and len(complete) == len(pairs) and changed == 0
        else "INCONCLUSIVE",
        "economicImprovement": "UNPROVEN",
        "qualification": "UNQUALIFIED",
        "reason": "Native decision changes are measured. Closed execution outcomes, complete costs and prospective validation are required to establish improvement.",
    }


def run_study(study, root, storage, invoke=cli, clock=time.time):
    root = root / identity(study)
    root.mkdir(parents=True, exist_ok=True)
    previous = storage.read("result.json")
    if previous is not None:
        if previous["studyId"] != identity(study) or previous.get(
            "reportHash"
        ) != identity(
            {key: value for key, value in previous.items() if key != "reportHash"}
        ):
            raise ValueError("Retained result belongs to another study")
        (root / "result.json").write_bytes(encode(previous))
        return previous
    for task in study["tasks"] + study["validation"]:
        path = root / f"{task['id']}.json"
        path.write_bytes(
            encode(
                {
                    "schemaVersion": "bayn.jev-harness2-probe.v1",
                    "sourceRevision": study["sourceRevision"],
                    "studyId": identity(study),
                    "registeredAt": instant(clock()),
                    "deadlineAt": instant(clock() + 179),
                    "observation": task["observation"],
                    "instructions": study["baseline"],
                }
            )
        )
        invoke("probe", ["--validate", str(path)], 10)
    calls = Calls(study, root, storage, invoke, clock)
    adapter = Adapter(study, root, calls)
    result = run_domain(
        "jev-decisions",
        adapter.tasks(),
        1,
        adapter=adapter,
        prop=Editor(adapter),
        runs_root=adapter.spec.runs_root,
        library_root=root / "library",
        modes=("seq",),
    )
    summaries = [
        json.loads(path.read_text()) for path in (root / "runs").rglob("summary.json")
    ]
    fallback = any(
        stage["fell_back"]
        for summary in summaries
        for stage in summary.get("modes", {}).get("seq", {}).get("stages", [])
    )
    comparison = []
    candidate = root / "candidate-instructions.json"
    if result["failed"] == 0 and not fallback and candidate.exists():
        frozen = candidate.read_text()
        retain(
            storage,
            "frozen-candidate.json",
            {
                "instructions": json.loads(frozen),
                "sha256": identity(json.loads(frozen)),
            },
        )
        for task in study["validation"]:
            pair = {}
            for arm, prompt in (
                ("baseline", json.dumps(study["baseline"], sort_keys=True)),
                ("candidate", frozen),
            ):
                try:
                    pair[arm] = calls.call(task["id"], f"validation/{arm}", prompt)
                except (ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
                    pair[arm] = {
                        "outcome": "INCONCLUSIVE",
                        "reason": type(error).__name__,
                    }
            comparison.append(
                {
                    "taskId": task["id"],
                    "observedAt": task["observation"]["observedAt"],
                    **pair,
                }
            )
    comparison_report = compare_decisions(comparison)
    retain(storage, "comparison.json", comparison_report)
    slots = [storage.read(f"calls/{i}.json") for i in range(study["maximumCalls"])]
    receipts = [
        storage.read(f"receipts/{i}.json") for i, slot in enumerate(slots) if slot
    ]
    complete = [receipt for receipt in receipts if receipt is not None]
    report = {
        "schemaVersion": "bayn.jev-harness2-result.v1",
        "upstreamRevision": UPSTREAM_REVISION,
        "studyId": identity(study),
        "qualification": "UNQUALIFIED",
        "outcome": "COMPLETE"
        if result["failed"] == 0
        and not fallback
        and len(complete) == len(receipts)
        and all(r["outcome"] == "COMPLETE" for r in complete)
        and comparison_report["completePairs"] == len(study["validation"])
        else "INCONCLUSIVE",
        "reservedModelCalls": sum(slot["requestBudget"] for slot in slots if slot),
        "attempts": len(receipts),
        "verifiedJevRequests": sum(len(r.get("requests", [])) for r in complete),
        "verifiedEditorRequests": sum("responseText" in r for r in complete),
        "unverifiedAttempts": len(receipts) - len(complete),
        "comparison": comparison_report,
        "receiptHashes": sorted(r["receiptHash"] for r in complete),
        "costPicoUsd": str(sum(int(r["costPicoUsd"]) for r in complete))
        if receipts
        and len(complete) == len(receipts)
        and all(r["costPicoUsd"] is not None for r in complete)
        else None,
        "result": result,
    }
    for path in sorted(root.rglob("*")):
        if path.is_file() and path.suffix in (".md", ".json", ".txt"):
            retain(
                storage,
                f"artifacts/{path.relative_to(root)}",
                {"text": path.read_text()},
            )
    report["reportHash"] = identity(report)
    retain(storage, "result.json", report)
    (root / "result.json").write_bytes(encode(report))
    return report


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(prog="bayn-harness2", description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    study = validate_study(read_json(args.manifest))
    storage = Storage(
        os.environ["BAYN_PUBLIC_INFORMATION_BUCKET"],
        os.environ["BAYN_PUBLIC_INFORMATION_STORAGE_ENDPOINT"],
        identity(study),
    )
    report = run_study(study, args.output.resolve(), storage)
    print(
        json.dumps(
            {
                key: report[key]
                for key in ("studyId", "outcome", "reservedModelCalls", "qualification")
            }
        )
    )
    return int(report["outcome"] != "COMPLETE")


if __name__ == "__main__":
    raise SystemExit(main())
