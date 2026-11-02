#!/usr/bin/env python3
"""PreToolUse(Bash): 拦截主对话流中的高频短周期状态轮询（防空转死刷）。
出处：Issue #757 与 10-30 事故复盘（模型一分钟自查一次额度回执，一小时 50 余遍消耗数百万 Token 并吃 429）。
规则：
1. 严禁在主对话流中使用短周期定时器（<10分钟）肉身唤醒大模型轮询状态。
2. 周期性状态监测强制走 --poll 轻量脚本模式（bothouse cron add --poll --exec '<脚本>'），或等待冷却到期自动探活。
3. 放行：时长 >= 10 分钟的普通定时器、带 --exec / addexec 的纯脚本执行、带 --poll 的定时监测。
"""
import json, os, re, sys

# 来源 Issue #757: 低于 10 分钟视为短周期空转轮询
MIN_DELAY_SECONDS = 600

TIMER_CMD = re.compile(r"""(?:\bbothouse\b|\bcc-connect\b)?\s*timer\s+add\b""")
DELAY_RE = re.compile(r"""--delay[=\s]+['"]?(\d+)([smhd])['"]?""")
PROMPT_RE = re.compile(r"""--prompt[=\s]+(['"])(.*?)\1""")
POLL_WORDS = re.compile(r"""(?:额度|用量|回执|429|冷却|到期|quota|status|poll|rate[ _-]?limit|credit|token|探活|状态|恢复了没|有没有新)""", re.I)
EXEC_FLAG = re.compile(r"""(?:--exec\b|\baddexec\b)""")
POLL_FLAG = re.compile(r"""--poll\b""")

# 秒/分/时/天换算成秒；单位写法来源：bothouse timer add --help
UNIT_S = {"s": 1, "m": 60, "h": 3600, "d": 86400}

def parse_delay_seconds(cmd):
    m = DELAY_RE.search(cmd)
    if not m:
        return None
    val, unit = int(m.group(1)), m.group(2)
    return val * UNIT_S.get(unit, 1)

def check_command(cmd):
    if not TIMER_CMD.search(cmd):
        return None
    # 纯脚本执行模式或带 poll 放行
    if EXEC_FLAG.search(cmd) or POLL_FLAG.search(cmd):
        return None
    
    # 检查 delay
    delay_s = parse_delay_seconds(cmd)
    if delay_s is not None and delay_s < MIN_DELAY_SECONDS:
        # 检查是否包含状态轮询关键词
        m_prompt = PROMPT_RE.search(cmd)
        prompt_text = m_prompt.group(2) if m_prompt else cmd
        if POLL_WORDS.search(prompt_text):
            return (
                "拦截（anti-spin-guard）：严禁在主对话流中使用短周期定时器（<10分钟）肉身唤醒大模型轮询状态（浪费 Token）。\n"
                "周期性状态监测强制走 --poll 轻量脚本模式（bothouse cron add --poll --exec '<脚本>'），或等待冷却到期自动探活。"
            )
    return None

def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return
    tool = payload.get("tool_name", "")
    inp = payload.get("tool_input") or {}
    cmd = inp.get("command") or inp.get("cmd") or ""
    if not isinstance(cmd, str):
        return
    reason = check_command(cmd)
    if reason:
        out = {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": reason,
            }
        }
        print(json.dumps(out, ensure_ascii=False))
        sys.exit(0)

if __name__ == "__main__":
    main()
