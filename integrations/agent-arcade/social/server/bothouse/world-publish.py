"""One authorized heartbeat from the Friends service, through the installed world publisher."""
import json
import re
import runpy
import sys
from pathlib import Path


def read_packet():
    packet = sys.stdin.buffer.readline(1024 * 1024 + 1)
    if not packet or len(packet) > 1024 * 1024:
        raise ValueError("Missing Friends response")
    return json.loads(packet)


def permitted():
    # Only stable role numbers cross this pipe. The service owns authentication.
    print("directory", flush=True)
    ids = read_packet()
    if not isinstance(ids, list) or not all(isinstance(n, str) and re.fullmatch(r"bh_[a-f0-9]{21}", n) for n in ids):
        raise ValueError("Invalid directory")
    return set(ids)


def main():
    publisher, config, world = sys.argv[1:]
    module = runpy.run_path(publisher)
    token = read_packet()
    if not isinstance(token, str) or not re.fullmatch(r"[a-f0-9]{64}", token):
        raise ValueError("Invalid connection")
    sent = module["publish"](Path(config), set(), permitted, module["origin"](world), token)
    print(json.dumps({"count": len(sent["residents"])}), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.exit(1)
