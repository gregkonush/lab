import copy
import json
import tempfile
import unittest
from pathlib import Path

from runner import Adapter, Calls, identity, run_study, validate_study


def study():
    return {
        "schemaVersion": "bayn.harness2-study.v1",
        "maximumCalls": 12,
        "maximumWallSeconds": 1800,
        "tasks": [
            {
                "id": "engineering-only",
                "run": {
                    "schemaVersion": "bayn.research-run.v1",
                    "costBasis": None,
                    "promptTemplate": "Select factors from the supplied evidence.",
                    "featureCutoff": "1970-01-01T00:00:00.000Z",
                    "context": {
                        "factors": [
                            {"id": "alpha001", "description": "Engineering fixture"}
                        ]
                    },
                },
            }
        ],
    }


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


class ResearchCLI:
    def __init__(self, outcome="COMPLETE", cost="1000", bad_editor=False):
        self.requests = []
        self.outcome, self.cost, self.bad_editor = outcome, cost, bad_editor

    def __call__(self, args, timeout):
        if args[0] == "--validate":
            return
        run = json.loads(Path(args[1]).read_text())
        if run["promptTemplate"] != run["promptTemplate"].strip():
            raise RuntimeError("Bayn rejects surrounding prompt whitespace")
        self.requests.append(run)
        prompt = run["promptTemplate"]
        content = "<alpha_list>alpha001</alpha_list>"
        if "Return the complete revised" in prompt:
            if not self.bad_editor:
                content += "<harness>Compare available factor descriptions and abstain from invented returns.</harness><notes>Made the evidence boundary explicit.</notes>"
        elif "reflection format" in prompt:
            content += "<edits>component: systemprompt.md\nobserved: explicit evidence boundary</edits><experience>cue: future evidence is absent\nlesson: retain the evidence boundary\nevidence: systemprompt.md changed the instructions and both probes returned alpha001\nconfidence: limited to these probes</experience>"
        receipt = {
            "outcome": self.outcome,
            "responseText": content,
            "factors": ["alpha001"] if run.get("purpose") is None else [],
            "receiptHash": identity(run),
            "costPicoUsd": self.cost,
        }
        Path(args[3]).write_text(json.dumps(receipt))


class RunnerTests(unittest.TestCase):
    def test_real_upstream_recursion_retains_probes_and_library(self):
        storage, invoke = MemoryStorage(), ResearchCLI()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report = run_study(study(), root, storage, invoke, lambda: 1000)
            artifacts = root / identity(study())
            self.assertEqual(report["outcome"], "COMPLETE")
            self.assertEqual(report["modelCalls"], 8)
            self.assertEqual(report["costPicoUsd"], "8000")
            self.assertEqual(report["qualification"], "UNQUALIFIED")
            purposes = [request.get("purpose") for request in invoke.requests]
            self.assertEqual(purposes.count(None), 4)
            self.assertEqual(purposes.count("prompt-edit"), 3)
            self.assertEqual(purposes.count("reflection"), 1)
            self.assertTrue(list((artifacts / "library").rglob("EXPERIENCE.md")))
            summaries = list((artifacts / "runs").rglob("summary.json"))
            self.assertEqual(len(summaries), 1)
            summary = json.loads(summaries[0].read_text())
            self.assertEqual(summary["modes"]["seq"]["fell_back"], [])
            self.assertEqual(summary["modes"]["seq"]["finals"], ["c1"])
            self.assertIn("result.json", storage.values)
            self.assertTrue(
                any(key.startswith("artifacts/library/") for key in storage.values)
            )
            repeated = run_study(study(), root, storage, invoke, lambda: 1001)
            self.assertEqual(repeated, report)
            self.assertEqual(len(invoke.requests), 8)

    def test_recovery_uses_the_original_signed_registration(self):
        storage, invoke = MemoryStorage(), ResearchCLI()
        with tempfile.TemporaryDirectory() as directory:
            first = Calls(study(), Path(directory), storage, invoke, lambda: 1000)
            first.call("engineering-only", "probe", "Select factors")
            original = invoke.requests[0]
            del storage.values["receipts/0.json"]
            restarted = Calls(study(), Path(directory), storage, invoke, lambda: 1100)
            restarted.call("engineering-only", "probe", "Select factors")
            self.assertEqual(invoke.requests[1], original)
            self.assertEqual(
                len([key for key in storage.values if key.startswith("calls/")]), 1
            )
            with self.assertRaisesRegex(ValueError, "changed its input"):
                restarted.call("engineering-only", "probe", "Changed prompt")

    def test_ambiguous_receipt_never_becomes_a_new_attempt(self):
        storage, invoke = MemoryStorage(), ResearchCLI(outcome="AMBIGUOUS")
        with tempfile.TemporaryDirectory() as directory:
            calls = Calls(study(), Path(directory), storage, invoke, lambda: 1000)
            for _ in range(2):
                with self.assertRaisesRegex(ValueError, "incomplete"):
                    calls.call("engineering-only", "probe", "Select factors")
            self.assertEqual(len(invoke.requests), 2)
            self.assertEqual(invoke.requests[0], invoke.requests[1])

    def test_call_and_time_budgets_fail_closed(self):
        storage, invoke = MemoryStorage(), ResearchCLI()
        with tempfile.TemporaryDirectory() as directory:
            calls = Calls(study(), Path(directory), storage, invoke, lambda: 1000)
            for index in range(12):
                calls.call("engineering-only", str(index), "Select factors")
            with self.assertRaisesRegex(ValueError, "model-call budget"):
                calls.call("engineering-only", "excess", "Select factors")
            expired = Calls(study(), Path(directory), storage, invoke, lambda: 2800)
            with self.assertRaisesRegex(ValueError, "wall-time budget"):
                expired.call("engineering-only", "late", "Select factors")
            self.assertEqual(len(invoke.requests), 12)

    def test_unknown_cost_is_retained_and_bad_edits_are_inconclusive(self):
        with tempfile.TemporaryDirectory() as directory:
            report = run_study(
                study(),
                Path(directory),
                MemoryStorage(),
                ResearchCLI(cost=None),
                lambda: 1000,
            )
            self.assertIsNone(report["costPicoUsd"])
        with tempfile.TemporaryDirectory() as directory:
            report = run_study(
                study(),
                Path(directory),
                MemoryStorage(),
                ResearchCLI(bad_editor=True),
                lambda: 1000,
            )
            self.assertEqual(report["outcome"], "INCONCLUSIVE")

    def test_only_prompt_text_is_editable(self):
        with tempfile.TemporaryDirectory() as directory:
            adapter = Adapter(study(), Path(directory), None)
            for tree in (
                {"scripts/order.py": "place_order()"},
                {"systemprompt.md": ""},
                {"systemprompt.md": "x" * 8001},
            ):
                with self.assertRaises(ValueError):
                    adapter.validate_tree(tree)

    def test_rejected_reflection_is_retained_and_terminal_replay_does_no_work(self):
        class RejectedReflection(ResearchCLI):
            def __call__(self, args, timeout):
                if args[0] != "--validate":
                    run = json.loads(Path(args[1]).read_text())
                    if run.get("purpose") == "reflection":
                        self.outcome = "REJECTED"
                        self.cost = None
                super().__call__(args, timeout)

        storage, invoke = MemoryStorage(), RejectedReflection()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report = run_study(study(), root, storage, invoke, lambda: 1000)
            self.assertEqual(report["outcome"], "INCONCLUSIVE")
            self.assertEqual(report["modelCalls"], 8)
            self.assertIsNone(report["costPicoUsd"])
            self.assertEqual(len(report["receiptHashes"]), 8)
            self.assertEqual(storage.values["receipts/7.json"]["outcome"], "REJECTED")
            self.assertEqual(
                run_study(study(), root, storage, invoke, lambda: 1001), report
            )
            self.assertEqual(len(invoke.requests), 8)

    def test_studies_reject_editor_and_reflection_tasks_before_inference(self):
        for purpose in ("prompt-edit", "reflection"):
            value = study()
            value["tasks"][0]["run"].update(
                schemaVersion="bayn.harness2-inference.v1", purpose=purpose
            )
            with self.assertRaisesRegex(ValueError, "factor-selection registrations"):
                validate_study(value)

    def test_historical_costs_are_unknown_outside_their_actual_inference_interval(self):
        for end, covered in (
            ("1970-01-01T00:01:00.000Z", False),
            ("1970-01-01T01:00:00.000Z", True),
        ):
            value = study()
            basis = {
                "sourceEvidenceHash": "a" * 64,
                "effectiveFrom": "1970-01-01T00:00:00.000Z",
                "effectiveUntil": end,
                "allocation": "reserved-capacity-wall-time",
                "picoUsdPerSecond": "1000",
            }
            value["tasks"][0]["run"]["costBasis"] = basis
            invoke = ResearchCLI()
            with tempfile.TemporaryDirectory() as directory:
                calls = Calls(
                    value, Path(directory), MemoryStorage(), invoke, lambda: 1000
                )
                calls.call("engineering-only", "probe", "Select factors")
            self.assertEqual(
                invoke.requests[0]["costBasis"], basis if covered else None
            )
            self.assertEqual(value["tasks"][0]["run"]["costBasis"], basis)

    def test_concurrent_slot_winner_supplies_the_original_registration(self):
        class RacedStorage(MemoryStorage):
            def create(self, key, value):
                if key == "calls/0.json" and key not in self.values:
                    winner = copy.deepcopy(value)
                    winner["run"]["registeredAt"] = "1970-01-01T00:16:39.000Z"
                    self.values[key] = winner
                    return False
                return super().create(key, value)

        storage, invoke = RacedStorage(), ResearchCLI()
        with tempfile.TemporaryDirectory() as directory:
            calls = Calls(study(), Path(directory), storage, invoke, lambda: 1000)
            calls.call("engineering-only", "probe", "Select factors")
            self.assertEqual(invoke.requests[0], storage.values["calls/0.json"]["run"])
            self.assertNotIn("calls/1.json", storage.values)

    def test_cached_receipt_is_checked_against_native_workflow_evidence(self):
        storage, invoke = MemoryStorage(), ResearchCLI()
        with tempfile.TemporaryDirectory() as directory:
            calls = Calls(study(), Path(directory), storage, invoke, lambda: 1000)
            calls.call("engineering-only", "probe", "Select factors")
            storage.values["receipts/0.json"]["factors"] = ["alpha999"]
            with self.assertRaisesRegex(ValueError, "conflicts"):
                calls.call("engineering-only", "probe", "Select factors")

    def test_missing_receipt_keeps_cost_unknown_and_result_inconclusive(self):
        def unavailable(args, timeout):
            if args[0] != "--validate":
                raise RuntimeError("Transport unavailable")

        storage = MemoryStorage()
        with tempfile.TemporaryDirectory() as directory:
            report = run_study(
                study(), Path(directory), storage, unavailable, lambda: 1000
            )
            self.assertEqual(report["outcome"], "INCONCLUSIVE")
            self.assertEqual(report["modelCalls"], 1)
            self.assertIsNone(report["costPicoUsd"])
            self.assertEqual(report["receiptHashes"], [])

    def test_study_boundary_rejects_unknowns_duplicates_and_unbounded_work(self):
        good = study()
        self.assertEqual(validate_study(good), good)
        for bad in (
            {**good, "extra": True},
            {**good, "maximumCalls": 33},
            {**good, "maximumCalls": True},
            {**good, "maximumWallSeconds": 3601},
            {**good, "tasks": good["tasks"] * 2},
            {**good, "tasks": [{**good["tasks"][0], "id": "../../escape"}]},
        ):
            with self.assertRaises(ValueError):
                validate_study(bad)


if __name__ == "__main__":
    unittest.main()
