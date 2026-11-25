"""board keep-running（#2203 持续推进开关）：python3 -I test_board_keep_running.py
桥 core/team_lead_autowake.go 读 <BOARD_DIR>/keep-running.json；这里只验命令写的文件形状和按频道开关。"""
import json, os, subprocess, sys, tempfile, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


def run(d, key, *args):
    env = {k: v for k, v in os.environ.items() if k != "CC_SESSION_KEY"}
    env["BOARD_DIR"] = d
    if key:
        env["CC_SESSION_KEY"] = key
    return subprocess.run([sys.executable, "-I", str(HERE / "board.py"), "keep-running", *args],
                          env=env, capture_output=True, text=True)


class KeepRunning(unittest.TestCase):
    def test_on_off_per_chat(self):
        d = tempfile.mkdtemp()
        self.assertIn("跟主角色项目", run(d, "discord:1:u").stdout)
        self.assertEqual(run(d, "discord:1:u", "on").returncode, 0)
        self.assertEqual(run(d, "discord:2", "on").returncode, 0)
        conf = json.loads(Path(d, "keep-running.json").read_text())
        self.assertEqual(set(conf), {"discord:1", "discord:2"})
        since = conf["discord:1"]["since"]
        run(d, "discord:1", "on")  # 再开不改起始时刻
        self.assertEqual(json.loads(Path(d, "keep-running.json").read_text())["discord:1"]["since"], since)
        self.assertEqual(run(d, "discord:1", "off").returncode, 0)  # 关是本频道设定，盖过默认开
        self.assertEqual(json.loads(Path(d, "keep-running.json").read_text())["discord:1"], {"on": False})
        self.assertTrue(json.loads(Path(d, "keep-running.json").read_text())["discord:2"]["on"])
        self.assertEqual(run(d, "discord:1", "default").returncode, 0)
        self.assertEqual(set(json.loads(Path(d, "keep-running.json").read_text())), {"discord:2"})

    def test_needs_chat(self):
        p = run(tempfile.mkdtemp(), "", "on")
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("CC_SESSION_KEY", p.stderr)


if __name__ == "__main__":
    unittest.main()
