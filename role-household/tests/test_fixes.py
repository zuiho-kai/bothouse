"""代码审查（~/.claude/reviews/role-household-m0-code.md）1-8 条的回归测试。用假 claude，不调真模型。"""
from __future__ import annotations

import json
import os
import signal
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FAKEBIN = ROOT / "tests" / "fakebin"
sys.path.insert(0, str(ROOT))

from rh.brain import Cancelled, ClaudeBrain
from rh.config import Role
from rh.meeting import MAX_TEXT_CHARS, Meeting, strip_own_prefix

ROLES = [Role("a", "A", "p"), Role("b", "B", "p")]


class FakeEnv(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self._env = dict(os.environ)
        os.environ["PATH"] = f"{FAKEBIN}:{os.environ['PATH']}"
        os.environ["FAKE_DIR"] = self.dir
        os.environ.pop("FAKE_MODE", None)
        os.environ.pop("FAKE_SLEEP", None)

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._env)

    def brain(self, timeout=10.0, role=ROLES[0]):
        return ClaudeBrain(role, ["X"], "haiku", timeout, Path(self.dir) / role.id)

    def meeting(self, timeout=10.0, max_turns=2, chars_per_sec=1000.0):
        brains = {r.id: self.brain(timeout, r) for r in ROLES}
        return Meeting(ROLES, brains, max_turns, chars_per_sec, sleep_scale=0.01)

    def calls(self):
        p = Path(self.dir) / "calls"
        return [tuple(map(int, l.split())) for l in p.read_text().split("\n") if l] if p.exists() else []


class Fix1SessionRecovery(FakeEnv):
    """1. 首次调用失败（is_error / 非 0 退出 / 超时）后，下一次能用新会话正常回答。"""

    def check(self, mode, timeout=10.0, exc=RuntimeError):
        os.environ["FAKE_MODE"] = mode
        b = self.brain(timeout)
        sid = b.session_id
        with self.assertRaises(exc):
            b.reply("hi")
        self.assertNotEqual(b.session_id, sid)
        self.assertEqual(b.reply("hi"), "嗯。")

    def test_is_error(self):
        self.check("is_error_first")

    def test_exit_nonzero(self):
        self.check("exit1_first")

    def test_timeout(self):
        self.check("sleep_first", timeout=0.5)

    def test_meeting_recovers_next_topic(self):
        os.environ["FAKE_MODE"] = "is_error_first"
        m = self.meeting()
        m.user_say("话题0"); m.wait_idle(10)
        m.user_say("话题1"); m.wait_idle(10)
        self.assertIn("出错", m.messages[1].text)
        self.assertEqual([x.status for x in m.messages[3:5]], ["done", "done"])


class Fix2PoisonMessage(FakeEnv):
    """2. NUL / 超长消息不再让频道一直坏。"""

    def test_nul_then_normal_topic(self):
        m = self.meeting()
        m.user_say("坏\x00消息"); m.wait_idle(10)
        m.user_say("正常话题"); m.wait_idle(10)
        self.assertEqual(m.messages[0].text, "坏消息")
        self.assertFalse([x for x in m.messages if "出错" in x.text])

    def test_long_message_truncated(self):
        m = self.meeting()
        m.user_say("长" * 2_000_000); m.wait_idle(10)
        self.assertEqual(len(m.messages[0].text), MAX_TEXT_CHARS)
        self.assertEqual(m.messages[1].status, "done")

    def test_prompt_goes_via_stdin(self):
        """绕过 clean 直接给大脑 NUL 和 2MB 文本：走 stdin，不会 embedded null byte / E2BIG。"""
        b = self.brain()
        self.assertEqual(b.reply("x\x00y"), "嗯。")
        self.assertEqual(b.reply("长" * 2_000_000), "嗯。")
        self.assertGreater(self.calls()[-1][1], 2_000_000)


class Fix4Grandchild(FakeEnv):
    """4. claude 留了继承管道的子进程时，打断和超时都不卡。"""

    def test_interrupt_not_blocked(self):
        os.environ.update(FAKE_MODE="grandchild", FAKE_SLEEP="5")
        m = self.meeting()
        m.user_say("话题1"); time.sleep(1)
        t = time.time(); m.user_say("插话"); dt = time.time() - t
        print(f"  user_say 阻塞 {dt:.2f}s")
        self.assertLess(dt, 0.5)
        for b in m.brains.values():  # 收尾：杀掉新话题里的生成
            b.cancel()
        m.wait_idle(10)

    def test_timeout_not_blocked(self):
        os.environ.update(FAKE_MODE="grandchild", FAKE_SLEEP="5")
        b = self.brain(timeout=0.5)
        t = time.time()
        with self.assertRaises(RuntimeError):
            b.reply("hi")
        print(f"  超时返回用了 {time.time() - t:.2f}s")
        self.assertLess(time.time() - t, 2)


class Fix5Unsaid(unittest.TestCase):
    """5. 没说出去 / 只说了一部分的话，下一轮 prompt 里如实告诉角色。"""

    def test_partial_and_unsaid(self):
        from tests.test_meeting import FakeBrain
        prompts = {"a": [], "b": []}

        class Rec(FakeBrain):
            def reply(self, msgs):
                prompts[self.name.lower()].append(msgs)
                return super().reply(msgs)

        brains = {"a": Rec("A", text="一二三四五六七八九十" * 3), "b": Rec("B", delay=10)}
        m = Meeting(ROLES, brains, 4, 10.0)  # 每秒 10 字
        m.user_say("话题")
        while m.speaking() is None:
            time.sleep(0.01)
        time.sleep(0.5)
        m.user_say("插话")  # A 说到约 5 字被打断
        sp = m.messages[1]
        self.assertEqual(sp.status, "interrupted")
        self.assertTrue(3 <= sp.spoken <= 8, sp.spoken)
        while len(prompts["a"]) < 2:
            time.sleep(0.01)
        self.assertIn(f"你上一句只说出了「{sp.text[:sp.spoken]}」就被用户打断", prompts["a"][1])
        # B 的视角（B 还没读过这条）：A 只说了前半句
        view_b, _ = m._transcript_for("b")
        self.assertIn(f"A说「{sp.text[:sp.spoken]}……」（话没说完就被用户打断了）", view_b)
        self.assertNotIn(f"A说「{sp.text}」\n用户说「插话」", view_b)  # 被打断那句不以整句出现
        print("  B 看到：", view_b.splitlines()[2])
        m.user_say("收尾"); m.lock.interrupt()

    def test_generated_but_topic_changed(self):
        from tests.test_meeting import FakeBrain
        got = []

        class Slow(FakeBrain):
            def reply(self, msgs):
                got.append(msgs)
                time.sleep(0.3)  # 不响应 cancel，模拟生成刚好完成
                return "我想说的话"

            def cancel(self):
                pass

        brains = {"a": Slow("A"), "b": FakeBrain("B")}
        m = Meeting(ROLES, brains, 1, 1000.0)
        m.user_say("话题1"); time.sleep(0.1)
        m.user_say("话题2")  # 等旧线程退出：A 的回复已生成但话题已换
        m.wait_idle(5)
        self.assertIn("你上次想说「我想说的话」", got[-1])
        self.assertEqual([x.text for x in m.messages if x.author == "a"], ["我想说的话"])


class Fix6ExternalKill(FakeEnv):
    """6. claude 被外部信号杀掉：报错并发系统消息，不当成打断悄悄停。"""

    def test_selfkill(self):
        os.environ["FAKE_MODE"] = "selfkill"
        with self.assertRaises(RuntimeError) as cm:
            self.brain().reply("hi")
        self.assertNotIsInstance(cm.exception, Cancelled)
        m = self.meeting()
        m.user_say("话题"); m.wait_idle(10)
        print("  ", m.messages[-1].text)
        self.assertIn("被信号 9 杀掉", m.messages[-1].text)


class Fix7Sigterm(FakeEnv):
    """7. 角色主机收到 SIGTERM 时，正在跑的 claude 子进程一起清掉（hub 和 host 都在本机，127.0.0.1）。"""

    def test_sigterm_cleans_children(self):
        os.environ.update(FAKE_SLEEP="30", RH_HUB_TOKEN="t")
        port = 18000 + os.getpid() % 1000
        url = f"http://127.0.0.1:{port}"
        hub = subprocess.Popen([sys.executable, "-m", "rh.hub", "--port", str(port),
                                "--db", str(Path(self.dir) / "hub.sqlite3")], cwd=ROOT,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        host = None
        try:
            self.wait_http(url)
            host = subprocess.Popen([sys.executable, "-m", "rh.host", "--hub", url, "--no-voice",
                                     "--config", str(ROOT / "roles.example.toml"),   # 不依赖本地 roles.toml
                                     "--state", str(Path(self.dir) / "state.json"),
                                     "--log", str(Path(self.dir) / "s.jsonl")], cwd=ROOT,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            db = Path(self.dir) / "hub.sqlite3"
            for _ in range(200):   # 等主机连上（成员表上报进云端库了）
                con = sqlite3.connect(db)
                n = con.execute("SELECT COUNT(*) FROM members").fetchone()[0]
                con.close()
                if n:
                    break
                time.sleep(0.05)
            self.hub_post(url, "/api/rooms/1/messages", {"text": "hi"})
            for _ in range(200):
                if self.calls():
                    break
                time.sleep(0.05)
            pid = self.calls()[0][0]
            os.kill(pid, 0)  # 假 claude 正在跑
            host.send_signal(signal.SIGTERM)
            host.wait(10)
            time.sleep(0.2)
            with self.assertRaises(ProcessLookupError):
                os.kill(pid, 0)
            print(f"   SIGTERM 后主机退出码 {host.returncode}，claude 子进程 {pid} 已不在")
        finally:
            for p in (host, hub):
                if p is not None and p.poll() is None:
                    p.kill()
                    p.wait()

    @staticmethod
    def wait_http(url):
        for _ in range(200):
            try:
                urllib.request.urlopen(url + "/", timeout=1).read()
                return
            except OSError:
                time.sleep(0.05)

    @staticmethod
    def _req(url, path, method, body=None):
        req = urllib.request.Request(url + path, method=method, headers={
            "Authorization": "Bearer t", "Content-Type": "application/json"},
            data=None if body is None else json.dumps(body).encode())
        return json.load(urllib.request.urlopen(req, timeout=5))

    def hub_post(self, url, path, body):
        return self._req(url, path, "POST", body)


class FixASurrogate(FakeEnv):
    """复审 A：落单代理字符不再让日志 / state / brain 崩，也不留卡在 stdin 的 claude。"""

    def test_clean(self):
        from rh.meeting import clean
        self.assertEqual(clean("hi \ud800 x"), "hi ? x")
        clean("\udfff").encode("utf-8")  # 不抛

    def test_meeting_log_and_next_topic(self):
        m = self.meeting()
        m._log_path = Path(self.dir) / "log.jsonl"
        m.user_say("hi \ud800 x")
        m.wait_idle(10)
        m.user_say("normal")
        m.wait_idle(10)
        print("  ", [(x.author, x.status, x.text) for x in m.messages])
        self.assertEqual(m.messages[0].text, "hi ? x")
        self.assertFalse([x for x in m.messages if "出错" in x.text])
        self.assertIn("hi ? x", (Path(self.dir) / "log.jsonl").read_text(encoding="utf-8"))

    def test_brain_direct_no_stuck_process(self):
        b = self.brain()
        self.assertEqual(b.reply("x \ud800"), "嗯。")
        ps = subprocess.run(["pgrep", "-f", str(FAKEBIN / "claude")], capture_output=True, text=True).stdout
        self.assertEqual(ps.strip(), "")


class FixBCancelRace(FakeEnv):
    """复审 B：cancel 碰上刚好生成完，回复不丢；已退出的进程不再 killpg。"""

    def test_cancel_after_exit_is_noop(self):
        from unittest import mock
        b = self.brain()
        p = subprocess.Popen(["true"]); p.wait()
        b._proc = p
        with mock.patch("rh.brain.os.killpg") as kp:
            b.cancel()
        kp.assert_not_called()
        self.assertFalse(b._cancelled)

    def test_cancel_flag_but_exit_0_returns_text(self):
        """模拟 cancel 在进程正常退出之后、结果判定之前落地（旧代码会当成打断丢掉）。"""
        from unittest import mock
        b = self.brain()
        orig = subprocess.Popen.communicate

        def comm(proc, *a, **k):
            r = orig(proc, *a, **k)
            b._cancelled = True
            return r

        with mock.patch.object(subprocess.Popen, "communicate", comm):
            self.assertEqual(b.reply("hi"), "嗯。")


class OwnNamePrefix(unittest.TestCase):
    """22:24 真跑里彩虹猫的话以“彩虹猫发言：”“彩虹猫：”开头，频道显示、TTS 都念了。"""

    def test_history_not_script_format(self):
        from tests.test_meeting import FakeBrain
        roles = [Role("ju", "橘", "p"), Role("mao", "彩虹猫", "p")]
        brains = {r.id: FakeBrain(r.name) for r in roles}
        prompts = []
        orig = brains["mao"].reply
        brains["mao"].reply = lambda msgs: (prompts.append(msgs), orig(msgs))[1]
        m = Meeting(roles, brains, 2, 2000.0)
        m.user_say("海边？")
        m.wait_idle(5)
        said = [x.text for x in m.messages if x.author in ("ju", "mao")]
        self.assertEqual(said, ["我说两句话测试一下。"] * 2)  # FakeBrain 回的是“名字:…”，前缀被兜底剥掉
        view = prompts[0]
        self.assertIn("用户说「海边？」", view)
        self.assertIn("橘说「我说两句话测试一下。」", view)
        self.assertNotIn("橘：", view)

    def test_strip_own_prefix(self):
        for raw in ["彩虹猫发言：海边好", "彩虹猫：海边好", " 彩虹猫说: 海边好"]:
            self.assertEqual(strip_own_prefix(raw, "彩虹猫"), "海边好", raw)
        for keep in ["橘说得对，海边好", "彩虹猫觉得海边好", "鲸鱼娘：海边好"]:
            self.assertEqual(strip_own_prefix(keep, "彩虹猫"), keep)
        self.assertEqual(strip_own_prefix("彩虹猫：", "彩虹猫"), "彩虹猫：")  # 只有前缀时不剥成空串


if __name__ == "__main__":
    unittest.main()
