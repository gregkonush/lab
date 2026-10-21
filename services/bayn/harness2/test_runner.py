import copy
import json
import tempfile
import unittest
from pathlib import Path

from runner import Calls, compare_decisions, encode, identity, run_study, validate_study


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
            "stopLoss": "Choose an observed invalidation price.",
            "takeProfit": "Choose an observed profit price.",
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
                text = (
                    "<harness>"
                    + json.dumps(candidate)
                    + "</harness><notes>Clarified the time horizon.</notes>"
                )
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
                    run["schemaVersion"] == "bayn.jev-harness2-editor.v1"
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
