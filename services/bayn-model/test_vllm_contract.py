"""Run in the pinned serving image without a GPU or checkpoint downloads."""

import asyncio
import io
import unittest
from contextlib import redirect_stdout

import httpx
from fastapi import FastAPI, Request
from starlette.responses import StreamingResponse
from pathlib import Path
from unittest.mock import patch

from vllm.entrypoints.cli.serve import ServeSubcommand
from vllm.entrypoints.openai.chat_completion.protocol import DeltaMessage
from vllm.entrypoints.serve.utils.api_utils import with_cancellation
from vllm.utils.argparse_utils import FlexibleArgumentParser

from admission import AdmissionMiddleware
from runtime import read_lock, server_args


class ServingContractTest(unittest.TestCase):
    def test_stream_reasoning_field_matches_the_research_decoder(self):
        delta = DeltaMessage(reasoning="fixture reasoning")
        self.assertEqual(
            delta.model_dump(exclude_none=True)["reasoning"], "fixture reasoning"
        )

    def test_actual_vllm_parser_accepts_the_locked_launch_profile(self):
        lock = read_lock(Path(__file__).with_name("model-lock.json"))
        parser = FlexibleArgumentParser()
        ServeSubcommand().subparser_init(parser.add_subparsers())
        args = parser.parse_args(server_args(lock, Path("/models")))
        self.assertEqual(args.model_tag, f"/models/{lock['revision']}")
        self.assertEqual(args.served_model_name, [lock["servedModel"]])
        self.assertEqual(args.api_server_count, 1)
        self.assertTrue(args.enable_chunked_prefill)
        self.assertEqual(args.max_num_seqs, 1)
        self.assertEqual(args.max_model_len, 32768)
        self.assertEqual(args.override_generation_config["max_new_tokens"], 4096)
        self.assertEqual(args.middleware, ["admission.AdmissionMiddleware"])
        self.assertIsNone(args.collect_detailed_traces)
        self.assertTrue(args.otlp_traces_endpoint.endswith(":4318/v1/traces"))
        self.assertFalse(args.trust_remote_code)
        self.assertFalse(args.enable_log_requests)
        self.assertFalse(args.enable_log_outputs)
        self.assertTrue(args.disable_uvicorn_access_log)
        self.assertTrue(args.enable_force_include_usage)
        self.assertEqual(AdmissionMiddleware.__name__, "AdmissionMiddleware")


class RealAsgiContractTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        image = patch.dict(
            "os.environ", {"BAYN_MODEL_SERVING_IMAGE": "sha256:" + "1" * 64}
        )
        image.start()
        self.addCleanup(image.stop)

    async def test_vllm_disconnect_precedes_framework_null_response(self):
        app = FastAPI()
        entered = asyncio.Event()
        stopped = asyncio.Event()
        delivered = False
        messages = []

        @app.post("/v1/chat/completions")
        @with_cancellation
        async def chat(payload: dict, raw_request: Request):
            entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                stopped.set()

        async def receive():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {
                    "type": "http.request",
                    "body": b'{"stream":true}',
                    "more_body": False,
                }
            await entered.wait()
            return {"type": "http.disconnect"}

        async def send(message):
            messages.append(message)

        middleware = AdmissionMiddleware(app)
        with redirect_stdout(io.StringIO()):
            await middleware(
                {
                    "type": "http",
                    "asgi": {"version": "3.0", "spec_version": "2.3"},
                    "http_version": "1.1",
                    "method": "POST",
                    "path": "/v1/chat/completions",
                    "query_string": b"",
                    "headers": [(b"content-type", b"application/json")],
                },
                receive,
                send,
            )
            await asyncio.wait_for(stopped.wait(), timeout=1)
        self.assertEqual(messages[-1]["body"], b"null")
        self.assertEqual(middleware.inflight, 0)
        self.assertEqual(middleware.counts["cancelled"], 1)
        self.assertEqual(middleware.counts["completed"], 0)

    async def test_stream_disconnect_records_cancellation_after_backend_cleanup(self):
        await self.assert_stream_stops(disconnect=True)

    async def test_stream_deadline_cancels_native_framework_generation(self):
        await self.assert_stream_stops(disconnect=False)

    async def assert_stream_stops(self, disconnect):
        app = FastAPI()
        streamed = asyncio.Event()
        stopped = asyncio.Event()
        delivered = False

        async def chunks():
            try:
                yield b"partial"
                await asyncio.Event().wait()
            finally:
                stopped.set()

        @app.post("/v1/chat/completions")
        @with_cancellation
        async def chat(payload: dict, raw_request: Request):
            return StreamingResponse(chunks())

        async def receive():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {
                    "type": "http.request",
                    "body": b'{"stream":true}',
                    "more_body": False,
                }
            if disconnect:
                await streamed.wait()
                return {"type": "http.disconnect"}
            await asyncio.Event().wait()

        async def send(message):
            if message["type"] == "http.response.body":
                streamed.set()

        middleware = AdmissionMiddleware(app)
        with (
            redirect_stdout(io.StringIO()),
            # FastAPI builds its first route schema inside the request deadline.
            patch("admission.REQUEST_TIMEOUT_SECONDS", 180 if disconnect else 1),
        ):
            await middleware(
                {
                    "type": "http",
                    "asgi": {"version": "3.0", "spec_version": "2.3"},
                    "http_version": "1.1",
                    "method": "POST",
                    "path": "/v1/chat/completions",
                    "query_string": b"",
                    "headers": [(b"content-type", b"application/json")],
                },
                receive,
                send,
            )
            self.assertTrue(
                streamed.is_set(), "Deadline must interrupt active streaming"
            )
            await asyncio.wait_for(stopped.wait(), timeout=1)
        self.assertEqual(middleware.inflight, 0)
        self.assertEqual(middleware.counts["cancelled" if disconnect else "expired"], 1)
        self.assertEqual(middleware.counts["completed"], 0)

    async def test_real_framework_enforces_budgets_before_route_handling(self):
        app = FastAPI()
        app.add_middleware(AdmissionMiddleware)
        seen = []

        @app.post("/v1/chat/completions")
        async def chat(request: Request):
            seen.append(await request.json())
            return {"ok": True}

        with redirect_stdout(io.StringIO()):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://fixture"
            ) as client:
                for body, status in [
                    (b"x" * 262145, 413),
                    (b'{"stream":true,"n":2}', 400),
                    (b"{}", 400),
                    (b'{"stream":false}', 400),
                    (b'{"stream":true}', 200),
                ]:
                    response = await client.post("/v1/chat/completions", content=body)
                    self.assertEqual(response.status_code, status)
        self.assertEqual(seen, [{"stream": True}])


if __name__ == "__main__":
    unittest.main()
