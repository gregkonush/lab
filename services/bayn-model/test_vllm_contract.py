"""Run in the pinned serving image without a GPU or checkpoint downloads."""

import asyncio
import io
import unittest
from contextlib import redirect_stdout

import httpx
from fastapi import FastAPI, Request
from starlette.responses import StreamingResponse
from pathlib import Path

from vllm.entrypoints.cli.serve import ServeSubcommand
from vllm.utils.argparse_utils import FlexibleArgumentParser

from admission import AdmissionMiddleware
from runtime import read_lock, server_args


class ServingContractTest(unittest.TestCase):
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
        self.assertEqual(args.max_model_len, 16384)
        self.assertEqual(args.override_generation_config["max_new_tokens"], 4096)
        self.assertEqual(args.middleware, ["admission.AdmissionMiddleware"])
        self.assertIsNone(args.collect_detailed_traces)
        self.assertTrue(args.otlp_traces_endpoint.endswith(":4318/v1/traces"))
        self.assertFalse(args.trust_remote_code)
        self.assertFalse(args.enable_log_requests)
        self.assertFalse(args.enable_log_outputs)
        self.assertTrue(args.disable_uvicorn_access_log)
        self.assertEqual(AdmissionMiddleware.__name__, "AdmissionMiddleware")


class RealAsgiContractTest(unittest.IsolatedAsyncioTestCase):
    async def test_stream_disconnect_records_cancellation_after_backend_cleanup(self):
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
        async def chat():
            return StreamingResponse(chunks())

        async def receive():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": b"{}", "more_body": False}
            await streamed.wait()
            return {"type": "http.disconnect"}

        async def send(message):
            if message["type"] == "http.response.body":
                streamed.set()

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
                    "headers": [],
                },
                receive,
                send,
            )
        self.assertTrue(stopped.is_set())
        self.assertEqual(middleware.inflight, 0)
        self.assertEqual(middleware.counts["cancelled"], 1)
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
                    (b'{"n":2}', 400),
                    (b"{}", 200),
                ]:
                    response = await client.post("/v1/chat/completions", content=body)
                    self.assertEqual(response.status_code, status)
        self.assertEqual(seen, [{}])


if __name__ == "__main__":
    unittest.main()
