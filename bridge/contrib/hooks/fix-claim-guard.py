#!/usr/bin/env python3
"""Stop：挂在所有后端（Claude、Codex、DSH、agy、grok）的 Stop 钩子，现在只转调 check-first-guard.check()（先查再说）。
原来的「说修完了却没列入口表就拦」（2026-10-14）在 #1527 删掉：只看表头有没有「入口」两字，
拦的多是讲经过、自我批评的话（用户 11-12「还后面还有什么可以删的吗？一起搞了吧」）。
只拦一次（stop_hook_active 时放行）；hook 自己出错时静默放行。"""
import importlib.util, json, os, sys


def _check_first():
    """check-first-guard.py（先查再说，2026-11-06）：文件名带连字符，按路径载入；缺文件或载入出错就跳过。"""
    try:
        spec = importlib.util.spec_from_file_location("check_first_guard", os.path.join(os.path.dirname(os.path.abspath(__file__)), "check-first-guard.py"))
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        return m
    except Exception:
        return None


def main():
    try:
        d = json.load(sys.stdin)
    except ValueError:
        return
    if d.get("stop_hook_active"):
        return
    cf = _check_first()
    why = cf.check(d) if cf else None
    if why:
        print(json.dumps({"decision": "block", "reason": why}, ensure_ascii=False))


if __name__ == "__main__":
    main()
