"""Run the installed Three.js game and resident API on loopback."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--port",type=int,default=18746)
    args = ap.parse_args()
    if not 1024 <= args.port <= 65535:
        ap.error("Choose a port from 1024 to 65535.")
    state = Path(__file__).resolve().parent / ".data" / "resident-preview"
    rev=(state/"current.txt").read_text("ascii").strip()
    if not re.fullmatch("[a-f0-9]{40}",rev):
        sys.exit("Invalid installed-world marker")
    release=state/"releases"/rev
    if json.loads((release/"dist/resident-preview.json").read_text("utf8")).get("commit")!=rev:
        sys.exit("World and marker do not match")
    node=shutil.which("node")
    if not node:
        sys.exit("Node.js 24 or newer is required")
    database=state/("world.sqlite" if args.port==18746 else f"world-{args.port}.sqlite")
    env={k:os.environ[k] for k in ("PATH","SystemRoot","TMPDIR","TMP","TEMP") if k in os.environ}
    env.update(HOME_SAMPLE="1",HOME_SAMPLE_PORT=str(args.port),DATABASE_PATH=str(database))
    os.chdir(release)
    print(f"Starting http://127.0.0.1:{args.port}/ with save {database}",flush=True)
    raise SystemExit(subprocess.call([node, str(release / "src/server/index.ts")], env=env))

if __name__=="__main__":
    main()
