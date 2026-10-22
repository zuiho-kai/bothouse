"""Read native Codex measurements for explicitly selected sessions, without pricing guesses."""
import collections
import json
from pathlib import Path
import re

from daypack import SLOW, hm, one_line, ts_of

ROOT = Path.home() / ".codex" / "sessions"
UUID = re.compile(r"(?:^|-)([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$")
KEYS = ("input_tokens", "cached_input_tokens", "cache_write_input_tokens", "output_tokens")


def measurements(start, end, sessions, root=ROOT):
    """Use cumulative usage deltas, including a baseline before the window. Read only exact supplied UUIDs.

    Command intervals end when the exit result is observed, not necessarily when the OS process exited.
    Unfinished commands are reported separately. Poll waits are tool call→result intervals.
    """
    selected = {m[1] for sid, *_ in sessions if (m := UUID.search(sid))}
    stats, commands, waits, pending, warnings = {}, [], [], [], []
    for sid in sorted(selected):
        files = list(root.glob(f"*/*/*/rollout-*-{sid}.jsonl"))
        if len(files) != 1:
            warnings.append(f"{sid}: 原生日志{'缺失' if not files else '不唯一'}")
            continue
        usage = collections.Counter()
        previous, calls, running, models = {}, {}, {}, set()
        matched = False
        try:
            f = files[0].open(errors="replace")
        except OSError as e:
            warnings.append(f"{sid}: 无法读取原生日志：{e}")
            continue
        with f:
            for line in f:
                try:
                    d = json.loads(line)
                    p = d.get("payload") or {}
                    if d.get("type") == "session_meta":
                        matched = p.get("id") == sid
                    if not matched or not d.get("timestamp"):
                        continue
                    t = ts_of(d["timestamp"])
                    if t >= end:
                        continue
                    if d.get("type") == "turn_context":
                        if t >= start and p.get("model"):
                            models.add(p["model"])
                    if d.get("type") == "event_msg" and p.get("type") == "token_count":
                        total = (p.get("info") or {}).get("total_token_usage")
                        if not isinstance(total, dict):
                            continue
                        current = {k: total.get(k, 0) for k in KEYS}
                        if any(type(v) is not int or v < 0 for v in current.values()):
                            warnings.append(f"{sid}: token 计数格式异常，已略过")
                            continue
                        if previous and any(current[k] < previous[k] for k in KEYS):
                            if t >= start:
                                warnings.append(f"{sid}: 累计 token 回退，统计可能不完整")
                        elif t >= start:
                            for k in KEYS:
                                usage[k] += current[k] - previous.get(k, 0)
                        previous = current
                    if d.get("type") != "response_item":
                        continue
                    if p.get("type") == "function_call":
                        name = p.get("name", "").rsplit(".", 1)[-1]
                        if name in ("exec_command", "write_stdin"):
                            args = json.loads(p.get("arguments") or "{}")
                            calls[p["call_id"]] = (t, name, args)
                    elif p.get("type") == "function_call_output":
                        call = calls.pop(p.get("call_id"), None)
                        if not call:
                            continue
                        t0, name, args = call
                        output = p.get("output", "")
                        if not isinstance(output, str):
                            continue
                        if name == "exec_command":
                            cmd = (t0, args.get("cmd", ""))
                            session = re.search(r"Process running with session ID (\d+)", output)
                            if session:
                                running[session[1]] = cmd
                            elif "Process exited with code" in output:
                                if start <= t0 < end and t - t0 > SLOW:
                                    commands.append((t - t0, sid, t0, t, cmd[1]))
                            elif start <= t0 < end:
                                pending.append((sid, t0, cmd[1]))
                        else:
                            if start <= t0 < end:
                                waits.append((t - t0, sid, t0, t))
                            key = str(args.get("session_id"))
                            if "Process exited with code" in output and key in running:
                                sent, cmd = running.pop(key)
                                if start <= sent < end and t - sent > SLOW:
                                    commands.append((t - sent, sid, sent, t, cmd))
                except (ValueError, KeyError, TypeError, AttributeError):
                    warnings.append(f"{sid}: 原生日志有无法解析的记录，统计可能不完整")
        if not matched:
            warnings.append(f"{sid}: 日志内会话 ID 不匹配，未取用")
        if previous:
            stats[sid] = dict(usage, model="/".join(sorted(models)) or "未在区间内上报")
        for sent, cmd in running.values():
            if start <= sent < end:
                pending.append((sid, sent, cmd))
        for sent, name, args in calls.values():
            if name == "exec_command" and start <= sent < end:
                pending.append((sid, sent, args.get("cmd", "")))
    return stats, sorted(commands, reverse=True), waits, pending, sorted(set(warnings))


def part(start, end, sessions, root=ROOT):
    stats, commands, waits, pending, warnings = measurements(start, end, sessions, root)
    totals = {"runtime": "codex", **{k: sum(s[k] for s in stats.values()) for k in KEYS},
              "slow": len(commands), "slow_min": sum(c[0] for c in commands) / 60,
              "wait_seconds": sum(w[0] for w in waits), "pending": len(pending)}
    lines = ["## Codex 原生用量与等待（仅当前 wiki 所列会话，累计计数的区间增量）",
             "- input 包含 cached input；缓存写入字段未上报时按 0 计，不证明没有写缓存。",
             "- 费用、缓存 TTL 及过期重写原因未上报，无法计算；不套用 Claude 价格。"]
    for sid, s in stats.items():
        lines.append(f"- {sid} {s['model']}：input {s['input_tokens']}，cached input {s['cached_input_tokens']}，"
                     f"cache write {s['cache_write_input_tokens']}，output {s['output_tokens']}")
    if not stats:
        lines.append("- 无匹配的原生用量记录，不能据此判断没有消耗。")
    lines.append(f"## 慢命令（发出到观察到退出超过 5 分钟，共 {len(commands)} 条；包含后台运行及轮询间隔）")
    for secs, sid, sent, done, cmd in commands:
        lines.append(f"- {sid} {hm(sent)}~{hm(done)}，{secs / 60:.1f} 分钟：`{one_line(cmd)}`")
    if not commands:
        lines.append("- 无已观察到退出的超时长命令；不代表未结束的命令已经完成。")
    lines.append(f"## 前台轮询等待（write_stdin 发出到返回，共 {len(waits)} 段；可与慢命令重叠，不相加）")
    for secs, sid, sent, done in waits:
        lines.append(f"- {sid} {hm(sent)}~{hm(done)}：{secs:.1f} 秒")
    for sid, sent, cmd in pending:
        lines.append(f"- 截止窗口结束未观察到退出：{sid} {hm(sent)}：`{one_line(cmd)}`")
    lines.extend(f"- 数据缺口：{w}" for w in warnings)
    return lines, totals if stats or commands or waits or pending else None
