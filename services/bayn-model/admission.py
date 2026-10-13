"""Bound research HTTP work inside the single vLLM API process."""

import asyncio
import hashlib
import json
import os
import re
import time
import uuid
from pathlib import Path

from runtime import read_lock

MAX_INFLIGHT = 2
MAX_BODY_BYTES = 262144
MAX_OUTPUT_TOKENS = 4096
REQUEST_TIMEOUT_SECONDS = 180
OUTCOMES = ("completed", "rejected", "expired", "cancelled", "failed", "too_large")


class BodyTooLarge(Exception):
    pass


async def respond(send, status, body, content_type=b"application/json"):
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [(b"content-type", content_type)],
        }
    )
    await send({"type": "http.response.body", "body": body})


class AdmissionMiddleware:
    def __init__(self, app):
        self.app = app
        self.lock = read_lock(Path(__file__).with_name("model-lock.json"))
        image = os.environ["BAYN_MODEL_SERVING_IMAGE"]
        if not re.fullmatch(r"sha256:[0-9a-f]{64}", image):
            raise ValueError("Serving image must be an immutable digest")
        self.identity = json.dumps(
            {
                "model": self.lock["servedModel"],
                "checkpoint": self.lock["revision"],
                "servingImage": image,
                "tokenizerRevision": self.lock["revision"],
                "chatTemplateRevision": self.lock["revision"],
            },
            separators=(",", ":"),
        ).encode()
        self.inflight = 0
        self.counts = dict.fromkeys(OUTCOMES, 0)
        self.duration_seconds = 0.0

    def metrics(self):
        lines = [
            "# TYPE bayn_model_inflight gauge",
            f"bayn_model_inflight {self.inflight}",
            "# TYPE bayn_model_requests_total counter",
            *[
                f'bayn_model_requests_total{{outcome="{key}"}} {value}'
                for key, value in self.counts.items()
            ],
            "# TYPE bayn_model_request_duration_seconds_sum counter",
            f"bayn_model_request_duration_seconds_sum {self.duration_seconds}",
        ]
        return ("\n".join(lines) + "\n").encode()

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path, method = scope["path"], scope["method"]
        if method == "GET" and path == "/admission/metrics":
            await respond(send, 200, self.metrics(), b"text/plain; version=0.0.4")
            return
        if method == "GET" and path in ("/health", "/metrics", "/v1/models"):
            await self.app(scope, receive, send)
            return
        if method != "POST" or path != "/v1/chat/completions":
            await respond(send, 404, b'{"error":"unsupported research endpoint"}')
            return
        if self.inflight >= MAX_INFLIGHT:
            self.counts["rejected"] += 1
            await respond(send, 429, b'{"error":"research capacity exhausted"}')
            return

        # One event loop and one API process make admission atomic before any await.
        self.inflight += 1
        request_id = uuid.uuid4().hex
        started = time.monotonic()
        outcome, status, response_started, response_finished = (
            "failed",
            500,
            False,
            False,
        )
        body_bytes = 0
        disconnected = False
        request_hash = None
        traceparent = dict(scope.get("headers", [])).get(b"traceparent", b"")
        trace = re.fullmatch(
            rb"00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}", traceparent
        )
        trace_id = (
            trace.group(1).decode()
            if trace and trace.group(1) != b"0" * 32 and trace.group(2) != b"0" * 16
            else None
        )
        scope = {
            **scope,
            "headers": [
                (key, value)
                for key, value in scope.get("headers", [])
                if key != b"x-request-id"
            ]
            + [(b"x-request-id", request_id.encode())],
        }

        async def observed_send(message):
            nonlocal status, response_started, response_finished
            if message["type"] == "http.response.start":
                status, response_started = message["status"], True
                message = {
                    **message,
                    "headers": [
                        (key, value)
                        for key, value in message.get("headers", [])
                        if key.lower() != b"x-bayn-serving-identity"
                    ]
                    + [(b"x-bayn-serving-identity", self.identity)],
                }
            if message["type"] == "http.response.body" and not message.get(
                "more_body", False
            ):
                response_finished = True
            await send(message)

        try:
            async with asyncio.timeout(REQUEST_TIMEOUT_SECONDS):
                buffered_body = bytearray()
                while True:
                    message = await receive()
                    if message["type"] == "http.disconnect":
                        outcome, status = "cancelled", 499
                        return
                    block = message.get("body", b"")
                    body_bytes += len(block)
                    if body_bytes > MAX_BODY_BYTES:
                        raise BodyTooLarge
                    buffered_body.extend(block)
                    if not message.get("more_body", False):
                        break
                request_hash = hashlib.sha256(buffered_body).hexdigest()
                try:
                    payload = json.loads(buffered_body)
                except (ValueError, UnicodeDecodeError):
                    payload = None
                invalid = not isinstance(payload, dict)
                if not invalid:
                    invalid = (
                        payload.get("stream") is not True
                        or type(payload.get("n", 1)) is not int
                        or payload.get("n", 1) != 1
                    )
                    invalid = invalid or payload.get("logprobs", False) not in (
                        False,
                        None,
                    )
                    invalid = invalid or payload.get("prompt_logprobs") is not None
                    for name in ("max_tokens", "max_completion_tokens"):
                        value = payload.get(name)
                        invalid = invalid or (
                            value is not None
                            and (
                                type(value) is not int
                                or not 1 <= value <= MAX_OUTPUT_TOKENS
                            )
                        )
                if invalid:
                    status = 400
                    await respond(
                        send,
                        status,
                        b'{"error":"expected streaming, one choice, no logprobs and at most 4096 output tokens"}',
                    )
                    return
                buffered_body = bytes(buffered_body)
                delivered = False

                async def buffered_receive():
                    nonlocal delivered, disconnected
                    if not delivered:
                        delivered = True
                        return {
                            "type": "http.request",
                            "body": buffered_body,
                            "more_body": False,
                        }
                    message = await receive()
                    if message["type"] == "http.disconnect" and not response_finished:
                        disconnected = True
                    return message

                await self.app(scope, buffered_receive, observed_send)
            if disconnected:
                outcome = "cancelled"
                if not response_started:
                    status = 499
            else:
                outcome = "completed" if status < 400 else "failed"
        except (TimeoutError, BodyTooLarge) as error:
            outcome, error_status = (
                ("expired", 504)
                if isinstance(error, TimeoutError)
                else ("too_large", 413)
            )
            if not response_started:
                status = error_status
                await respond(send, status, json.dumps({"error": outcome}).encode())
            elif not response_finished:
                # End an already-started stream. Its incomplete generation is unusable.
                await send(
                    {"type": "http.response.body", "body": b"", "more_body": False}
                )
        except asyncio.CancelledError:
            outcome = "cancelled"
            if not response_started:
                status = 499
            raise
        finally:
            elapsed = time.monotonic() - started
            self.inflight -= 1
            self.counts[outcome] += 1
            self.duration_seconds += elapsed
            print(
                json.dumps(
                    {
                        "event": "bayn.model.request",
                        "model": self.lock["servedModel"],
                        "model_revision": self.lock["revision"],
                        "request_hash": request_hash,
                        "request_id": request_id,
                        "trace_id": trace_id,
                        "outcome": outcome,
                        "status": status,
                        "duration_ms": round(elapsed * 1000, 3),
                    }
                ),
                flush=True,
            )
