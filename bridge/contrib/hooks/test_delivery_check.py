"""Delivery checks through run.py; commands are inspected, never executed."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent


class DeliveryCheckTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.role = Path(self.tmp.name)
        self.file = self.role / "finished.png"
        self.file.write_bytes(b"artifact")
        self.log = self.role / "turn.jsonl"
        self.env = {k: v for k, v in os.environ.items()
                    if not k.startswith(("CC_", "BOTHOUSE_", "CONEST_", "CLAUDE_", "DSH_", "GATE_"))}
        self.env.update(HOME=str(self.role), GATE_WIKI="off")
        self.sheet("add", "cover", "use the required color")

    def sheet(self, *args):
        result = subprocess.run(
            [sys.executable, "-I", str(HERE / "accept.py"), "--role", str(self.role), *map(str, args)],
            capture_output=True, text=True, env=self.env)
        self.assertEqual(result.returncode, 0, result.stderr)

    def call(self, cli="", command=None):
        command = command or f"bothouse send --image '{self.file}'"
        payload = {"hook_event_name": "PreToolUse", "tool_name": "Bash",
                   "cwd": str(self.role), "transcript_path": str(self.log),
                   "tool_input": {"command": command}}
        flags = []
        if cli == "gemini":
            payload.update(hook_event_name="BeforeTool", tool_name="run_shell_command")
        elif cli == "grok":
            flags = ["--grok"]
            payload["tool_name"] = "run_terminal_command"
        elif cli == "dsh":
            payload["tool_name"] = "bash"
        elif cli == "codex":
            flags = ["--codex"]
        elif cli == "agy":
            flags = ["--agy", "PreToolUse"]
            payload = {"workspacePaths": [str(self.role)],
                       "toolCall": {"name": "run_command", "args": {"CommandLine": command}}}
        result = subprocess.run(
            [sys.executable, "-I", str(HERE / "run.py"), "--role", str(self.role), *flags, "bash-guard"],
            input=json.dumps(payload), capture_output=True, text=True, env=self.env, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("passing\n", result.stderr, result.stderr)
        output = json.loads(result.stdout or "{}")
        return output.get("decision") or output.get("hookSpecificOutput", {}).get("permissionDecision")

    def test_open_sheet_blocks_then_complete_check_allows(self):
        for cli in ("", "codex", "gemini", "grok", "dsh", "agy"):
            with self.subTest(cli=cli):
                self.assertEqual(self.call(cli), "deny")
        self.sheet("check", "cover", self.file, "the final image has the required color")
        for cli in ("", "codex", "gemini", "grok", "dsh", "agy"):
            with self.subTest(cli=cli):
                self.assertNotEqual(self.call(cli), "deny")

    def test_new_requirement_and_changed_file_invalidate_check(self):
        self.sheet("check", "cover", self.file, "color checked")
        self.sheet("add", "cover", "use the required title")
        self.assertEqual(self.call(), "deny")
        self.sheet("check", "cover", self.file, "color checked", "title checked")
        self.file.write_bytes(b"changed artifact")
        self.assertEqual(self.call(), "deny")

    def test_disabled_check_and_plain_text_pass(self):
        self.assertNotEqual(self.call(command="bothouse send 'status'"), "deny")
        switch = self.role / ".bothouse" / "conest-hooks.json"
        switch.parent.mkdir()
        switch.write_text(json.dumps({"off": ["deliver-check"]}))
        for cli in ("", "agy"):
            self.assertNotEqual(self.call(cli), "deny")

    def test_copy_draft_needs_three_verbatim_refs_and_tags(self):
        # #1907：对外文案稿发出前，稿里要先摆对标原句；没摆、条数不够、我们的文案漏标照哪条，都拦
        draft = self.role / "intro.md"
        cmd = f"bothouse send --file '{draft}'"
        draft.write_text("# GitHub 简介\n\n住在你群聊里的 AI 团队，自己分活。\n", encoding="utf-8")
        self.sheet("skip", draft, "copy gate test")
        self.assertEqual(self.call(command=cmd), "deny")
        draft.write_text(
            "# GitHub 简介\n\n## 对标原文\n"
            "1. 原句：An on-device AI agent for Android. 出处：https://github.com/wangzan101/Mika\n"
            "2. 原句：Every agent's model. One place. 出处：https://github.com/yetone/magpie\n"
            "3. 原句：Agent harness for learning difficult things. 出处：https://github.com/amosblomqvist/learnharness\n"
            "\n我们：「An AI team in your group chat.」 照：第 1 条\n", encoding="utf-8")
        self.sheet("skip", draft, "copy gate test")
        self.assertNotEqual(self.call(command=cmd), "deny")
        draft.write_text(draft.read_text(encoding="utf-8").replace(" 照：第 1 条", ""), encoding="utf-8")
        self.sheet("skip", draft, "copy gate test")
        self.assertEqual(self.call(command=cmd), "deny")
        draft.write_text(draft.read_text(encoding="utf-8").replace("3. 原句", "3. 删掉").replace(
            " 出处：https://github.com/amosblomqvist/learnharness", ""), encoding="utf-8")
        self.sheet("skip", draft, "copy gate test")
        self.assertEqual(self.call(command=cmd), "deny")

    def test_copy_text_send_needs_reference_section(self):
        self.assertEqual(self.call(command="bothouse send -m '**GitHub 简介**：住在你群聊里的 AI 团队。'"), "deny")

    def test_plain_markdown_and_plain_text_send_pass(self):
        note = self.role / "weekly.md"
        note.write_text("# 周报\n\n今天跑完三个测试。\n", encoding="utf-8")
        self.sheet("skip", note, "not a copy draft")
        self.assertNotEqual(self.call(command=f"bothouse send --file '{note}'"), "deny")
        self.assertNotEqual(self.call(command="bothouse send -m '今日进度：三个测试跑完'"), "deny")

    def stop(self, reply, active=False):
        self.log.write_text(json.dumps({"type": "assistant", "message": {"content": [{"type": "text", "text": reply}]}},
                                       ensure_ascii=False) + "\n", encoding="utf-8")
        payload = {"hook_event_name": "Stop", "cwd": str(self.role), "transcript_path": str(self.log),
                   "session_id": "s", "stop_hook_active": active}
        result = subprocess.run(
            [sys.executable, "-I", str(HERE / "run.py"), "--role", str(self.role), "choice-ask-guard"],
            input=json.dumps(payload), capture_output=True, text=True, env=self.env, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        out = json.loads(result.stdout or "{}")
        return out.get("decision"), out.get("reason") or ""

    def test_chat_reply_with_copy_needs_reference_section(self):
        # #1907 打回①：聊天里直接打出来的简介也要过这道检查（Stop），拦下时告诉它补什么
        decision, reason = self.stop("仓库简介改成这样：\n\nAn AI team that lives in your group chat.\n")
        self.assertEqual(decision, "block")
        self.assertIn("## 对标原文", reason)
        ok = ("## 对标原文\n"
              "1. 原句：An on-device AI agent for Android. 出处：https://github.com/wangzan101/Mika\n"
              "2. 原句：Every agent's model. One place. 出处：https://github.com/yetone/magpie\n"
              "3. 原句：Agent harness for learning difficult things. 出处：https://github.com/amosblomqvist/learnharness\n"
              "\n仓库简介：An AI team in your group chat. 照：第 1 条\n")
        self.assertNotEqual(self.stop(ok)[0], "block")
        self.assertNotEqual(self.stop("测试跑完了，退出码 0。")[0], "block")
        self.assertNotEqual(self.stop("仓库简介改成这样：xx", active=True)[0], "block")

    def test_copy_words_cover_entries(self):
        # #1907 打回③：简介/README/宣传语/标题/帖子这类入口的写法都认得
        for line in ("**README 首屏**", "## Tagline", "- 宣传语：", "新标题：", "X 推文（英文）：", "小红书帖子：",
                     "GitHub About:", "口号：", "一句话介绍：", "## 发帖正文"):
            self.assertEqual(self.stop(line + "\n住在你群聊里的 AI 团队。")[0], "block", line)

    def test_send_command_quoted_in_heredoc_is_data(self):
        # 交回里会原样引用一条 send 命令当例子；按正文解析会把它当成真在发（#1907 交回被自己拦住）
        report = ("ws-up --notes /tmp/h.md --report - <<'EOF'\n"
                  "能拦住的是 bothouse send --file '/现在还不存在的稿.md' 这条\nEOF\n")
        self.assertNotEqual(self.call(command=report), "deny")

    def test_codex_original_image_read_survives_normalization(self):
        self.sheet("check", "cover", self.file, "color checked")
        events = [
            {"type": "response_item", "payload": {"type": "message", "role": "user",
                                                 "content": [{"type": "input_text", "text": "send image"}]}},
            {"type": "response_item", "timestamp": "2099-01-01T00:00:00Z",
             "payload": {"type": "function_call", "name": "view_image", "call_id": "read",
                         "arguments": json.dumps({"path": str(self.file)})}},
        ]
        self.log.write_text("\n".join(map(json.dumps, events)) + "\n")
        self.assertNotEqual(self.call("codex"), "deny")
        self.log.write_text(json.dumps(events[0]) + "\n")
        self.assertEqual(self.call("codex"), "deny")

    def test_codex_code_mode_nested_read_and_image_view_count(self):
        # 11-06 隔壁龙娘：functions.exec 里嵌套 cat 报告、看压缩包预览图，旧钩子认不出被拦
        self.sheet("check", "cover", self.file, "color checked")
        user = {"type": "response_item", "payload": {"type": "message", "role": "user",
                                                    "content": [{"type": "input_text", "text": "send it"}]}}
        cat = {"type": "event_msg", "timestamp": "2099-01-01T00:00:00Z",
               "payload": {"type": "item_completed", "item": {
                   "type": "CommandExecution", "id": "exec-1", "cwd": "file://" + str(self.file.parent),
                   "status": "completed", "exit_code": 0,
                   "parsed_cmd": [{"type": "read", "cmd": "cat " + self.file.name, "path": self.file.name}]}}}
        view = {"type": "event_msg", "timestamp": "2099-01-01T00:00:00Z",
                "payload": {"type": "item_completed", "item": {
                    "type": "ImageView", "id": "exec-2", "path": "file://" + str(self.file)}}}
        failed = json.loads(json.dumps(cat))
        failed["payload"]["item"]["exit_code"] = 1
        for ev in (cat, view):
            self.log.write_text("\n".join(map(json.dumps, [user, ev])) + "\n")
            self.assertNotEqual(self.call("codex"), "deny")
        self.log.write_text("\n".join(map(json.dumps, [user, failed])) + "\n")
        self.assertEqual(self.call("codex"), "deny")
        self.log.write_text("\n".join(map(json.dumps, [cat, user])) + "\n")
        self.assertEqual(self.call("codex"), "deny")

    def test_claude_requires_read_after_latest_file_change(self):
        self.sheet("check", "cover", self.file, "color checked")
        events = [
            {"type": "user", "message": {"content": "send image"}},
            {"type": "assistant", "timestamp": "2000-01-01T00:00:00Z",
             "message": {"content": [{"type": "tool_use", "name": "Read", "id": "read",
                                       "input": {"file_path": str(self.file)}}]}},
        ]
        self.log.write_text("\n".join(map(json.dumps, events)) + "\n")
        self.assertEqual(self.call(), "deny")
        events[1]["timestamp"] = "2099-01-01T00:00:00Z"
        self.log.write_text("\n".join(map(json.dumps, events)) + "\n")
        self.assertNotEqual(self.call(), "deny")


if __name__ == "__main__":
    unittest.main()
