import asyncio
import io
import json
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

from admission import AdmissionMiddleware, MAX_BODY_BYTES, respond

SCOPE = {
    "type": "http",
    "method": "POST",
    "path": "/v1/chat/completions",
    "headers": [],
}


async def empty_receive():
    return {"type": "http.request", "body": b'{"stream":true}'}


class AdmissionTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        image = patch.dict(
            "os.environ", {"BAYN_MODEL_SERVING_IMAGE": "sha256:" + "1" * 64}
        )
        image.start()
        self.addCleanup(image.stop)
        self.output = io.StringIO()
        context = redirect_stdout(self.output)
        context.__enter__()
        self.addCleanup(context.__exit__, None, None, None)

    async def test_serving_attestation_is_bound_to_verified_lock_and_image(self):
        async def backend(scope, receive, send):
            await send(
                {
                    "type": "http.response.start",
                    "status": 200,
                    "headers": [
                        (b"x-bayn-serving-identity", b"untrusted-backend-value")
                    ],
                }
            )
            await send({"type": "http.response.body", "body": b"{}"})

        app = AdmissionMiddleware(backend)
        messages = await self.request(app)
        headers = messages[0]["headers"]
        self.assertEqual(
            sum(key == b"x-bayn-serving-identity" for key, _ in headers), 1
        )
        self.assertEqual(
            json.loads(dict(headers)[b"x-bayn-serving-identity"]),
            {
                "model": app.lock["servedModel"],
                "checkpoint": app.lock["revision"],
                "servingImage": "sha256:" + "1" * 64,
                "tokenizerRevision": app.lock["revision"],
                "chatTemplateRevision": app.lock["revision"],
            },
        )
        with patch.dict("os.environ", {"BAYN_MODEL_SERVING_IMAGE": "moving-tag"}):
            with self.assertRaisesRegex(ValueError, "immutable digest"):
                AdmissionMiddleware(backend)

    async def request(self, app, scope=SCOPE, receive=empty_receive):
        messages = []

        async def send(message):
            messages.append(message)

        await app(scope, receive, send)
        return messages

    async def test_overload_rejects_immediately_and_health_bypasses_slots(self):
        release = asyncio.Event()
        entered = asyncio.Queue()

        async def backend(scope, receive, send):
            if scope["method"] == "POST":
                await entered.put(True)
                await release.wait()
            await respond(send, 200, b"{}")

        app = AdmissionMiddleware(backend)
        first = asyncio.create_task(self.request(app))
        await entered.get()
        second = asyncio.create_task(self.request(app))
        await entered.get()
        third = await self.request(app)
        self.assertEqual(third[0]["status"], 429)
        self.assertEqual(app.inflight, 2)
        health = await self.request(app, {**SCOPE, "method": "GET", "path": "/health"})
        self.assertEqual(health[0]["status"], 200)
        release.set()
        await asyncio.gather(first, second)
        self.assertEqual(app.inflight, 0)
        self.assertEqual(app.counts["completed"], 2)
        self.assertEqual(app.counts["rejected"], 1)

    async def test_deadline_cancels_backend_before_releasing_capacity(self):
        cancelled = asyncio.Event()

        async def backend(scope, receive, send):
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        app = AdmissionMiddleware(backend)
        with patch("admission.REQUEST_TIMEOUT_SECONDS", 0.01):
            messages = await self.request(app)
        self.assertTrue(cancelled.is_set())
        self.assertEqual(messages[0]["status"], 504)
        self.assertEqual(app.inflight, 0)
        self.assertEqual(app.counts["expired"], 1)

    async def test_stream_deadline_does_not_send_a_second_status(self):
        async def backend(scope, receive, send):
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send(
                {"type": "http.response.body", "body": b"partial", "more_body": True}
            )
            await asyncio.Event().wait()

        app = AdmissionMiddleware(backend)
        with patch("admission.REQUEST_TIMEOUT_SECONDS", 0.01):
            messages = await self.request(app)
        self.assertEqual(sum(m["type"] == "http.response.start" for m in messages), 1)
        self.assertFalse(messages[-1]["more_body"])
        self.assertEqual(app.counts["expired"], 1)

    async def test_chunked_body_is_bounded_before_backend_generation(self):
        async def backend(scope, receive, send):
            self.fail("Oversized body reached generation")

        async def receive():
            return {
                "type": "http.request",
                "body": b"x" * (MAX_BODY_BYTES // 2 + 1),
                "more_body": True,
            }

        app = AdmissionMiddleware(backend)
        messages = await self.request(app, receive=receive)
        self.assertEqual(messages[0]["status"], 413)
        self.assertEqual(app.counts["too_large"], 1)
        self.assertEqual(app.inflight, 0)

    async def test_disconnected_upload_releases_capacity_without_generation(self):
        async def backend(scope, receive, send):
            self.fail("Disconnected upload reached generation")

        async def receive():
            return {"type": "http.disconnect"}

        app = AdmissionMiddleware(backend)
        messages = await self.request(app, receive=receive)
        self.assertEqual(messages, [])
        self.assertEqual(app.inflight, 0)
        self.assertEqual(app.counts["cancelled"], 1)

    async def test_caller_cancellation_propagates_and_releases_slot(self):
        entered = asyncio.Event()

        async def backend(scope, receive, send):
            entered.set()
            await asyncio.Event().wait()

        app = AdmissionMiddleware(backend)
        task = asyncio.create_task(self.request(app))
        await entered.wait()
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertEqual(app.counts["cancelled"], 1)
        self.assertEqual(app.inflight, 0)

    async def test_metrics_are_available_during_load_and_request_logs_are_sanitized(
        self,
    ):
        async def backend(scope, receive, send):
            await respond(send, 400, b"{}")

        app = AdmissionMiddleware(backend)
        await self.request(
            app, {**SCOPE, "headers": [(b"x-request-id", b"private-prompt")]}
        )
        metrics = await self.request(
            app, {**SCOPE, "method": "GET", "path": "/admission/metrics"}
        )
        self.assertIn(b'outcome="failed"} 1', metrics[-1]["body"])
        self.assertNotIn("private-prompt", self.output.getvalue())
        self.assertEqual(app.inflight, 0)

    async def test_multi_choice_logprob_and_oversized_output_work_never_reaches_engine(
        self,
    ):
        async def backend(scope, receive, send):
            self.fail("Out-of-budget work reached the engine")

        import json

        for payload in [
            {},
            {"stream": False},
            {"stream": 1},
            {"stream": True, "n": 2},
            {"stream": True, "n": True},
            {"stream": True, "logprobs": True},
            {"stream": True, "prompt_logprobs": 1},
            {"stream": True, "max_tokens": 4097},
            {"stream": True, "max_completion_tokens": 4097},
            [],
            "invalid",
        ]:

            async def receive():
                return {"type": "http.request", "body": json.dumps(payload).encode()}

            with self.subTest(payload=payload):
                app = AdmissionMiddleware(backend)
                messages = await self.request(app, receive=receive)
                self.assertEqual(messages[0]["status"], 400)
                self.assertEqual(app.counts["failed"], 1)
                self.assertEqual(app.inflight, 0)

    async def test_unknown_generation_and_model_management_routes_are_closed(self):
        async def backend(scope, receive, send):
            self.fail("Unsupported endpoint reached vLLM")

        app = AdmissionMiddleware(backend)
        for path in ["/v1/completions", "/v1/load_lora_adapter", "/v1/responses"]:
            result = await self.request(app, {**SCOPE, "path": path})
            self.assertEqual(result[0]["status"], 404)


if __name__ == "__main__":
    unittest.main()
