# #1897：照参考做的活——入口原件节（ref_source）。检查定义是本机规则文件里那条的副本（fixtures/ref_source_check.json）：
# 这个检查默认不开，开不开由各机器的 handoff-rules.local.json 定；这里只测检查类型本身。
import importlib.machinery, importlib.util, json, os, sys, tempfile, unittest
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import _handoff_rules as R  # noqa: E402

def _wspass():
    loader = importlib.machinery.SourceFileLoader("ws_pass", str(HERE / "ws-pass"))
    spec = importlib.util.spec_from_loader("ws_pass", loader)
    m = importlib.util.module_from_spec(spec)
    loader.exec_module(m)
    return m

class RefSourceTest(unittest.TestCase):
    def setUp(self):
        self.rules = R.load(R.RULES, Path(tempfile.mkdtemp()) / "none.json")
        self.c = json.loads((HERE / "fixtures" / "ref_source_check.json").read_text(encoding="utf-8"))
        self.ev = tempfile.NamedTemporaryFile(suffix=".md", delete=False).name
        self.table = tempfile.NamedTemporaryFile(suffix=".md", delete=False).name
        Path(self.table).write_text("| 时间 | 字 | 动作 | 道具 |\n", encoding="utf-8")
        self.head = "## 用户原话\n- [11-23 14:08] zuiho_kai：「照着原片做」\n## 总目标\n做\n"

    def run_check(self, extra):
        return R._check(self.c, (self.head + extra).splitlines(), self.rules["lead"])

    def test_missing_section(self):
        self.assertIn("缺「## 原件」节", self.run_check(""))

    def test_kind_mismatch_needs_pass(self):
        self.assertIn("料不同类", self.run_check(f"## 原件\n- 陈：原件=动图（gif）；我们=静图加程序晃动；证据={self.ev}\n"))
        self.assertIsNone(self.run_check(f"## 原件\n- 标题：原件=原文；我们=自写；证据={self.ev}；放行：用户「你直接写，别找了」\n"))

    def test_same_kind_and_evidence(self):
        self.assertIsNone(self.run_check(f"## 原件\n- 标题：原件=原文（句式）；我们=原文（换名）；证据={self.ev}\n"))
        self.assertIn("不存在", self.run_check("## 原件\n- 标题：原件=原文；我们=原文；证据=/nope/x.md\n"))

    def test_not_a_reference_task(self):
        self.assertIsNone(R._check(self.c, "## 用户原话\n- [11-23] zuiho_kai：「修个 bug」\n".splitlines(), self.rules["lead"]))

    def test_timed_needs_segment_and_table(self):
        # #1912：会随时间变的原件要写原片哪一段、附逐字动作表（表头 时间/字/动作/道具）
        e = self.run_check(f"## 原件\n- 陈那段：原件=动图；我们=动图；证据={self.ev}\n")
        self.assertIn("段=mm:ss–mm:ss", e)
        self.assertIn("table.md", e)
        bad = tempfile.NamedTemporaryFile(suffix=".md", delete=False, mode="w")
        bad.write("时间｜动作\n")
        bad.close()
        self.assertIn("表头缺：字、道具", self.run_check(f"## 原件\n- 陈那段：原件=编排；我们=编排；证据={self.ev}；段=1:35–1:46；动作表={bad.name}\n"))
        ok = tempfile.NamedTemporaryFile(suffix=".md", delete=False, mode="w")
        ok.write("时间｜字｜动作｜道具\n1:35.0｜这｜举手｜无\n")
        ok.close()
        self.assertIsNone(self.run_check(f"## 原件\n- 陈那段：原件=编排；我们=编排；证据={self.ev}；段=1:35–1:46；动作表={ok.name}\n"))

    def test_example_has_no_loop(self):
        self.assertNotIn("现成循环", self.c["msg"])
        self.assertNotIn("现成动图", self.c["mismatch_msg"])


class LocalRulesLayoutTest(unittest.TestCase):
    """#2051：脚本在 <数据>/collaboration/runtime/lead（桥内嵌版）时，本机叠加规则仍找 <数据>/collaboration/ 下那份。"""
    def test_embedded_layout_finds_local_rules(self):
        import shutil, subprocess
        root = Path(tempfile.mkdtemp()) / "collaboration"
        shutil.copytree(HERE, root / "runtime" / "lead", ignore=shutil.ignore_patterns("__pycache__"))
        (root / "handoff-rules.local.json").write_text('{"profile": "strict", "flags": {"require_short": true}}', encoding="utf-8")
        env = {k: v for k, v in os.environ.items() if k != "HANDOFF_RULES_LOCAL"}
        code = ("import sys; sys.path.insert(0, sys.argv[1]); import _handoff_rules as R, _added_judge as A; "
                "print(R.LOCAL == A.HANDOFF_LOCAL, R.LOCAL, R.load(R.RULES).get('flags'))")
        out = subprocess.run([sys.executable, "-I", "-c", code, str(root / "runtime" / "lead")], capture_output=True, text=True, env=env)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertTrue(out.stdout.startswith("True ") and "/collaboration/handoff-rules.local.json " in out.stdout, out.stdout)
        self.assertIn("'require_short': True", out.stdout)


if __name__ == "__main__":
    unittest.main()
