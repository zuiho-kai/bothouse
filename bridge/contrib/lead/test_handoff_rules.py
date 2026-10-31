#!/usr/bin/env -S python3 -I
"""交接规则只有一份（handoff-rules.json）：ws-handoff（_handoff_rules.py）和 DSH collab（handoff-rules.mjs）对同一组
fixture 结果一字不差；改一次规则两边一起变；规则文件读不到两边都报错；用规则的代码里不再写死小节名和引用正则。"""
import json, os, re, shutil, subprocess, sys, tempfile, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import _handoff_rules as R  # noqa: E402

REPO = HERE.parent.parent.parent
COPIES = [REPO / "dsh" / "collab", REPO / "bridge" / "core" / "dsh_bundle" / "collab"]  # 源与 bundle 副本
NODE = shutil.which("node")

BASE = ("# 交接\n## 用户原话\n「x」\n## 总目标\n- z\n## 范围\n- 改：x\n- 不改：y\n"
        "## 已查过什么\n- dsh/collab/tasks.mjs:467 只校验 ref\n## 进度\n| a |\n"
        "## 相关改动\n- #1 已合\n冲突：无\n## 规矩\n- y\n")
GOOD = BASE + "## 参照实现\n- bridge/contrib/lead/ws-up:120（差异：不发卡）\n"
ART_GOAL = GOOD.replace("## 总目标\n- z\n", "## 总目标\n- 给瑞凤画一张 Q版小人\n").replace("- 改：x\n", "- 改：瑞凤小人（3 张）\n")
ART = [
    ART_GOAL,
    ART_GOAL + "## 参考图\n- ~/art/ref/官方立绘.png\n",
    ART_GOAL + "## 参考图\n- ~/art/ref/官方立绘.png\n- https://example.com/fan/1.jpg\n",
    ART_GOAL + "参考图：~/a/1.webp、~/a/2.PNG\n",
    ART_GOAL + "原创：无现成图\n## 参考图\n- ~/a/style1.png\n- ~/a/style2.jpg\n",
    ART_GOAL + "原创：无现成图\n## 参考图\n- ~/a/style1.png\n- ~/a/style2.jpg\n先出 3 张小样给用户挑\n",
    ART_GOAL.replace("- 改：瑞凤小人（3 张）\n", "- 改：出图检查（bridge/contrib/lead/handoff-rules.json）\n"),
    GOOD.replace("## 总目标\n- z\n", "## 总目标\n- 修计划表的封面字段映射\n").replace("- 改：x\n", "- 改：dsh/collab/tasks.mjs 的 cover 字段\n"),
    GOOD.replace("## 用户原话\n「x」\n", "## 用户原话\n「画个流程图给我看」\n"),
]
EX_TRIG = GOOD.replace("「x」", "「你看别人的readme 学习一下」\n上文：用户发 https://github.com/a/b")
EX_TABLE = ("## 照抄对象\n- 范本：https://github.com/a/b README\n- 范本第 1 部分 横幅 → 我们第 1 部分 横幅\n"
            "- 范本第 2 部分 明暗图 -> 我们第 2 部分 截图\n- 范本第 3 部分 安装 → 我们第 3 部分 安装\n- 验收：并排截图\n")
EX = [
    EX_TRIG, EX_TRIG + EX_TABLE,
    EX_TRIG + EX_TABLE.replace("- 范本第 3 部分 安装 → 我们第 3 部分 安装\n", ""),
    EX_TRIG + EX_TABLE.replace("并排截图", "看着差不多"),
    EX_TRIG + EX_TABLE.replace("https://github.com/a/b", "a/b"),
    GOOD.replace("「x」", "「参考一下别人怎么做」"),
    GOOD.replace("「x」", "「[replying to 橘: 照着改] 好」\n- https://example.com"),
    GOOD.replace("「x」", "「照着《深入理解计算机系统》第 3 章写」"),
]
FIXTURES = [
    GOOD, BASE, "", "随便写几句", GOOD.replace("## 总目标\n", "## 其他\n"),
    BASE + "## 参照实现\n- 还没找，14:30 再说\n## 其他\n- a.py:3\n",
    BASE + "参照实现：bridge/contrib/lead/ws-up:120，差异：不发卡\n",
    BASE + "## 3. 参照实现与差异\n看 `gate/board.py:88`\n", BASE + "- 参照实现：无（新建）\n", BASE + "参照实现：无(新建)\n",
    BASE + "## 参照实现\n- 文档/说明.md:3\n", BASE + "## 参照实现\n- 说明:3\n",
    GOOD.replace("- 不改：y\n", ""), GOOD.replace("- 改：x\n", ""), GOOD.replace("- 改：x\n- 不改：y\n", "* 改: a、b\n> 不改: 无\n"),
    GOOD.replace("- 改：x\n- 不改：y\n", "改：\n不改：无\n"), GOOD.replace("- 改：x\n- 不改：y\n", "修改：x\n不改：无\n"),
    GOOD.replace("冲突：无\n", ""), GOOD.replace("冲突：无\n", "和 #1 无冲突\n"), GOOD.replace("冲突：无\n", "冲突：#1 改了同一个函数\n"),
    GOOD.replace("冲突：无\n", "冲突：#1 改了同一个函数（已问用户：先合 #1）\n"), GOOD.replace("冲突：无\n", "- 冲突: 无。\n"),
    GOOD.replace("冲突：无\n", "冲突：无（已对过 #1）\n"),
    GOOD + "## 共改文件\n- agent_hooks.go\n", GOOD + "## 多人改\n- x\n底分支：\n", GOOD + "## 共改文件\n底分支：feat/approvals\n",
    GOOD + "- 底分支: main\n## 多人改\n", GOOD + "正文提到多人改，但没有这一节\n",
    GOOD.replace("\n", "\r\n"),
    # 「改」最多 3 行，多了拆开交
    GOOD.replace("- 改：x\n", "- 改：a\n- 改：b\n- 改：c\n"), GOOD.replace("- 改：x\n", "- 改：a\n- 改：b\n- 改：c\n- 改：d\n"),
    # 「已查过什么」：缺节、节里没有 文件:行/文档路径、写「无（没查过）」、文档路径
    GOOD.replace("## 已查过什么\n- dsh/collab/tasks.mjs:467 只校验 ref\n", ""),
    GOOD.replace("- dsh/collab/tasks.mjs:467 只校验 ref\n", "- 看过了，没问题\n"),
    GOOD.replace("- dsh/collab/tasks.mjs:467 只校验 ref\n", "- 无（没查过）\n"),
    GOOD.replace("- dsh/collab/tasks.mjs:467 只校验 ref\n", "- ~/work/codemaps/bothouse-bridge.md「编译与测试」节\n"),
    # 出图类活（art_ref）：缺参考图、只 1 张、2 张、原创缺小样、原创带小样、改代码的活放行、普通活放行
    *ART,
    # 用户原话给了范本：要「照抄对象」节（链接 + 3 行对照 + 并排截图）
    *EX,
]
DISPATCH = [
    {"title": "改派活校验", "ref": ""}, {"title": "改派活校验", "ref": "看着办"}, {"title": "x", "ref": "14:30 前做完"},
    {"title": "写发布文案", "ref": "无（新建）"}, {"title": "x", "ref": "无(新建)"}, {"title": "x", "ref": "tasks.mjs:226"},
    {"title": "x", "ref": "~/im-bridge/bin/ws-handoff:68（照它的判据）"},
    {"title": "多人改 tasks.mjs 的 tick", "ref": "dsh/collab/tasks.mjs:360"},
    {"title": "共改文件：store.mjs", "ref": "dsh/collab/store.mjs:183", "base": "  "},
    {"title": "多人改 tasks.mjs 的 tick", "ref": "dsh/collab/tasks.mjs:360", "base": "ws2/b1"},
]

NODE_RUN = r"""
const [mod, rulesPath, input] = process.argv.slice(1);
const m = await import(mod);
const rules = rulesPath ? m.loadRules(rulesPath) : m.loadRules();
const { texts, dispatch } = JSON.parse(input);
console.log(JSON.stringify({ texts: texts.map(t => m.checkHandoff(t, rules)), dispatch: dispatch.map(d => m.checkDispatch(d, rules)) }));
"""


def node(copy, rules_path="", texts=(), dispatch=()):
    r = subprocess.run([NODE, "--input-type=module", "-e", NODE_RUN, (copy / "handoff-rules.mjs").as_uri(), str(rules_path),
                        json.dumps({"texts": list(texts), "dispatch": list(dispatch)}, ensure_ascii=False)],
                       capture_output=True, text=True)
    if r.returncode:
        raise AssertionError(r.stderr)
    return json.loads(r.stdout)


@unittest.skipUnless(NODE, "node not on PATH")
class SameResultsTest(unittest.TestCase):
    def test_python_and_node_agree_on_fixtures(self):
        py = [R.check(t) for t in FIXTURES]
        self.assertIsNone(py[0])
        self.assertGreater(sum(e is not None for e in py), 10)  # fixture 里拒的多，不是全过
        for copy in COPIES:
            self.assertEqual(node(copy, texts=FIXTURES)["texts"], py, copy)

    def test_checked_section_required(self):
        gone = GOOD.replace("## 已查过什么\n- dsh/collab/tasks.mjs:467 只校验 ref\n", "")
        vague = GOOD.replace("- dsh/collab/tasks.mjs:467 只校验 ref\n", "- 看过了，没问题\n")
        doc = GOOD.replace("- dsh/collab/tasks.mjs:467 只校验 ref\n", "- ~/work/codemaps/bothouse-bridge.md「编译与测试」节\n")
        self.assertIn("已查过什么", R.check(gone) or "")
        self.assertIn("已查过什么", R.check(vague) or "")
        self.assertIsNone(R.check(doc))
        self.assertEqual(node(COPIES[0], texts=[gone, vague, doc])["texts"], [R.check(gone), R.check(vague), None])

    def test_art_needs_reference_images(self):
        py = [R.check(t) for t in ART]
        self.assertEqual([e is None for e in py], [False, False, True, True, False, True, True, True, True])
        self.assertIn("参考图", py[0])
        self.assertIn("1 张", py[1])
        self.assertIn("小样", py[4])
        self.assertEqual(node(COPIES[0], texts=ART)["texts"], py)
    def test_exemplar_needs_mapping_table(self):
        got = [R.check(t) for t in EX]
        self.assertEqual([e is None for e in got], [False, True, False, False, False, True, True, False])
        self.assertIn("照抄对象", got[0])
        self.assertEqual(node(COPIES[0], texts=EX)["texts"], got)

    def test_dispatch_uses_the_same_rules(self):
        got = node(COPIES[0], dispatch=DISPATCH)["dispatch"]
        ok = [e is None for e in got]
        self.assertEqual(ok, [False, False, False, True, True, True, True, False, False, True])
        msgs = {c["id"]: c["dispatch_msg"] for c in R.load()["checks"] if "dispatch_msg" in c}
        self.assertEqual(set(got) - {None}, set(msgs.values()))

    def test_one_rule_change_changes_both(self):
        rules = R.load()
        rules["checks"][0]["names"].append("新加小节X")
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "handoff-rules.json"
            p.write_text(json.dumps(rules, ensure_ascii=False), encoding="utf-8")
            py = R.check(GOOD, R.load(p))
            self.assertIn("新加小节X", py or "")
            self.assertIsNone(R.check(GOOD + "## 新加小节X\n- a\n", R.load(p)))
            for copy in COPIES:
                self.assertEqual(node(copy, p, texts=[GOOD, GOOD + "## 新加小节X\n- a\n"])["texts"], [py, None])
            # ws-handoff 自己（不经测试替换）也读同目录那份：拷一份工具目录、改规则，交接文件照样被拒。
            lead = Path(d) / "lead"
            shutil.copytree(HERE, lead, ignore=shutil.ignore_patterns("test_*", "__pycache__"))
            shutil.copy(p, lead / "handoff-rules.json")
            drv = ("import sys; from importlib.machinery import SourceFileLoader as L; "
                   "print(L('ws_handoff', sys.argv[1]).load_module().check_notes(sys.stdin.read()) or 'OK')")
            env = {**os.environ, "GATE_DIR": str(HERE.parent / "gate"), "GATE_SETUP_DIR": d}
            r = subprocess.run([sys.executable, "-I", "-c", drv, str(lead / "ws-handoff")], input=GOOD,
                               capture_output=True, text=True, env=env)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn("新加小节X", r.stdout)


@unittest.skipUnless(NODE, "node not on PATH")
class MissingRulesTest(unittest.TestCase):
    def test_both_refuse_without_rules(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaisesRegex(RuntimeError, "交接规则文件读不到"):
                R.load(Path(d) / "handoff-rules.json")
            # 装好的插件目录里没有规则文件（也没有仓库在旁边）：读不到就报错，不放行。
            shutil.copy(COPIES[0] / "handoff-rules.mjs", d)
            r = subprocess.run([NODE, "--input-type=module", "-e",
                                "const m = await import(process.argv[1]); try { m.checkHandoff('x'); console.log('PASSED'); }"
                                " catch (e) { console.log(e instanceof m.HandoffRulesError ? e.message : 'OTHER ' + e); }",
                                (Path(d) / "handoff-rules.mjs").as_uri()], capture_output=True, text=True)
            self.assertIn("交接规则文件读不到", r.stdout, r.stderr)


class NoHardcodedRulesTest(unittest.TestCase):
    """用规则的代码里不再写死小节名、多人改关键词和引用正则：规则只在 handoff-rules.json。"""

    def test_no_section_names_in_code(self):
        rules = R.load()
        names = set()
        for c in rules["checks"]:
            names |= set(c.get("names", [])) | set(c.get("headings", [])) | ({c["section"]} if "section" in c else set())
        files = [HERE / "ws-handoff", HERE / "_handoff_rules.py"]
        for copy in COPIES:
            files += [copy / "tasks.mjs", copy / "plugin.mjs", copy / "handoff-rules.mjs"]
        for f in files:
            text = f.read_text(encoding="utf-8")
            for n in sorted(names):  # 当作节名/判据用的写法：「名」、"名"、'名'、/名|…/；散文里提到这个词不算
                self.assertIsNone(re.search(f"[「\"'/|]{re.escape(n)}[」\"'/|]", text),
                                  f"{f}: 写死了「{n}」，改从 handoff-rules.json 读")
            self.assertIsNone(re.search(r"REF_RE|:\\d\+|:\[0-9\]\+", text), f"{f}: 写死了引用正则")


if __name__ == "__main__":
    unittest.main()
