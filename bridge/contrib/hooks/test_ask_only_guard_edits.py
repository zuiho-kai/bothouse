#!/usr/bin/env python3
"""ask-only-guard：只在问时拦派活、改文件、写命令；叫做、写 wiki/临时目录、读命令放行。"""
import json, os, subprocess, sys, tempfile, time, unittest
from datetime import datetime, timezone

HOOK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ask-only-guard.py")
HOME = os.path.expanduser("~")


def run(prompt, tool, inp, cwd=HOME, before=()):
    """before：更早的用户消息 [(原文, 几秒前)]，旧的在前。"""
    now = time.time()
    with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as f:
        for text, ago in before:
            ts = datetime.fromtimestamp(now - ago, timezone.utc).isoformat()
            f.write(json.dumps({"type": "user", "timestamp": ts, "message": {"content": text}}, ensure_ascii=False) + "\n")
        f.write(json.dumps({"type": "user", "message": {"content": prompt}}, ensure_ascii=False) + "\n")
    d = {"tool_name": tool, "tool_input": inp, "transcript_path": f.name, "cwd": cwd}
    out = subprocess.run([sys.executable, "-I", HOOK], input=json.dumps(d), capture_output=True, text=True).stdout
    os.unlink(f.name)
    return "deny" in out


ASK = "他具体是怎么做的"
DO = "两条都做"


class T(unittest.TestCase):
    def test_edit_tools(self):
        self.assertTrue(run(ASK, "Edit", {"file_path": f"{HOME}/code/x/a.py"}))
        self.assertTrue(run(ASK, "Write", {"file_path": f"{HOME}/.claude/hooks/x.py"}))
        self.assertFalse(run(DO, "Edit", {"file_path": f"{HOME}/code/x/a.py"}))
        self.assertFalse(run(ASK, "Write", {"file_path": f"{HOME}/wiki/refs/a.md"}))
        self.assertFalse(run(ASK, "Write", {"file_path": "/tmp/a.md"}))

    def test_bash_writes(self):
        for c in ("sed -i '' s/a/b/ a.py", "git commit -m x", "cd ~/code/x && git push", "echo x > a.txt",
                  "gh pr create -t x", "npm install foo", "pkill -f bot", "rm -rf build"):
            self.assertTrue(run(ASK, "Bash", {"command": c}), c)
        for c in ("cd ~/wiki && git add -A && git commit -m x", "git -C ~/wiki commit -m x", "ls > /dev/null",
                  "grep -n x a.py 2>&1 | head", "cat a > /tmp/b", "git log -1", "python3 bin/search.py x",
                  "d=$(mktemp -d); cd $d && git clone -q url"):
            self.assertFalse(run(ASK, "Bash", {"command": c}), c)
        self.assertFalse(run(ASK, "Bash", {"command": "git commit -m x"}, cwd=f"{HOME}/wiki"))
        self.assertFalse(run(DO, "Bash", {"command": "git push"}))

    def test_dispatch_never_blocked(self):
        # 10-30 复盘：派活、转话、任务板、定时、send 一律放行，问进度的话也不挡
        for c in ("ws-handoff notes/a.md 修定时", "ws-forward --notes n.md 换端口", "board update 783 在做",
                  "board add 新活", "bothouse timer add --delay 10m --prompt 看工作区2", "bothouse cron add --cron '0 * * * *' --prompt x",
                  "'/Applications/Bothouse.app/Contents/MacOS/bothouse' send --image /x.png",
                  f"cat > {HOME}/.bothouse/roles/maomao/notes/a.md <<'EOF'\n交接\nEOF\nws-handoff {HOME}/.bothouse/roles/maomao/notes/a.md 修"):
            for w in ("kimi 定时修了没", "第二版现在验证怎么样了", "什么情况"):
                self.assertFalse(run(w, "Bash", {"command": c}), (w, c))

    def test_earlier_order_allows_small_edit(self):
        # 用户已下过指令，接着只问一句：照指令的小改不回问
        order = [("并行，快速，去改，然后这个也改", 300)]
        self.assertFalse(run("第二版现在验证怎么样了", "Edit", {"file_path": f"{HOME}/code/x/a.py"}, before=order))
        # 指令太早（超过 30 分钟）、或最新一条叫停：照拦
        self.assertTrue(run("第二版现在验证怎么样了", "Edit", {"file_path": f"{HOME}/code/x/a.py"}, before=[(order[0][0], 3600)]))
        self.assertTrue(run("别改，先说为什么", "Edit", {"file_path": f"{HOME}/code/x/a.py"}, before=order))
        # 之前也只在问：照拦
        self.assertTrue(run("修了没", "Edit", {"file_path": f"{HOME}/code/x/a.py"}, before=[("什么情况", 60)]))

    def test_urging_not_asking(self):
        # 10-30 真话：反问/骂着要做，放行
        for w in ("为什么那么傻逼，你不应该打断他然后新写吗，还是功能我们没有", "所以我说半天你什么都没做，还在这呢吃屎",
                  "并行，快速，去改，然后这个也改", "第二个改好没？应该很快的呀，我操，太慢了", "为什么还不改？"):
            self.assertFalse(run(w, "Edit", {"file_path": f"{HOME}/code/x/a.py"}), w)
        # 纯提问照拦（只拦自己改）
        for w in ("是不是和这个有关系", "他们是exe的版本，不是网页版，是不是和这个有关系，难道现在是两套么",
                  "什么情况，你在验么，pr有么", "你觉得应该怎么弄？", "修了没", "别改，先说为什么"):
            self.assertTrue(run(w, "Edit", {"file_path": f"{HOME}/code/x/a.py"}), w)

    def test_subagent_skipped(self):
        with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as f:
            f.write(json.dumps({"type": "user", "message": {"content": ASK}}, ensure_ascii=False) + "\n")
        d = {"tool_name": "Edit", "tool_input": {"file_path": "/x/a.py"}, "transcript_path": f.name, "agent_id": "a1"}
        out = subprocess.run([sys.executable, "-I", HOOK], input=json.dumps(d), capture_output=True, text=True).stdout
        self.assertNotIn("deny", out)


if __name__ == "__main__":
    unittest.main()
