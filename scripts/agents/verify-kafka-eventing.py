#!/usr/bin/env python3
"""Verify Kafka event projection and durable rejected-event delivery."""

import argparse
import base64
import hashlib
import json
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


def http_json(url, payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}
    )
    try:
        response = urllib.request.urlopen(request, timeout=15)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        body = response.read()
        return response.status, json.loads(body) if body else None


def kubectl(context, namespace, *arguments):
    result = subprocess.run(
        ["kubectl", "--context", context, "-n", namespace, *arguments],
        check=True,
        capture_output=True,
        text=True,
        timeout=25,
    )
    return json.loads(result.stdout)


def messages(base_url, topic):
    query = urllib.parse.urlencode(
        {"mode": "LATEST", "limit": 100, "valueSerde": "String"}
    )
    url = f"{base_url}/api/clusters/kafka/topics/{topic}/messages/v2?{query}"
    with urllib.request.urlopen(url, timeout=20) as response:
        for line in response:
            if line.startswith(b"data:"):
                event = json.loads(line[5:])
                if event.get("type") == "MESSAGE":
                    yield event["message"]


def publish(base_url, marker, event_type, payload):
    status, _ = http_json(
        f"{base_url}/api/clusters/kafka/topics/github.webhook.events/messages",
        {
            "partition": 0,
            "key": marker,
            "value": json.dumps(payload),
            "headers": {
                "x-github-event": event_type,
                "x-github-delivery": marker,
                "content-type": "application/json",
            },
            "keySerde": "String",
            "valueSerde": "String",
        },
    )
    if status != 200:
        raise RuntimeError(f"Kafka probe publication returned HTTP {status}")


def sql(args, statement, run_id):
    result = subprocess.run(
        [
            "kubectl",
            "--context",
            args.context,
            "-n",
            "agents",
            "exec",
            "-i",
            args.database_pod,
            "--",
            "psql",
            "-X",
            "-qAt",
            "-v",
            "ON_ERROR_STOP=1",
            "-U",
            "postgres",
            "-d",
            "agents",
            "-v",
            f"run_id={run_id}",
        ],
        input=statement,
        text=True,
        capture_output=True,
        check=True,
        timeout=25,
    )
    return result.stdout.strip()


def verify_probes(args):
    run_id = str(uuid.uuid4())
    marker = f"eventing-proof-{run_id}"
    commit = hashlib.sha256(marker.encode()).hexdigest()[:40]
    repository = "codex-verification/eventing-proof"
    sql(
        args,
        f"""INSERT INTO agents_codex.runs
          (id, repository, issue_number, branch, attempt, agent_run_name,
           agent_run_namespace, status, commit_sha, ci_status)
        VALUES (:'run_id', '{repository}', 0, '{marker}', 1, '{marker}',
                'agents', 'run_complete', '{commit}', 'pending');""",
        run_id,
    )
    try:
        publish(
            args.kafka_ui_url,
            marker,
            "check_run",
            {
                "repository": {"full_name": repository},
                "check_run": {
                    "head_sha": commit,
                    "status": "completed",
                    "conclusion": "success",
                    "pull_requests": [],
                },
            },
        )
        publish(
            args.kafka_ui_url,
            marker,
            "codex_eventing_retention_probe",
            {"event": "codex_eventing_retention_probe", "verificationId": marker},
        )
        deadline = time.monotonic() + 180
        projected = False
        retained = False
        while time.monotonic() < deadline:
            projected = (
                sql(
                    args,
                    "SELECT ci_status FROM agents_codex.runs WHERE id = :'run_id';",
                    run_id,
                )
                == "success"
            )
            for message in messages(
                args.kafka_ui_url, "agents.codex.github.events.dlq"
            ):
                value = json.loads(message["value"])
                data = value.get("data")
                if "data_base64" in value:
                    data = json.loads(base64.b64decode(value["data_base64"]))
                if isinstance(data, dict) and data.get("verificationId") == marker:
                    retained = True
            if projected and retained:
                print("PASS Kafka check_run updated the temporary Codex projection")
                print("PASS rejected Kafka event is retained in the dead-letter topic")
                return
            time.sleep(5)
        raise RuntimeError(
            f"Kafka proof timed out: projection_updated={projected}, rejected_event_retained={retained}"
        )
    finally:
        sql(args, "DELETE FROM agents_codex.runs WHERE id = :'run_id';", run_id)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--context", required=True)
    parser.add_argument(
        "--agents-url", default="http://agents.agents.svc.cluster.local"
    )
    parser.add_argument(
        "--kafka-ui-url", default="http://kafka-ui.kafka.svc.cluster.local"
    )
    parser.add_argument("--database-pod", default="agents-db-next-1")
    parser.add_argument(
        "--publish-probes",
        action="store_true",
        help="Publish synthetic Kafka events and create/delete one temporary Codex projection",
    )
    args = parser.parse_args()
    source = kubectl(
        args.context,
        "agents",
        "get",
        "--raw=/apis/sources.knative.dev/v1beta1/namespaces/agents/kafkasources/agents-codex-github-events",
        "--request-timeout=20s",
    )
    if (
        source["spec"]
        .get("delivery", {})
        .get("deadLetterSink", {})
        .get("ref", {})
        .get("name")
        != "agents-codex-github-events-dlq"
    ):
        raise RuntimeError("KafkaSource does not target the durable dead-letter sink")
    sink = kubectl(
        args.context,
        "agents",
        "get",
        "kafkasink",
        "agents-codex-github-events-dlq",
        "-o",
        "json",
        "--request-timeout=20s",
    )
    if not any(
        c["type"] == "Ready" and c["status"] == "True"
        for c in sink.get("status", {}).get("conditions", [])
    ):
        raise RuntimeError("Kafka dead-letter sink is not Ready")
    print("PASS KafkaSource conversion webhook and dead-letter sink are available")
    status, response = http_json(
        f"{args.agents_url}/v1/codex/github-events", {"workflow_run": {"id": 0}}
    )
    if status != 202 or response.get("ignored") is not True:
        raise RuntimeError(
            f"Workflow event was not acknowledged as ignored: HTTP {status}"
        )
    status, _ = http_json(f"{args.agents_url}/v1/codex/github-events", {})
    if status != 422:
        raise RuntimeError(f"Missing event metadata was not rejected: HTTP {status}")
    print(
        "PASS irrelevant workflow events are acknowledged and missing metadata is rejected"
    )
    if args.publish_probes:
        verify_probes(args)


if __name__ == "__main__":
    main()
