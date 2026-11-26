"""Check Friends account pairing against this checkout's real Bothouse management/Bridge."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

here = Path(__file__).resolve().parent
arcade = here.parents[1]
upstream = arcade.parents[1]
python = sys.executable

def main():
    subprocess.run([python, "-I", "-c", "from websockets.sync.client import connect"], check=True)
    caches = json.loads(subprocess.check_output(["go", "env", "-json", "GOCACHE", "GOMODCACHE"]))
    with tempfile.TemporaryDirectory(prefix="friends-pairing-") as name:
        data = Path(name)
        env = {k:v for k,v in os.environ.items() if k.lower() in {
            "path","systemroot","windir","comspec","pathext","temp","tmp",
            "appdata","localappdata","processor_architecture"}}
        env.update(caches, HOME=name, USERPROFILE=name, DSH_HOME=name, BOTHOUSE_DATA_DIR=name,
                   ARCADE_TEST_DIR=name, GOTELEMETRY="off", GOSUMDB="off", GOPROXY="off", GOTOOLCHAIN="local")
        fixture = upstream / "bridge/core/arcade_directory_probe_test.go"
        overlay = data / "overlay.json"
        overlay.write_text(json.dumps({"Replace":{str(fixture):str(here / "pairing.go.fixture")}}))
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        worker = subprocess.Popen(["go","test","-overlay",str(overlay),"-run","^TestArcadeScopedDirectory$",
                                   "-count=1","./core"],cwd=upstream/"bridge",env=env,creationflags=flags)
        try:
            end = time.monotonic() + 180
            while not (data / "config.toml").is_file():
                if worker.poll() is not None or time.monotonic() > end:
                    raise RuntimeError("The isolated management/Bridge fixture did not start")
                time.sleep(.2)
            subprocess.run(["node",here/"pairing.cjs",arcade,data,python],cwd=arcade,env=env,
                           creationflags=flags,check=True,timeout=120)
        finally:
            (data / "done").touch()
            try:
                worker.wait(timeout=20)
            except subprocess.TimeoutExpired:
                worker.terminate()
                worker.wait(timeout=10)
        if worker.returncode:
            raise RuntimeError("Bothouse core integration test failed")
        result = json.loads((data / "receipt.json").read_text(encoding="utf-8"))
        print(json.dumps(result, ensure_ascii=True, indent=2))

if __name__ == "__main__":
    main()
