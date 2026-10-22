#!/usr/bin/env python3
"""promise-guard.py 的秒级单测：造一段 transcript，走真实的 stdin → hook → stdout 路径。
运行：python3 -I bridge/contrib/hooks/test_promise_guard.py"""
import json, os, subprocess, sys, tempfile, unittest

HOOK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "promise-guard.py")
A = "pm_v2 全量还在跑，01:18 我回来看进度。"  # 原句 A（2026-10-18 00:22 JST）
B = "今天已经花了 7.03 美元。我 02:49 回来看重测结果。"  # 原句 B（2026-10-18 02:07 JST）
_n = [0]


def user(text):
    return {"type": "user", "message": {"role": "user", "content": text}}


def tool(name, inp, ts="2026-10-17T17:07:00Z", result="ok"):
    _n[0] += 1
    tid = f"toolu_{_n[0]}"
    return [
        {"type": "assistant", "timestamp": ts, "message": {"content": [{"type": "tool_use", "id": tid, "name": name, "input": inp}]}},
        {"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": tid, "content": result}]}},
    ]


def say(text):
    return {"type": "assistant", "message": {"content": [{"type": "text", "text": text}]}}


TIMER = ("Bash", {"command": 'cc-connect timer add --delay 30m --prompt "回来看 pm_v2 进度"'})
BG_BASH = ("Bash", {"command": "python3 run2.py full", "run_in_background": True})
BG_AGENT = ("Agent", {"description": "低并发重测", "prompt": "..."})


def run(final, tools=(), before=(), stop_active=False):
    """tools: [(name, input)] 或已经展开好的条目；before: 前几轮的条目。返回 hook 输出（空 = 放行）。"""
    entries = list(before) + [user("进度怎么样")]
    for t in tools:
        entries += tool(*t) if isinstance(t, tuple) else [t]
    entries.append(say(final))
    with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False, encoding="utf-8") as f:
        f.write("\n".join(json.dumps(e, ensure_ascii=False) for e in entries))
    try:
        inp = {"transcript_path": f.name, "stop_hook_active": stop_active, "last_assistant_message": final}
        out = subprocess.run([sys.executable, "-I", HOOK], input=json.dumps(inp), capture_output=True, text=True, timeout=10)
        assert out.returncode == 0, out.stderr
        return out.stdout.strip()
    finally:
        os.unlink(f.name)


class Replay(unittest.TestCase):
    def blocked(self, *a, **k):
        out = run(*a, **k)
        self.assertTrue(out, "应拦未拦")
        d = json.loads(out)
        self.assertEqual(d["decision"], "block")
        return d["reason"]

    def passed(self, *a, **k):
        self.assertEqual(run(*a, **k), "", "应放未放")

    # 原句 A
    def test_A_no_timer_blocks(self):
        r = self.blocked(A)
        self.assertIn("cc-connect timer add --delay 30m", r)
        self.assertIn("不跟进，原因是", r)
        self.assertNotIn("删掉", r)

    def test_A_timer_passes(self):
        self.passed(A, [TIMER])

    def test_A_night_outing_next_blocks(self):
        # 实际出事那轮用的是 outing-next 1h（00:15 JST 定，01:15 醒），outing-tick 深夜不跑
        self.blocked(A, [("Bash", {"command": "~/bin/outing-next 1h"}, "2026-10-17T15:15:00Z"),
                         ("Bash", {"command": "~/bin/outing-next 60m"}, "2026-10-17T15:15:00Z")])

    # 原句 B
    def test_B_bg_bash_only_blocks(self):
        self.blocked(B, [BG_BASH])

    def test_B_bg_agent_only_blocks(self):
        self.blocked(B, [BG_AGENT])

    def test_B_timer_passes(self):
        self.passed(B, [BG_AGENT, TIMER])

    def test_schedule_wakeup_passes(self):
        self.passed(B, [("ScheduleWakeup", {"delaySeconds": 1800, "prompt": "回来看"})])

    def test_failed_timer_blocks(self):
        _n[0] += 1
        tid = f"toolu_{_n[0]}"
        failed = [{"type": "assistant", "message": {"content": [{"type": "tool_use", "id": tid, "name": "Bash", "input": TIMER[1]}]}},
                  {"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": tid, "is_error": True, "content": "error"}]}}]
        self.blocked(B, failed)

    def test_day_outing_next_passes(self):
        # 14:05 JST 定 30m，14:35 醒，在 outing-tick 的 9–22 点里
        self.passed("14 点 35 分左右出结果，我看完就告诉你。", [("Bash", {"command": "outing-next 30m"}, "2026-10-18T05:05:00Z")])

    def test_repeat_of_earlier_timer_passes(self):
        before = [user("开始吧")] + tool(*TIMER) + [say("我订了一个 19:15 的检查提醒。")]
        self.passed("19:15 我会再看一次进度。", before=before)

    # 下一步
    def test_next_not_dispatched_blocks(self):
        self.blocked("下一步我去改 run2.py 的并发上限。", [("Bash", {"command": "ls"})])

    def test_next_agent_passes(self):
        self.passed("下一步我去改 run2.py 的并发上限。", [("Agent", {"description": "改并发", "prompt": "..."})])

    def test_next_mention_passes(self):
        self.passed("<@123456789012345678> 这个交给你。下一步我去改 run2.py 的并发上限。")

    # 等结果
    def test_wait_no_bg_blocks(self):
        self.blocked("跑完我再告诉你结果。", [("Bash", {"command": "ls"})])

    def test_wait_bg_bash_passes(self):
        self.passed("跑完我再告诉你结果。", [BG_BASH])

    def test_wait_pending_bg_from_earlier_turn_passes(self):
        before = [user("跑一下")] + tool("Agent", {"prompt": "..."}, result="Async agent launched successfully.\nagentId: abc123 (internal ID)") + [say("派出去了。")]
        self.passed("结果出来再告诉你。", before=before)

    def test_wait_finished_bg_does_not_count(self):
        before = ([user("跑一下")] + tool("Agent", {"prompt": "..."}, result="Async agent launched successfully.\nagentId: abc123 (internal ID)")
                  + [say("派出去了。"), user("<task-notification><task-id>abc123</task-id></task-notification>"), say("收到。")])
        self.blocked("结果出来再告诉你。", before=before)

    def test_wait_with_clock_needs_timer(self):
        self.blocked("照现在的速度，大约 22:15 跑完，结果出来我核过数字就发给你。", [BG_BASH])

    # 放行
    def test_proposal_passes(self):
        self.passed("你要的话我可以下一步去改 run2.py。")
        self.passed("要我注册个号跑一遍吗？跑完我再告诉你值不值得留着。")
        self.passed("建议下一步先测 DS 返不返回 logprobs。")

    def test_opt_out_passes(self):
        self.passed("pm_v2 全量还在跑，01:18 我回来看进度。这件事我不跟进了，原因是实验已经停了。")

    def test_past_tense_passes(self):
        self.passed("我 10 点看过了，没问题。")
        self.passed("我定了一小时后才回来看，到点又被别的事岔开。")
        self.passed("好的，我先不跑，什么都不动。")

    def test_existing_schedule_passes(self):
        self.passed("14:00 照常出来，到时候看看 HN 下午有没有新东西。")

    def test_quoted_passes(self):
        self.passed("实际出过事的原话是「01:18 我回来看进度」。")

    def test_stop_hook_active_passes(self):
        self.passed(A, stop_active=True)

    def test_completed_report_passes(self):
        self.passed("【结论】成了。【接下来】无。【要你做的】无。")


if __name__ == "__main__":
    unittest.main(verbosity=1)
