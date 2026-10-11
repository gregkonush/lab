import os
from pathlib import Path

from runtime import read_lock, server_args

if __name__ == "__main__":
    lock = read_lock(Path(__file__).with_name("model-lock.json"))
    os.execvp("vllm", ["vllm", *server_args(lock, Path("/models"))])
