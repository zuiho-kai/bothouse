"""Start or reuse the installed, loopback-only Windows resident preview."""
import http.client
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / ".data" / "resident-preview"
PORT = 18746
ORIGIN = f"http://127.0.0.1:{PORT}"


def release_id():
    try:
        value = (STATE / "current.txt").read_text("ascii").strip()
    except FileNotFoundError:
        return None
    if not re.fullmatch(r"[0-9a-f]{40}", value):
        raise ValueError("本机预览的版本记录无效。")
    return value


def check_running(revision):
    conn = http.client.HTTPConnection("127.0.0.1", PORT, timeout=3)
    try:
        for path, expected in (("/resident-preview.json", {"commit": revision, "kind": "windows-resident-preview"}),
                               ("/healthz", {"ok": True, "profile": "home-sample"})):
            conn.request("GET", path)
            res = conn.getresponse()
            if res.status != 200 or json.loads(res.read(4097)) != expected:
                raise ValueError("本机预览端口正在运行其他版本或服务。")
        return True
    except ConnectionRefusedError:
        return False
    finally:
        conn.close()


def ensure_running():
    revision = release_id()
    if not revision:
        raise ValueError("这份工作区尚未安装本机预览。")
    if check_running(revision):
        return ORIGIN
    release = STATE / "releases" / revision
    node = shutil.which("node.exe")
    if not node or not (release / "dist/resident-preview.json").is_file():
        raise ValueError("本机预览安装不完整，请核对版本和 Node.js。")
    # Only the resident sample has this data path and cookie name. Inherit no AI or service credentials.
    env = {key: os.environ[key] for key in ("SystemRoot", "PATH", "TEMP", "TMP") if key in os.environ}
    env.update(HOME_SAMPLE="1", HOME_SAMPLE_PORT=str(PORT), DATABASE_PATH=str(STATE / "world.sqlite"))
    child = subprocess.Popen([node, str(release / "src/server/index.ts")], cwd=release, env=env,
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                             stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(25):
        if check_running(revision):
            return ORIGIN
        if child.poll() is not None:
            break
        time.sleep(.2)
    raise ValueError("本机预览尚未就绪，请检查安装和端口后重试。")


if __name__ == "__main__":
    print(ensure_running())
