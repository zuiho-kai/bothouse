"""秒级单元测试：发言锁不变量、用户打断、上限即停。不调用 claude。"""
from __future__ import annotations

import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from rh.brain import Cancelled
from rh.config import Role
from rh.lock import SpeakingLock
from rh.meeting import Meeting


class FakeBrain:
    """立即返回固定文字；可设置生成耗时，cancel 时抛 Cancelled。"""

    def __init__(self, name: str, delay: float = 0.0, text: str = "我说两句话测试一下。"):
        self.name, self.delay, self.text = name, delay, text
        self._cancel = threading.Event()
        self.calls = 0

    def reply(self, new_messages: str) -> str:
        self.calls += 1
        self._cancel.clear()
        if self._cancel.wait(self.delay):
            raise Cancelled()
        return f"{self.name}:{self.text}"

    def cancel(self) -> None:
        self._cancel.set()


ROLES = [Role("a", "A", "p"), Role("b", "B", "p"), Role("c", "C", "p")]


def make(max_turns=6, delay=0.0, chars_per_sec=200.0, log=None):
    brains = {r.id: FakeBrain(r.name, delay) for r in ROLES}
    return Meeting(ROLES, brains, max_turns, chars_per_sec, log_path=log), brains


class SpeakingLockTest(unittest.TestCase):
    def test_first_come_first_served_no_queue(self):
        lk = SpeakingLock()
        got = lk.try_acquire("a")
        self.assertIsNotNone(got)
        self.assertIsNone(lk.try_acquire("b"))       # 被占用就拿不到，不排队
        self.assertTrue(lk.release("a", got[0]))
        self.assertIsNotNone(lk.try_acquire("b"))

    def test_interrupt_releases_and_signals(self):
        lk = SpeakingLock()
        token, ev = lk.try_acquire("a")
        self.assertEqual(lk.interrupt(), "a")
        self.assertTrue(ev.is_set())
        self.assertIsNone(lk.holder)
        self.assertFalse(lk.release("a", token))       # 旧 token 作废
        self.assertIsNotNone(lk.try_acquire("b"))

    def test_invariant_under_contention(self):
        """32 个线程抢锁 2000 次，任意时刻持有者不超过 1。"""
        lk, inside, worst, mu = SpeakingLock(), [0], [0], threading.Lock()

        def worker(i):
            for _ in range(2000):
                got = lk.try_acquire(f"r{i}")
                if got:
                    with mu:
                        inside[0] += 1
                        worst[0] = max(worst[0], inside[0])
                    with mu:
                        inside[0] -= 1
                    lk.release(f"r{i}", got[0])

        ts = [threading.Thread(target=worker, args=(i,)) for i in range(32)]
        [t.start() for t in ts]
        [t.join() for t in ts]
        self.assertLessEqual(worst[0], 1)


class MeetingTest(unittest.TestCase):
    def test_stops_at_max_turns(self):
        m, brains = make(max_turns=4)
        m.user_say("话题")
        m.wait_idle(5)
        roles_spoken = [x.author for x in m.messages if x.author in ("a", "b", "c")]
        self.assertEqual(roles_spoken, ["a", "b", "c", "a"])  # 轮流，到 4 轮停
        self.assertTrue(all(x.status == "done" for x in m.messages if x.author in ("a", "b", "c")))
        self.assertIn("上限", m.messages[-1].text)
        self.assertEqual(sum(b.calls for b in brains.values()), 4)

    def test_at_most_one_speaking_at_any_time(self):
        m, _ = make(max_turns=9)
        seen_max, stop = [0], threading.Event()

        def watch():
            while not stop.is_set():
                with m._mu:
                    n = sum(1 for x in m.messages if x.status == "speaking")
                seen_max[0] = max(seen_max[0], n)

        w = threading.Thread(target=watch)
        w.start()
        m.user_say("话题")
        m.wait_idle(5)
        stop.set()
        w.join()
        self.assertEqual(seen_max[0], 1)

    def test_user_interrupts_current_speaker(self):
        m, _ = make(max_turns=6, chars_per_sec=2.0)  # 每句约 7 秒，保证打断时正在说
        m.user_say("话题一")
        deadline = time.time() + 2
        while m.speaking() is None and time.time() < deadline:
            time.sleep(0.01)
        sp = m.speaking()
        self.assertIsNotNone(sp)
        t0 = time.time()
        m.user_say("插话")
        self.assertLess(time.time() - t0, 0.5)          # 立刻打断
        self.assertEqual(sp.status, "interrupted")
        self.assertIsNotNone(sp.end)
        # 新话题里第一个角色重新拿到锁开始说
        deadline = time.time() + 2
        while (m.speaking() is None or m.speaking().id == sp.id) and time.time() < deadline:
            time.sleep(0.01)
        self.assertEqual(m.lock.holder, "a")
        self.assertEqual(m.snapshot()["turn"], 1)
        m.user_say("再插话")  # 收尾
        m.lock.interrupt()

    def test_user_interrupt_cancels_pending_generation(self):
        m, brains = make(max_turns=6, delay=10.0)  # 生成很慢
        m.user_say("话题一")
        time.sleep(0.05)
        t0 = time.time()
        m.user_say("换个话题")
        self.assertLess(time.time() - t0, 0.5)
        old_role_msgs = [x for x in m.messages if x.author in ("a", "b", "c")]
        self.assertEqual(old_role_msgs, [])

    def test_log_has_no_overlap(self):
        with tempfile.TemporaryDirectory() as d:
            log = Path(d) / "s.jsonl"
            m, _ = make(max_turns=3, chars_per_sec=100.0, log=log)
            m.user_say("话题")
            m.wait_idle(5)
            r = subprocess.run([sys.executable, str(ROOT / "tools/check_overlap.py"), str(log)],
                               capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stdout)
            self.assertIn("3 段发言，0 个问题", r.stdout)


if __name__ == "__main__":
    unittest.main()
