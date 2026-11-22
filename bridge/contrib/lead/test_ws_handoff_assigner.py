"""交活时把布置人记到任务板条目上：桥贴最终汇报、叫人拍板时 @ 他（#988，用户 11-22「以后谁布置的任务
需要拍板或者做完了要@他一下 通知一下，就是@真人」）。布置人取桥签名的本轮发起人（bothouse identity show）；
取不到不记，桥就不 @。假桥和池子沿用 test_ws_up 的 FAKE_POOL，全在临时目录里跑。"""
import json, subprocess, sys, tempfile, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from test_ws_up import FAKE_POOL  # noqa: E402

IDENTITY = r"""
import json, sys
a = sys.argv[1:]
if a[:2] == ["identity", "show"]:
    st = json.load(open(sys.argv[0] + ".json"))
    if not st.get("claims"):
        print("no turn", file=sys.stderr); sys.exit(1)
    print(json.dumps({"claims": st["claims"], "token": "bh1.x"})); sys.exit(0)
"""


class AssignerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / "setup").mkdir()
        self.fake = self.tmp / "bothouse"
        self.fake.write_text(f"#!{sys.executable}\n" + IDENTITY + FAKE_POOL)
        self.fake.chmod(0o755)
        self.env = {"PATH": "/usr/bin:/bin", "HOME": str(self.tmp), "GATE_SETUP_DIR": str(self.tmp / "setup"),
                    "BOARD_DIR": str(self.tmp / "board"), "CC_BIN": str(self.fake), "CC_PROJECT": "lead-proj",
                    "CC_SESSION_KEY": "test:100", "WS_HANDOFF_WAIT": "1"}

    def run_handoff(self, claims):
        Path(str(self.fake) + ".json").write_text(json.dumps({"claims": claims, "ws": [
            {"id": "1", "name": "工作区1", "owner": "", "open": 0, "parked": 0}]}))
        p = self.tmp / "n.md"
        p.write_text("# 交接\n\n# 用户原话\n# 总目标\n# 范围\n改：x\n不改：无\n# 已查过什么\n无（没查过）\n# 进度\n# 相关改动\n冲突：无\n"
                     "# 规矩\n# 参照实现\n- bridge/contrib/lead/ws-up:1\n", encoding="utf-8")
        r = subprocess.run([sys.executable, "-I", str(HERE / "ws-handoff"), str(p), "改汇报", "--short", "改汇报"],
                           capture_output=True, text=True, env=self.env)
        self.assertEqual(r.returncode, 0, r.stderr)
        rows = [json.loads(l) for l in (self.tmp / "board" / "board.jsonl").read_text().splitlines() if l.strip()]
        self.assertEqual(len(rows), 1)
        return rows[0]

    def test_person_who_handed_it_off_is_recorded(self):
        it = self.run_handoff({"user_id": "1498889779377602672", "user_name": "zzzx0757", "kind": "human"})
        self.assertEqual(it.get("assigner"), {"id": "1498889779377602672", "name": "zzzx0757", "kind": "human"})

    def test_timer_turn_is_recorded_as_scheduled(self):
        it = self.run_handoff({"user_id": "timer", "user_name": "timer", "kind": "scheduled"})
        self.assertEqual(it["assigner"]["kind"], "scheduled")

    def test_no_turn_identity_records_nothing(self):
        it = self.run_handoff(None)
        self.assertNotIn("assigner", it)


if __name__ == "__main__":
    unittest.main()
