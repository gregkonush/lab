import copy
import re
import json
import tempfile
import unittest
from pathlib import Path

from runner import (
    Adapter,
    Calls,
    Editor,
    compare_decisions,
    encode,
    identity,
    editor_evidence,
    native_evidence,
    run_study,
    validate_study,
)


class MemoryStorage:
    def __init__(self):
        self.values = {}

    def read(self, key):
        return copy.deepcopy(self.values.get(key))

    def create(self, key, value):
        if key in self.values:
            return False
        self.values[key] = copy.deepcopy(value)
        return True


def study():
    def task(name, time):
        return {
            "id": name,
            "observation": {
                "schemaVersion": "bayn.jev-observation.v1",
                "observedAt": time,
                "manifest": {"candidateSymbols": ["BTC/USD"]},
                "protocol": {"maximumHoldingMinutes": 15},
            },
        }

    return {
        "schemaVersion": "bayn.jev-harness2-study.v1",
        "sourceRevision": "a" * 40,
        "maximumCalls": 16,
        "maximumWallSeconds": 1800,
        "baseline": {
            "entry": "Assess entry evidence.",
        },
        "editor": {"policy": {"model": "editor-test"}, "costBasis": None},
        "tasks": [task("development", "1970-01-01T00:00:00.000Z")],
        "validation": [task("untouched", "1970-01-01T00:15:00.000Z")],
    }


class NativeCLI:
    def __init__(self, fail_probe=False):
        self.requests = []
        self.validations = []
        self.fail_probe = fail_probe

    def __call__(self, kind, args, timeout):
        run = json.loads(Path(args[1]).read_bytes())
        if args[0] in ("--validate", "--verify"):
            self.validations.append(run)
            return
        self.requests.append((kind, run))
        if kind == "probe":
            if self.fail_probe:
                raise RuntimeError("ambiguous provider transmission")
            content = {
                "excludedCandidates": [],
                "decision": {
                    "purpose": "ENTRY",
                    "selected": [],
                    "entryPlanRejections": {},
                },
                "requests": [
                    {
                        "symbol": "BTC/USD",
                        "request": {"state": {"signal": "synthetic"}},
                        "inference": {
                            "response": {"answers": {"action": {"choice": "wait"}}}
                        },
                    }
                ],
            }
        else:
            prompt = run["promptTemplate"]
            if "Return a JSON object with exactly" in prompt:
                candidate = {
                    **study()["baseline"],
                    "entry": "Judge entry from the supplied evidence and horizon.",
                }
                text = json.dumps(candidate)
            else:
                text = "<edits>component: instructions.json\nobserved: explicit horizon</edits>NO_ENTRY"
            content = {"responseText": text}
        Path(args[3]).write_bytes(
            encode(
                {
                    "outcome": "COMPLETE",
                    "receiptHash": identity(run),
                    "costPicoUsd": None,
                    **content,
                }
            )
        )


class RunnerTests(unittest.TestCase):
    def test_unicode_instruction_hash_matches_native_canonical_hash(self):
        instructions = {
            "entry": "Use café’s observed price; never invent future returns."
        }
        self.assertEqual(
            identity(instructions),
            "e176b22edf1f1e10ea18c07e01f5db63a0713feb294cc7070b38424114c0e583",
        )

    def test_editor_summary_preserves_native_requests(self):
        receipt = {
            "excludedCandidates": [],
            "decision": {"selected": []},
            "requests": [
                {
                    "symbol": "BTC/USD",
                    "requestHash": "a" * 64,
                    "request": {
                        "questions": {
                            "action": {
                                "criteria": {
                                    "wait": "Needs confirmation",
                                    "avoid": "Unsupported setup",
                                    "plan_0": {
                                        "priceBasis": "HYPOTHETICAL_ORDER_PRICES",
                                        "meaning": "A complete hypothetical plan",
                                        "stopPriceUsd": 98,
                                        "targetPriceUsd": 103,
                                        "estimatedLossUsd": 2,
                                        "estimatedProfitUsd": 3,
                                    },
                                    "plan_1": {
                                        "priceBasis": "HYPOTHETICAL_ORDER_PRICES",
                                        "meaning": "A complete hypothetical plan",
                                        "stopPriceUsd": 97,
                                        "targetPriceUsd": 105,
                                        "estimatedLossUsd": 3,
                                        "estimatedProfitUsd": 5,
                                    },
                                }
                            }
                        },
                        "state": {
                            "candidate": {
                                "bars1m": [{"close": 100}] * 500,
                                "returnsBps": 25,
                            },
                            "benchmark": {"bars1m": [{"close": 200}] * 500},
                        },
                    },
                    "inference": {
                        "response": {
                            "answers": {
                                "action": {
                                    "choice": "wait",
                                    "confidence": 0.5,
                                    "probabilities": {
                                        "wait": 0.6,
                                        "enter": 0.3,
                                        "avoid": 0.1,
                                    },
                                }
                            }
                        }
                    },
                }
            ],
        }
        original = copy.deepcopy(receipt)
        summary = native_evidence(receipt)
        self.assertEqual(receipt, original)
        self.assertLess(len(encode(summary)), 2000)
        row = summary["observations"][0]
        self.assertEqual(row["signals"]["candidate"]["returnsBps"], 25)
        self.assertEqual(row["omittedHistory"]["candidate"]["bars1mCount"], 500)
        self.assertEqual(row["answers"]["action"]["selectedProbability"], 0.6)
        self.assertEqual(
            row["planCriteria"]["abstentions"],
            {"wait": "Needs confirmation", "avoid": "Unsupported setup"},
        )
        self.assertEqual(
            row["planCriteria"]["columns"],
            [
                "choice",
                "stopPriceUsd",
                "targetPriceUsd",
                "estimatedLossUsd",
                "estimatedProfitUsd",
            ],
        )
        self.assertEqual(
            row["planCriteria"]["plans"],
            [["plan_0", 98, 103, 2, 3], ["plan_1", 97, 105, 3, 5]],
        )

    def test_full_universe_keeps_every_signal_group_within_editor_budget(self):
        state = {
            "relativeSignals": {
                "excessReturnBps": 15,
                "lookbackReturnBps": 25,
                "spreadBps": 3,
                "rangeLocationPpm": 42000,
                "referenceAt": "x" * 1000,
            },
            "entryEconomics": {
                "breakEvenExitBidUsd": 83514.937133,
                "requiredBidRiseBps": 82.74,
                "maximumHoldingMinutes": 15,
                "operatingCostCoverage": "UNKNOWN",
            },
            "candidate": {
                "symbol": "AAPL",
                "returnsBps": {"1": 0.01, "5": -2.01, "15": -5.83, "30": -30.88},
                "quote": {"bid": 100, "ask": 100.1},
                "priceWindow": {"referencePrice": 99, "rangeHigh": 103, "rangeLow": 98},
                "bars1m": [{}] * 500,
            },
            "benchmark": {
                "symbol": "SPY",
                "returnsBps": {"1": 0.01, "5": -2.01, "15": -5.83, "30": -30.88},
                "latestCompletedClose": 110,
                "priceWindow": {
                    "referencePrice": 109,
                    "rangeHigh": 113,
                    "rangeLow": 108,
                },
                "bars1m": [{}] * 500,
            },
        }
        receipt = {
            "excludedCandidates": [],
            "decision": {"selected": []},
            "requests": [
                {
                    "symbol": f"C{index}",
                    "requestHash": "a" * 64,
                    "originalRequestHash": f"{index:064x}",
                    "request": {
                        "state": copy.deepcopy(state),
                        "questions": {
                            "action": {
                                "criteria": {
                                    "wait": "Needs confirmation",
                                    "avoid": "Unsupported setup",
                                    **{
                                        f"plan_{plan}": {
                                            "priceBasis": "HYPOTHETICAL_ORDER_PRICES",
                                            "meaning": "A supplied complete hypothetical plan",
                                            "stopPriceUsd": 83000 + plan,
                                            "targetPriceUsd": 84000 + plan,
                                            "estimatedLossUsd": 4.25 + plan,
                                            "estimatedProfitUsd": 6.5 + plan,
                                        }
                                        for plan in range(16)
                                    },
                                }
                            }
                        },
                    },
                    "inference": None,
                }
                for index in range(19)
            ],
        }
        summary = native_evidence(receipt)
        for row in summary["observations"]:
            self.assertEqual(row["signals"]["relativeSignals"]["excessReturnBps"], 15)
            self.assertEqual(
                row["signals"]["entryEconomics"]["requiredBidRiseBps"], 82.74
            )
            self.assertEqual(row["signals"]["candidate"]["priceWindow"]["rangeLow"], 98)
            self.assertEqual(row["signals"]["benchmark"]["latestCompletedClose"], 110)
            self.assertEqual(len(row["planCriteria"]["plans"]), 16)
        trajectories = []
        for execution in range(4):
            evidence = copy.deepcopy(summary)
            for row in evidence["observations"]:
                row["requestHash"] = f"{execution:064x}"
            trajectories.append(
                (
                    f"rollout-{execution}.md",
                    "[BAYN_NATIVE_EVIDENCE]\n"
                    + encode(evidence).decode()
                    + "\n[/BAYN_NATIVE_EVIDENCE]",
                )
            )
        context = editor_evidence(trajectories)
        shared = json.loads(context.split("below.\n")[1])
        self.assertEqual(len(shared), 19)
        expected = {}
        for row in summary["observations"]:
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
            expected[identity(facts)] = facts
        self.assertEqual(
            {identity(value): value for value in shared.values()}, expected
        )
        executions = re.findall(
            r"\[BAYN_EXECUTION\]\n(.*?)\n\[/BAYN_EXECUTION\]", context, flags=re.DOTALL
        )
        self.assertEqual(len(executions), 4)
        for execution, document in enumerate(executions):
            rows = json.loads(document)["observations"]
            self.assertEqual(len(rows), 19)
            for original, row in zip(summary["observations"], rows):
                self.assertEqual(row["requestHash"], f"{execution:064x}")
                self.assertEqual(
                    shared[row["sourceFacts"]]["planCriteria"], original["planCriteria"]
                )
                self.assertEqual(
                    shared[row["sourceFacts"]]["signals"], original["signals"]
                )
        self.assertLess(len(context.encode()), 90000)

    def test_all_excluded_probe_keeps_source_failures_in_editor_context(self):
        excluded = [
            {
                "status": "EXCLUDED",
                "symbol": "BTC/USD",
                "reason": "not-ready",
                "message": "intraday snapshot lacks a trade for candidate symbol",
            }
        ]
        receipt = {
            "excludedCandidates": excluded,
            "requests": [],
            "decision": {"selected": [], "entryPlanRejections": {}},
        }
        original = copy.deepcopy(receipt)
        summary = native_evidence(receipt)
        self.assertEqual(summary["excludedCandidates"], excluded)
        self.assertEqual(summary["observations"], [])
        self.assertEqual(receipt, original)

    def test_real_upstream_refines_jev_and_only_then_evaluates_untouched_observations(
        self,
    ):
        data = validate_study(study())
        storage, cli = MemoryStorage(), NativeCLI()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result = run_study(data, root, storage, cli, lambda: 1000)
            self.assertEqual(result["outcome"], "COMPLETE")
            self.assertEqual(result["reservedModelCalls"], 10)
            self.assertEqual(result["comparison"]["completePairs"], 1)
            self.assertEqual(
                result["comparison"]["decisionImprovement"], "NO_OBSERVED_CHANGE"
            )
            self.assertEqual(result["comparison"]["economicImprovement"], "UNPROVEN")
            self.assertIsNone(result["costPicoUsd"])
            probes = [run for kind, run in cli.requests if kind == "probe"]
            editors = [run for kind, run in cli.requests if kind == "editor"]
            self.assertEqual(len(probes), 6)
            self.assertEqual(len(editors), 4)
            self.assertTrue(
                all(
                    run["schemaVersion"] == "bayn.jev-harness2-probe.v1"
                    for run in probes
                )
            )
            self.assertTrue(
                all(
                    run["schemaVersion"] == "bayn.jev-harness2-editor.v3"
                    for run in editors
                )
            )
            self.assertTrue(
                all(
                    "1970-01-01T00:15:00.000Z" not in run["promptTemplate"]
                    for run in editors
                )
            )
            self.assertEqual(
                probes[-2]["observation"], data["validation"][0]["observation"]
            )
            self.assertEqual(probes[-1]["observation"], probes[-2]["observation"])
            self.assertIn("frozen-candidate.json", storage.values)
            self.assertFalse(
                list((root / identity(data) / "library").rglob("EXPERIENCE.md"))
            )
            self.assertEqual(run_study(data, root, storage, cli, lambda: 1001), result)
            self.assertEqual(len(cli.requests), 10)

    def test_unchanged_instructions_cannot_teach_a_successful_edit(self):
        class UnchangedEditorCLI(NativeCLI):
            def __call__(self, kind, args, timeout):
                super().__call__(kind, args, timeout)
                if args[0] != "--run" or kind != "editor":
                    return
                output = Path(args[3])
                receipt = json.loads(output.read_bytes())
                run = json.loads(Path(args[1]).read_bytes())
                receipt["responseText"] = (
                    json.dumps(study()["baseline"])
                    if run["purpose"] == "prompt-edit"
                    else "<edits>component: entry\nchange: No change\n"
                    "observed: wait became avoid\nverdict: helped</edits>"
                    "<experience>cue: An unchanged instruction\n"
                    "lesson: Keep the successful edit\n"
                    "evidence: wait became avoid\nconfidence: medium</experience>"
                )
                output.write_bytes(encode(receipt))

        data = validate_study(study())
        storage, cli = MemoryStorage(), UnchangedEditorCLI()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result = run_study(data, root, storage, cli, lambda: 1000)
            self.assertEqual(result["outcome"], "COMPLETE")
            self.assertEqual(
                storage.values["frozen-candidate.json"]["instructions"],
                data["baseline"],
            )
            self.assertFalse(
                list((root / identity(data) / "library").rglob("EXPERIENCE.md"))
            )
            editors = [run for kind, run in cli.requests if kind == "editor"]
            self.assertEqual(len(editors), 3)
            self.assertTrue(all(run["purpose"] == "prompt-edit" for run in editors))
            audits = list((root / identity(data)).rglob("instruction-comparison.json"))
            self.assertEqual(len(audits), 1)
            self.assertEqual(
                json.loads(audits[0].read_bytes())["change"], "NO_INSTRUCTION_CHANGE"
            )

    def test_rejected_changed_instruction_remains_available_for_reflection(self):
        data = study()
        storage, cli = MemoryStorage(), NativeCLI()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            calls = Calls(data, root, storage, cli, lambda: 1000)
            adapter = Adapter(data, root, calls)
            context = root / "reflection"
            for relative, instructions in (
                ("base_harness", data["baseline"]),
                ("harness", data["baseline"]),
                ("pool/rejected/harness", {"entry": "A rejected instruction edit."}),
            ):
                path = context / relative
                path.mkdir(parents=True)
                (path / "instructions.json").write_bytes(encode(instructions))
            (context / "task.md").write_text(adapter.task_prompt("development"))
            reply = Editor(adapter).call(
                "Reflect on all compared edits.", context, "reflection"
            )
            self.assertEqual(reply.attempts, 1)
            self.assertEqual(len(cli.requests), 1)
            self.assertEqual(cli.requests[0][1]["purpose"], "reflection")
            audit = json.loads((context / "instruction-comparison.json").read_bytes())
            self.assertEqual(audit["change"], "INSTRUCTION_CHANGES_PRESENT")
            self.assertEqual(len(audit["comparedInstructions"]), 2)

    def test_ambiguous_jev_probe_is_never_retransmitted(self):
        storage, cli = MemoryStorage(), NativeCLI(fail_probe=True)
        with tempfile.TemporaryDirectory() as directory:
            calls = Calls(study(), Path(directory), storage, cli, lambda: 1000)
            prompt = json.dumps(study()["baseline"])
            with self.assertRaisesRegex(RuntimeError, "ambiguous"):
                calls.call("development", "probe", prompt)
            restarted = Calls(study(), Path(directory), storage, cli, lambda: 1001)
            with self.assertRaisesRegex(ValueError, "cannot be retransmitted"):
                restarted.call("development", "probe", prompt)
            self.assertEqual(len(cli.requests), 1)

    def test_budget_counts_native_candidate_calls_and_time_is_bounded(self):
        data = study()
        data["tasks"][0]["observation"]["manifest"]["candidateSymbols"] = [
            "BTC/USD",
            "ETH/USD",
            "SOL/USD",
        ]
        storage, cli = MemoryStorage(), NativeCLI()
        with tempfile.TemporaryDirectory() as directory:
            calls = Calls(data, Path(directory), storage, cli, lambda: 1000)
            for index in range(5):
                calls.call("development", str(index), json.dumps(data["baseline"]))
            with self.assertRaisesRegex(ValueError, "model-call budget"):
                calls.call("development", "excess", json.dumps(data["baseline"]))
            expired = Calls(data, Path(directory), storage, cli, lambda: 2800)
            with self.assertRaisesRegex(ValueError, "wall-time budget"):
                expired.call("development", "late", json.dumps(data["baseline"]))

    def test_rejects_factor_studies_leakage_extra_editable_fields_and_changed_resume(
        self,
    ):
        for changed in (
            {**study(), "schemaVersion": "bayn.harness2-study.v1"},
            {**study(), "validation": study()["tasks"]},
            {**study(), "baseline": {**study()["baseline"], "tools": "execute"}},
        ):
            with self.assertRaises(ValueError):
                validate_study(changed)
        storage, cli = MemoryStorage(), NativeCLI()
        with tempfile.TemporaryDirectory() as directory:
            calls = Calls(study(), Path(directory), storage, cli, lambda: 1000)
            calls.call("development", "probe", json.dumps(study()["baseline"]))
            with self.assertRaisesRegex(ValueError, "changed its input"):
                calls.call(
                    "development",
                    "probe",
                    json.dumps({**study()["baseline"], "entry": "Changed."}),
                )

    def test_changed_or_missing_decisions_do_not_become_improvement(self):
        base = {"outcome": "COMPLETE", "decision": {"selected": []}}
        candidate = {
            "outcome": "COMPLETE",
            "decision": {"selected": [{"symbol": "BTC/USD"}]},
        }
        result = compare_decisions([{"baseline": base, "candidate": candidate}])
        self.assertEqual(result["changedDecisions"], 1)
        self.assertEqual(result["decisionImprovement"], "INCONCLUSIVE")
        result = compare_decisions(
            [{"baseline": base, "candidate": {"outcome": "INCONCLUSIVE"}}]
        )
        self.assertEqual(result["completePairs"], 0)
        self.assertEqual(result["economicImprovement"], "UNPROVEN")


if __name__ == "__main__":
    unittest.main()
