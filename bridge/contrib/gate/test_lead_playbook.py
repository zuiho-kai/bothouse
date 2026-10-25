"""当主注入含主角色工作手册、当次不含：python3 -I contrib/gate/test_lead_playbook.py（不加载模型）"""
import json, os, shutil, subprocess, sys, tempfile, unittest
from pathlib import Path

_tmp = tempfile.mkdtemp()
os.environ["GATE_SETUP_DIR"] = _tmp
os.environ["GATE_LEAD_FILE"] = str(Path(_tmp) / "gate-lead.json")
os.environ["GATE_WIKI"] = "off"
for k in ("GATE_TEAM", "GATE_PLAYBOOK"):
    os.environ.pop(k, None)
sys.path.insert(0, str(Path(__file__).resolve().parent))
import ctxsvc, lead  # noqa: E402

MARK = "队友空着，就给她们安排活"


def has_playbook(bot):
    return any(MARK in (x.get("desc") or "") for x in ctxsvc.context({"bot": bot, "text": "在吗"})["wiki"])


class T(unittest.TestCase):
    def tearDown(self):
        Path(os.environ["GATE_LEAD_FILE"]).unlink(missing_ok=True)

    def test_default_lead_gets_playbook_subs_do_not(self):
        self.assertTrue(has_playbook(""))
        for k in lead.KEYS[1:]:
            self.assertFalse(has_playbook(k), k)

    def test_after_switch_new_lead_gets_it_old_lead_does_not(self):
        new = lead.KEYS[1]
        lead.set_lead(new)
        self.assertTrue(has_playbook(new))
        self.assertFalse(has_playbook(""))
        self.assertIn(lead.state()["at"], lead.playbook(new)["path"])  # 换主后 path 变，cc-connect 会再推一次

    def test_first_rule_is_assign_idle_teammates(self):
        for name in ("PLAYBOOK.zh-CN.md", "PLAYBOOK.md"):
            text = (Path(__file__).resolve().parent.parent / "lead" / name).read_text(encoding="utf-8")
            first = next(l for l in text.splitlines() if l.startswith("## "))
            self.assertTrue("队友空着" in first or "idle" in first, (name, first))


class SameWord(unittest.TestCase):
    """DSH 成员带 bot=dsh:<id>，桥 bot 带键；两边都叫 claude 也各认各的（gate-context.mjs、lead.member）。"""

    def setUp(self):
        self.saved = (list(lead.KEYS), dict(lead.NAME), dict(lead.ID), dict(lead.ALIASES))
        lead.configure({"lead": {"name": "橘", "aliases": ["juzi"], "id": "111"},
                        "subs": {"claude": {"name": "Claude", "aliases": [], "id": "222"},
                                 "dsh-claude": {"name": "DSH Claude", "aliases": ["claude"], "id": "claude", "kind": "dsh"}}})

    def tearDown(self):
        Path(os.environ["GATE_LEAD_FILE"]).unlink(missing_ok=True)
        keys, name, ids, aliases = self.saved
        lead.configure({"lead": {"name": name[""], "aliases": aliases[""], "id": ids.get("")},
                        "subs": {k: {"name": name[k], "aliases": aliases[k], "id": ids.get(k)} for k in keys if k}})

    def test_dsh_lead_gets_short_playbook(self):
        lead.set_lead("dsh-claude")
        short = lead.playbook("dsh:claude")["desc"]
        self.assertIn("DSH 版", short)
        self.assertIn("【开工作区】", short)
        for gone in ("ws-handoff", "ws-forward", "ws-up", "board pause", "bothouse workspace new"):
            self.assertNotIn(gone, short)
        self.assertIn("ws-handoff", lead.playbook("dsh-claude")["desc"])  # 桥 bot 带键，照发完整版

    def test_member_by_namespace(self):
        self.assertEqual(lead.member("claude"), "claude")
        self.assertEqual(lead.member("dsh:claude"), "dsh-claude")
        self.assertEqual(lead.member("222"), "222")  # 桥 bot 不走 id 映射
        self.assertEqual(lead.member("dsh:222"), "dsh:222")  # 非 DSH 条目的 id 不认
        self.assertEqual(lead.member("dsh:nobody"), "dsh:nobody")

    def test_dsh_lead_playbook_not_given_to_bridge_bot(self):
        lead.set_lead("dsh-claude")
        self.assertTrue(has_playbook("dsh:claude"))
        self.assertFalse(has_playbook("claude"))
        lead.set_lead("claude")
        self.assertTrue(has_playbook("claude"))
        self.assertFalse(has_playbook("dsh:claude"))


HERE = Path(__file__).resolve().parent
# 装包后的布局：gate 脚本在 <数据目录>/gate（embed_gate.go），lead 工具在 <数据目录>/collaboration/lead（lead_tools.go）
GATE_FILES = ("ctxsvc.py", "wiki_search.py", "lead.py", "board.py", "datadir.py", "team.example.json")
PROBE = ("import sys; sys.path.insert(0, '.'); import json, ctxsvc, lead; print(json.dumps({'pb': str(lead.PLAYBOOK), 'hit': any(%r in (x.get('desc') or '') "
         "for x in ctxsvc.context({'bot': '', 'text': '在吗'})['wiki'])}))" % MARK)


class Installed(unittest.TestCase):
    def setUp(self):
        self.data = Path(tempfile.mkdtemp())
        (self.data / "gate").mkdir()
        for f in GATE_FILES:
            shutil.copy(HERE / f, self.data / "gate" / f)

    def tearDown(self):
        shutil.rmtree(self.data, ignore_errors=True)

    def probe(self):
        env = {k: v for k, v in os.environ.items()
               if not k.startswith(("GATE_", "BOTHOUSE_", "CC_", "DISCORD_"))}
        env.update(BOTHOUSE_DATA_DIR=str(self.data), GATE_SETUP_DIR=str(self.data), GATE_WIKI="off", HOME=str(self.data))
        out = subprocess.run([sys.executable, "-I", "-c", PROBE], cwd=self.data / "gate", env=env,
                             capture_output=True, text=True, check=True).stdout
        return json.loads(out.strip().splitlines()[-1])

    def test_installed_lead_tools_playbook_reaches_lead(self):
        shutil.copytree(HERE.parent / "lead", self.data / "collaboration" / "lead")
        r = self.probe()
        self.assertEqual(Path(r["pb"]), self.data / "collaboration" / "lead" / "PLAYBOOK.zh-CN.md")
        self.assertTrue(r["hit"])

    def test_no_lead_tools_no_playbook_no_error(self):
        self.assertFalse(self.probe()["hit"])


if __name__ == "__main__":
    unittest.main()
