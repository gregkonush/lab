import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path
from urllib.request import urlopen


def read_lock(path):
    lock = json.loads(path.read_text())
    if not re.fullmatch(r"[\w-]+/[\w.-]+", lock["repository"]):
        raise ValueError("Invalid model repository")
    if not re.fullmatch(r"[0-9a-f]{40}", lock["revision"]):
        raise ValueError("Model revision must be immutable")
    names = set()
    for item in lock["files"]:
        name = item["name"]
        if not re.fullmatch(r"[\w-][\w.-]*", name) or name in names:
            raise ValueError("Invalid or duplicated model filename")
        if not re.fullmatch(r"[0-9a-f]{64}", item["sha256"]) or item["bytes"] <= 0:
            raise ValueError(f"Invalid file identity: {name}")
        names.add(name)
    if not names or not lock["servedModel"]:
        raise ValueError("Empty model lock")
    return lock


def verify_file(path, item):
    if path.stat().st_size != item["bytes"]:
        raise ValueError(f"Model file size mismatch: {item['name']}")
    with path.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if digest != item["sha256"]:
        raise ValueError(f"Model file digest mismatch: {item['name']}")


def prepare(lock, cache, fetch=urlopen):
    cache.mkdir(parents=True, exist_ok=True)
    revisions = [
        entry for entry in cache.iterdir() if re.fullmatch(r"[0-9a-f]{40}", entry.name)
    ]
    if any(entry.is_symlink() for entry in revisions):
        raise ValueError("Model checkpoint cache cannot contain symlinks")
    for entry in revisions:
        if entry.name != lock["revision"] and entry.is_dir():
            shutil.rmtree(entry)
    model = cache / lock["revision"]
    model.mkdir(parents=True, exist_ok=True)
    for item in lock["files"]:
        (model / f".download-{item['name']}").unlink(missing_ok=True)
    required = sum(
        item["bytes"] for item in lock["files"] if not (model / item["name"]).exists()
    )
    if shutil.disk_usage(cache).free < required + 2 * 1024**3:
        raise ValueError(
            "Insufficient model cache space for locked payload and 2 GiB runtime headroom"
        )
    for item in lock["files"]:
        path = model / item["name"]
        temporary = model / f".download-{item['name']}"
        temporary.unlink(missing_ok=True)
        if not path.exists():
            url = (
                f"https://huggingface.co/{lock['repository']}/resolve/"
                f"{lock['revision']}/{item['name']}"
            )
            try:
                with temporary.open("xb") as output:
                    with fetch(url, timeout=60) as response:
                        count = 0
                        while block := response.read(8 * 1024 * 1024):
                            count += len(block)
                            if count > item["bytes"]:
                                raise ValueError("Download exceeds locked size")
                            output.write(block)
                verify_file(temporary, item)
                temporary.replace(path)
            except Exception:
                raise ValueError(
                    f"Model download failed verification: {item['name']}"
                ) from None
            finally:
                temporary.unlink(missing_ok=True)
        else:
            verify_file(path, item)
        print(
            json.dumps({"verified": item["name"], "sha256": item["sha256"]}), flush=True
        )
    return model


def server_args(lock, cache):
    return [
        "serve",
        str(cache / lock["revision"]),
        "--served-model-name",
        lock["servedModel"],
        "--host",
        "0.0.0.0",
        "--port",
        "8080",
        "--dtype",
        "bfloat16",
        "--max-model-len",
        "32768",
        "--gpu-memory-utilization",
        "0.24",
        "--max-num-seqs",
        "1",
        "--max-num-batched-tokens",
        "2048",
        "--api-server-count",
        "1",
        "--enable-prefix-caching",
        "--enable-chunked-prefill",
        "--reasoning-parser",
        "qwen3",
        "--override-generation-config",
        '{"temperature":0,"max_new_tokens":4096}',
        "--otlp-traces-endpoint",
        "http://observability-tempo-distributor.observability.svc.cluster.local:4318/v1/traces",
        "--middleware",
        "admission.AdmissionMiddleware",
        "--enable-request-id-headers",
        "--enable-force-include-usage",
        "--disable-uvicorn-access-log",
        "--disable-fastapi-docs",
    ]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--lock", type=Path, default=Path(__file__).with_name("model-lock.json")
    )
    parser.add_argument("--cache", type=Path, default=Path("/models"))
    parser.add_argument("--runtime", type=Path, default=Path("/runtime"))
    args = parser.parse_args()
    lock = read_lock(args.lock)
    prepare(lock, args.cache)
    args.runtime.mkdir(parents=True, exist_ok=True)
    for name in ["runtime.py", "serve.py", "admission.py"]:
        shutil.copyfile(Path(__file__).with_name(name), args.runtime / name)
    shutil.copyfile(args.lock, args.runtime / "model-lock.json")


if __name__ == "__main__":
    main()
