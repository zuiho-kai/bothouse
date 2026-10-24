#!/usr/bin/env python3
"""假 claude CLI（stream-json），给主路回归和预览实例用，不调用任何模型。

角色由 FAKE_ROLE 定：lead=主角色，其他=队友。只看收到的提示词最后一行：
  主角色收到含「派活」→ 回「@<FAKE_TEAMMATE> 请帮忙做一下子任务 X，做完回我。」
  队友收到含「子任务」→ 回「@<FAKE_LEAD> 子任务 X 做完了：结果 42」
  主角色收到含「子任务 X 做完」→ 回「收到队友交回的结果 42，汇总：一切完成。」
  其他 → 回「[角色] 收到：<原话>」
FAKE_LOG 设了就把每轮收到的提示词末尾追加进去，便于排查。
"""
import json, os, sys, threading, uuid

role = os.environ.get("FAKE_ROLE", "dev")
teammate = os.environ.get("FAKE_TEAMMATE", "龙")
lead = os.environ.get("FAKE_LEAD", "橘")
log = os.environ.get("FAKE_LOG")
sid = str(uuid.uuid4())
lock = threading.Lock()


def out(o):
    with lock:
        sys.stdout.write(json.dumps(o, ensure_ascii=False) + "\n")
        sys.stdout.flush()


def reply(t):
    out({"type": "assistant", "message": {"role": "assistant", "content": [{"type": "text", "text": t}]}, "session_id": sid})
    out({"type": "result", "subtype": "success", "is_error": False, "result": t, "session_id": sid,
         "usage": {"input_tokens": 1, "output_tokens": 1}})


def turn(text):
    if log:
        with open(log, "a") as f:
            f.write(f"[{role}] {text[-400:]!r}\n---\n")
    lines = text.strip().splitlines()
    last = lines[-1] if lines else text
    if role == "lead" and "子任务 X 做完" in last:
        reply("收到队友交回的结果 42，汇总：一切完成。")
    elif role == "lead" and "派活" in last:
        reply(f"@{teammate} 请帮忙做一下子任务 X，做完回我。")
    elif role != "lead" and "子任务" in last:
        reply(f"@{lead} 子任务 X 做完了：结果 42")
    else:
        reply(f"[{role}] 收到：{last[:80]}")


out({"type": "system", "subtype": "init", "session_id": sid, "model": "fake", "tools": []})
for line in sys.stdin:
    try:
        m = json.loads(line)
    except ValueError:
        continue
    ty = m.get("type")
    if ty == "user":
        c = m.get("message", {}).get("content", "")
        if isinstance(c, list):
            c = " ".join(x.get("text", "") for x in c if isinstance(x, dict))
        threading.Thread(target=turn, args=(c,), daemon=True).start()
    elif ty == "control_request" and m.get("request", {}).get("subtype") == "interrupt":
        out({"type": "control_response", "response": {"subtype": "success", "request_id": m.get("request_id")}})
