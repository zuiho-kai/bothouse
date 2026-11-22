"""#2075 交活指定模型：_model 核对/下发、ws-forward 换模型、接回照任务板再切、任务板显示。假桥，不碰真桥。"""
import contextlib, io, json, os, stat, sys, tempfile, types, unittest
from pathlib import Path
from unittest.mock import Mock

# 先隔离再导入（审稿 #2076 第 4 条）：_team / board / datadir 一载就按环境解析并缓存数据目录、任务板目录，
# 会话里带着的 CC_DATA_DIR、BOARD_DIR 指着线上。导入任何被测模块前全指到临时目录。
_ISO = tempfile.mkdtemp(prefix="model-pick-")
for _k in ("BOTHOUSE_DATA_DIR", "GATE_SETUP_DIR", "CC_DATA_DIR"):
    os.environ[_k] = _ISO
os.environ["BOARD_DIR"] = os.path.join(_ISO, "team")
os.environ["BOTHOUSE_TEST"] = "1"
os.environ.pop("GATE_TEAM", None)

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "gate"))
import _model  # noqa: E402
import test_ws_forward_routing as fr  # noqa: E402
from test_ws_forward_routing import functions  # noqa: E402

LIST = {"agent": "claudecode", "model": "opus", "models": [{"Name": "opus"}, {"Name": "claude-fable-5-2"}],
        "efforts": ["low", "medium", "high"]}


class ModelHelperTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.log = Path(self.dir) / "args.jsonl"
        fake = Path(self.dir) / "cc"
        fake.write_text("#!/usr/bin/env python3\nimport json,sys\n"
                        f"open({str(self.log)!r},'a').write(json.dumps(sys.argv[1:])+'\\n')\n"
                        f"print(json.dumps({json.dumps(LIST)!r} and {LIST!r} if sys.argv[2]=='list' else "
                        "{'ok': sys.argv[3]!='bad', 'message': 'no unique model', 'candidates': [{'Name': 'opus'}, {'Name': 'claude-fable-5-2'}]}))\n"
                        "sys.exit(0 if sys.argv[2]=='list' or sys.argv[3]!='bad' else 2)\n")
        fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
        self.env = {"CC_BIN": str(fake), "CC_PROJECT": "cjiang", "CC_SESSION_KEY": "discord:main"}
        self.old = {k: os.environ.get(k) for k in self.env}
        os.environ.update(self.env)

    def tearDown(self):
        for k, v in self.old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def calls(self):
        return [json.loads(x) for x in self.log.read_text().splitlines()]

    def test_parse(self):
        self.assertEqual(_model.parse(["a.md", "--model", "opus", "task", "--effort", "high"]), (["a.md", "task"], "opus", "high"))
        self.assertEqual(_model.parse(["a.md", "task"]), (["a.md", "task"], None, None))

    def test_check(self):
        self.assertIsNone(_model.check(None, None))
        self.assertIsNone(_model.check("claude-fable-5-2", "high"))
        err = _model.check("fable", None)  # 别名、近似写法不放行，列出可选项
        self.assertIn("opus、claude-fable-5-2", err)
        self.assertIn("可选：low、medium、high", _model.check("opus", "max"))
        self.assertIn("一起写", _model.check(None, "high"))
        self.assertEqual(self.calls()[0][:5], ["model", "list", "--json", "--project", "cjiang"])
        self.assertEqual(self.calls()[0][5:], ["--session-key", "discord:main"])

    def test_apply(self):
        self.assertIsNone(_model.apply("discord:ws3", "opus", "high", "deep"))
        self.assertEqual(self.calls()[-1], ["model", "set", "opus", "--handoff", "--project", "deep",
                                            "--session-key", "discord:ws3", "--json", "--effort", "high"])
        self.assertEqual(_model.apply("discord:ws3", "bad", None), "no unique model；可选：opus、claude-fable-5-2")
        self.assertIsNone(_model.apply("discord:ws3", None, None))  # 没指定：不调桥
        self.assertEqual(len(self.calls()), 2)


class ForwardModelTest(unittest.TestCase):
    def setUp(self):
        p = fr.ForwardRecipientTest()  # 借它的假桥和任务板，不重跑它的用例
        p.setUp()
        self.ns, self.board, self.run, self.forward = p.ns, p.board, p.run, p.forward
        self.applied, self.checked = [], []
        self.ns["_model"] = types.SimpleNamespace(
            parse=_model.parse, label=_model.label,
            check=lambda m, e, p=None, sk=None: self.checked.append((m, e, p, sk)) or (None if m in (None, "opus") else f"模型 {m} 不在列表里"),
            apply=lambda ws, m, e, p=None: self.applied.append((ws, m, e, p)) or None)
        self.board.set_model = Mock()

    def test_live_task_switches_before_wake(self):
        timer = self.forward("--model", "opus", "--effort", "high")
        self.assertEqual(self.applied, [("discord:ws3", "opus", "high", "deep")])
        self.board.set_model.assert_called_once_with(362, "opus", "high")
        self.assertIn("timer", timer)

    def test_no_model_keeps_task_model(self):
        self.forward()
        self.assertEqual(self.applied, [])
        self.board.set_model.assert_not_called()

    def test_model_checked_against_recipient_project(self):
        # 跨项目续做（审稿 #2076 第 2 条）：发话方 gge 转给肥鱼（deep）的工作区，按 deep 的列表和工作区会话核，不按 gge
        self.forward("--model", "opus")
        self.assertEqual(self.checked, [("opus", None, "deep", "discord:ws3")])

    def test_effort_without_model_refused_before_lookup(self):
        with self.assertRaises(SystemExit) as cm, contextlib.redirect_stdout(io.StringIO()):
            self.ns["main"](["--effort", "high", "continue"])
        self.assertIn("没转", str(cm.exception))
        self.run.assert_not_called()

    def test_unknown_model_not_forwarded(self):
        with self.assertRaises(SystemExit) as cm, contextlib.redirect_stdout(io.StringIO()):
            self.ns["main"](["--model", "nope", "continue"])
        self.assertIn("不在列表里", str(cm.exception))
        self.run.assert_not_called()


class ResumeModelTest(unittest.TestCase):
    """接回（ws-handoff --resume → start）照任务板记的模型再切，切不成按叫醒失败退回。"""

    def setUp(self):
        self.item = {"id": 961, "what": "交活指定模型", "status": "暂停", "model": "opus", "effort": "high"}
        self.applied = []
        self.apply_err = None
        self.board = types.SimpleNamespace(items=lambda: [self.item], update=Mock(), rebind=Mock(), arm_guard=Mock(),
                                           _park_once=Mock(return_value=True), restore=Mock(return_value=True))
        self.run = Mock(return_value=types.SimpleNamespace(returncode=0, stdout="timer-1", stderr=""))
        import subprocess as sp
        self.ns = functions("ws-handoff", {"start"}, dict(
            board=self.board, held=lambda prev, chat: ("discord:ws5", "工作区5", "discord:main"),
            pick_pool=Mock(), _lead_name=lambda p: "C酱", append_skeleton=Mock(), record_last=Mock(), arm_drift=Mock(),
            timer_cmd=lambda *a: ["cc", "timer", "add"], cc_bin=lambda: "cc", GUARD=None,
            subprocess=types.SimpleNamespace(run=self.run, CompletedProcess=sp.CompletedProcess),
            sys=types.SimpleNamespace(exit=lambda m: (_ for _ in ()).throw(SystemExit(m)), stderr=io.StringIO()),
            _model=types.SimpleNamespace(label=_model.label,
                                         apply=lambda ws, m, e, p=None: self.applied.append((ws, m, e, p)) or self.apply_err)))

    def test_resume_reapplies_task_model(self):
        self.assertTrue(self.ns["start"]("/n.md", "交活指定模型", "discord:main", 961, "cjiang", "答复"))
        self.assertEqual(self.applied, [("discord:ws5", "opus", "high", "cjiang")])
        self.run.assert_called_once()

    def test_switch_failure_rolls_back(self):
        self.apply_err = "model list unavailable"
        with self.assertRaises(SystemExit) as cm:
            self.ns["start"]("/n.md", "交活指定模型", "discord:main", 961, "cjiang", "答复")
        self.assertIn("没切成", str(cm.exception))
        self.run.assert_not_called()
        self.board._park_once.assert_called_once()
        self.board.restore.assert_called_once_with(self.item)


class IsolationTest(unittest.TestCase):
    def test_model_import_does_not_resolve_data_dir(self):
        import subprocess as sp
        code = "import sys; sys.path.insert(0, sys.argv[1]); import _model; print('_team' in sys.modules)"
        out = sp.run([sys.executable, "-I", "-c", code, str(HERE)], capture_output=True, text=True, env=dict(os.environ))
        self.assertEqual(out.stdout.strip(), "False", out.stderr)

    def test_board_dir_isolated(self):
        import board
        self.assertTrue(str(board.DIR).startswith(_ISO), board.DIR)


class BoardShowsModelTest(unittest.TestCase):
    def test_fmt(self):
        import board
        line = board.fmt({"id": 961, "what": "交活指定模型", "status": "已交接", "who": "工作区5C酱", "at": "11-22 15:00",
                          "model": "gemini-4-neon-high"})
        self.assertIn("｜模型 gemini-4-neon-high", line)
        self.assertNotIn("模型", board.fmt({"id": 1, "what": "x", "at": ""}))


if __name__ == "__main__":
    unittest.main()
