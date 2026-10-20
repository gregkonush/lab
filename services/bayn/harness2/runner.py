"""Run upstream Harness2 against Bayn's signed, non-executable research API."""

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
MAX_BYTES = 262144


def encode(value):
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), allow_nan=False
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
        raise ValueError("Study input exceeds 256 KiB")
    return json.loads(raw)


def validate_study(value):
    if not isinstance(value, dict) or set(value) != {
        "schemaVersion",
        "maximumCalls",
        "maximumWallSeconds",
        "tasks",
    }:
        raise ValueError("Malformed Harness2 study")
    if value["schemaVersion"] != "bayn.harness2-study.v1":
        raise ValueError("Unsupported Harness2 study version")
    for name, lower, upper in (
        ("maximumCalls", 8, 32),
        ("maximumWallSeconds", 60, 3600),
    ):
        if type(value[name]) is not int or not lower <= value[name] <= upper:
            raise ValueError(f"{name} is outside its supported bound")
    tasks = value["tasks"]
    if not isinstance(tasks, list) or not 1 <= len(tasks) <= 4:
        raise ValueError("A study requires one to four ordered tasks")
    seen = set()
    for task in tasks:
        if not isinstance(task, dict) or set(task) != {"id", "run"}:
            raise ValueError("Malformed Harness2 task")
        if not isinstance(task["id"], str) or not re.fullmatch(
            r"[a-z][a-z0-9-]{0,63}", task["id"]
        ):
            raise ValueError("Invalid task ID")
        if task["id"] in seen:
            raise ValueError("Duplicate task ID")
        seen.add(task["id"])
        if not isinstance(task["run"], dict):
            raise ValueError("Task requires a Bayn research registration")
    if len(encode(value)) > MAX_BYTES:
        raise ValueError("Study input exceeds 256 KiB")
    prompts = [task["run"].get("promptTemplate") for task in tasks]
    cutoffs = [task["run"].get("featureCutoff") for task in tasks]
    if any(
        not isinstance(prompt, str) or not 1 <= len(prompt) <= 8000
        for prompt in prompts
    ):
        raise ValueError("Initial prompts must contain one to 8000 characters")
    if len(set(prompts)) != 1:
        raise ValueError("Study tasks must share the same initial prompt")
    if any(not isinstance(cutoff, str) for cutoff in cutoffs) or cutoffs != sorted(
        cutoffs
    ):
        raise ValueError(
            "Study tasks must retain chronological original feature cutoffs"
        )
    return value


class Storage:
    def __init__(self, bucket, endpoint, study_id):
        self.bucket = bucket
        self.prefix = f"harness2/v1/{study_id}/"
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
            raw = body.read(6 * 1024 * 1024)
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


def cli(args, timeout):
    completed = subprocess.run(
        ["bayn-research", *args],
        capture_output=True,
        timeout=timeout,
        check=False,
    )
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
            if matches:
                index, slot = matches[0]
                if slot["promptHash"] != prompt_hash:
                    raise ValueError("A resumed Harness2 call changed its input")
            else:
                now = self.clock()
                if now >= self.deadline:
                    raise ValueError("Harness2 wall-time budget exhausted")
                task = next(
                    task for task in self.study["tasks"] if task["id"] == task_id
                )
                run = copy.deepcopy(task["run"])
                run.update(
                    promptTemplate=prompt,
                    registeredAt=instant(now),
                    featureCutoff=instant(now),
                    deadlineAt=instant(min(now + 179, self.deadline)),
                )
                if purpose is not None:
                    run.update(
                        schemaVersion="bayn.harness2-inference.v1", purpose=purpose
                    )
                if (
                    not prompt.strip()
                    or len(prompt) > 100000
                    or len(encode(run)) > MAX_BYTES
                ):
                    raise ValueError(
                        "Harness2 context exceeds the research request bound"
                    )
                slot = {"scope": scope, "promptHash": prompt_hash, "run": run}
                for index, previous in enumerate(slots):
                    if previous is None:
                        if self.storage.create(f"calls/{index}.json", slot):
                            break
                        winner = self.storage.read(f"calls/{index}.json")
                        if winner and winner["scope"] == scope:
                            if winner["promptHash"] != prompt_hash:
                                raise ValueError(
                                    "A concurrent Harness2 call changed its input"
                                )
                            slot = winner
                            break
                else:
                    raise ValueError("Harness2 model-call budget exhausted")
            receipt_key = f"receipts/{index}.json"
            receipt = self.storage.read(receipt_key)
            remaining = self.deadline - self.clock()
            if receipt is None and remaining <= 0:
                raise ValueError("Harness2 wall-time budget exhausted")
            directory = self.root / "calls" / str(index)
            directory.mkdir(parents=True, exist_ok=True)
            request = directory / "run.json"
            output = directory / "receipt.json"
            request.write_bytes(encode(slot["run"]))
            output.unlink(missing_ok=True)
            self.invoke(
                ["--run", str(request), "--output", str(output)],
                min(195, remaining) if receipt is None else 10,
            )
            receipt = json.loads(output.read_bytes())
            retain(self.storage, receipt_key, receipt)
            if receipt["outcome"] != "COMPLETE":
                raise ValueError(
                    "Harness2 model attempt is incomplete; it cannot be retried as a new call"
                )
            return receipt


class Substrate:
    name = "bayn-research"

    def surface(self):
        return SurfaceSpec(
            name="opencode",
            always_on=("systemprompt.md",),
            always_on_max=8000,
            always_on_cap_reason="Bayn permits a bounded prompt only",
            skill_dir="skills",
            skill_name_rule="",
            trigger_hint="",
            autotrigger_file="systemprompt.md",
            trigger_line="",
            subagent_requires_mode=False,
            plugin_dir=None,
            hooks_file=None,
            reject_empty_always_on=True,
        )


class Adapter:
    def __init__(self, study, root, calls):
        self.study, self.root, self.calls = study, root, calls
        self.substrate = Substrate()
        channel = ChannelSpec("opencode", "bayn/alpha-r1")
        self.spec = BenchSpec(
            name="bayn",
            runs_root=root / "runs",
            install_mode="workspace_config",
            prompts=BenchPrompts(
                work="select factors from frozen semantic descriptions and past evidence",
                inv_levers="Only edit systemprompt.md. Keep the factor IDs and output contract.",
                dom_levers="Only edit factor-selection instructions in systemprompt.md.",
                yardstick="Use the supplied source material and behavioral contrasts. Never invent future returns.",
            ),
            channels={"proposer": channel, "selector": channel},
            allow_subagents=False,
        )

    def tasks(self, split="all"):
        return [task["id"] for task in self.study["tasks"]]

    def domain_of(self, task_id):
        return "factor-selection"

    def task_prompt(self, task_id):
        task = next(task for task in self.study["tasks"] if task["id"] == task_id)
        return json.dumps(
            {"taskId": task_id, "context": task["run"]["context"]}, sort_keys=True
        )

    def task_files(self, task_id):
        return None

    def base_harness(self):
        directory = self.root / "base"
        directory.mkdir(exist_ok=True)
        prompt = self.study["tasks"][0]["run"]["promptTemplate"]
        (directory / "systemprompt.md").write_text(prompt)
        return directory

    def validate_tree(self, tree):
        if (
            set(tree) != {"systemprompt.md"}
            or not 1 <= len(tree["systemprompt.md"].strip()) <= 8000
        ):
            raise ValueError(
                "Only a nonempty systemprompt.md of at most 8000 characters is editable"
            )

    def execute(self, task_id, harness_dir, run_id, *, timeout=None):
        prompt = ((harness_dir or self.base_harness()) / "systemprompt.md").read_text()
        self.validate_tree({"systemprompt.md": prompt})
        receipt = self.calls.call(task_id, f"probe/{run_id}", prompt)
        directory = self.root / "executions" / identity(run_id)
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "answer.txt").write_text(json.dumps(receipt["factors"]))
        (directory / "trajectory.md").write_text(
            "[ACTION] Select factors with the signed Bayn research API\n[OBSERVATION]\n"
            + receipt["responseText"]
        )
        return directory

    def delivered(self, run_dir):
        return (run_dir / "answer.txt").is_file()

    def trajectory(self, run_dir, *, obs_trunc):
        return (run_dir / "trajectory.md").read_text()

    def deliverable_text(self, run_dir):
        return (run_dir / "answer.txt").read_text()

    def deliverable_files(self, run_dir):
        return {"factors.json": self.deliverable_text(run_dir)}


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
        evidence = "\n\n".join(
            f"FILE {path.relative_to(context)}\n{path.read_text()}"
            for path in sorted(context.rglob("*"))
            if path.is_file()
        )
        instruction = (
            "Return the complete revised systemprompt.md inside exactly one <harness>...</harness> block, "
            "followed by <notes>...</notes>. The Bayn executor only receives prompt text and factor "
            "descriptions. It has no tools, files, skills, scripts, plugins, subagents or alternate APIs. "
            "References to those capabilities in the generic upstream mission do not apply to Bayn. "
            "Never instruct the executor to use them or invent a fallback path. "
            if kwargs.get("harvest")
            else "Follow the mission's reflection format. "
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
            proposals = re.findall(r"<harness>([\s\S]*?)</harness>", text)
            if len(proposals) != 1:
                raise ProposerError(
                    "Editor must return exactly one harness", attempts=1
                )
            tree = {"systemprompt.md": proposals[0].strip()}
            self.adapter.validate_tree(tree)
            workspace = context / "harness"
            (workspace / "systemprompt.md").write_text(tree["systemprompt.md"])
        reply = Reply(label=label, text=text, ok=True, attempts=1, workspace=workspace)
        self._calls.append(reply)
        return reply


def run_study(study, root, storage, invoke=cli, clock=time.time):
    root = root / identity(study)
    root.mkdir(parents=True, exist_ok=True)
    previous = storage.read("result.json")
    if previous is not None:
        if previous["studyId"] != identity(study):
            raise ValueError("Retained result belongs to another study")
        (root / "result.json").write_bytes(encode(previous))
        return previous
    for task in study["tasks"]:
        path = root / f"{task['id']}.json"
        path.write_bytes(encode(task["run"]))
        invoke(["--validate", str(path)], 10)
    calls = Calls(study, root, storage, invoke, clock)
    adapter = Adapter(study, root, calls)
    result = run_domain(
        "factor-selection",
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
    slots = [storage.read(f"calls/{i}.json") for i in range(study["maximumCalls"])]
    receipts = [
        storage.read(f"receipts/{i}.json") for i, slot in enumerate(slots) if slot
    ]
    complete = [receipt for receipt in receipts if receipt is not None]
    report = {
        "schemaVersion": "bayn.harness2-result.v1",
        "upstreamRevision": UPSTREAM_REVISION,
        "studyId": identity(study),
        "qualification": "UNQUALIFIED",
        "outcome": "COMPLETE"
        if result["failed"] == 0
        and not fallback
        and len(complete) == len(receipts)
        and all(r["outcome"] == "COMPLETE" for r in complete)
        else "INCONCLUSIVE",
        "modelCalls": len(receipts),
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
                for key in ("studyId", "outcome", "modelCalls", "qualification")
            }
        )
    )
    return int(report["outcome"] != "COMPLETE")


if __name__ == "__main__":
    raise SystemExit(main())
