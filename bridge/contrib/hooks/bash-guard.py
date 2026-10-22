#!/usr/bin/env python3
"""PreToolUse(Bash)：拦下反复犯过的命令。规则来自作者自己的 wiki 记录，每条附原因。
1. 没走代理的下载：大文件走本机代理 + 分段并发（pget）。只在设了环境变量 HOOK_PROXY（如 http://127.0.0.1:7890）时检查，
   没设就不管下载（没有代理的机器上这条没有意义）。
   放行：pget、已带代理（-x/--proxy/*_proxy=/proxy_on）、目标全是本机/局域网/Tailscale、`# direct-ok`。
2. pkill -f：会匹配到执行本命令的 wrapper shell，把自己杀掉。
3. macOS 上 go build -o 覆盖 bothouse 二进制：签名变回 ad-hoc，TCC（屏幕录制、辅助功能等）授权失效。
4. 后台命令（run_in_background）看不到进度或没有超时：输出接 | tail/| head 会到结束才吐字；没套超时卡死也无人知。
   常驻服务加 `# long-running-ok` 放行。
5. 只提示不拦：一条命令整页 cat wiki 下 2 页以上 .md（含 for 循环 cat、*.md 通配）。wiki 目录同 bothouse 的 gate：
   环境变量 GATE_WIKI，默认 ~/wiki；设成 off 或目录不存在就不提示。作者的慢例是一次 cat 十几页。
   提示走 PreToolUse 的 additionalContext，命令照常执行。"""
import json, os, re, shlex, sys

PROXY_URL = os.environ.get("HOOK_PROXY", "").strip()  # 例：http://127.0.0.1:7890；空 = 不查下载
_wiki = os.environ.get("GATE_WIKI", "~/wiki").strip()  # 同 bridge/contrib/gate/ctxsvc.py
WIKI = None if _wiki.lower() in ("", "off") else os.path.realpath(os.path.expanduser(_wiki))

PROXY = re.compile(r"(^|\s)(-x|--proxy|--socks5\S*)(\s|=)|\b(https?|all)_proxy=|\b(HTTPS?|ALL)_PROXY=|\bproxy_on\b")
LOCAL = re.compile(r"^(https?://)?(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|[^/]*\.local\b|[^/]*\.ts\.net\b|\[?::1)")

def segments(cmd):
    return [s for s in re.split(r"\|\||&&|[;\n|]", cmd) if s.strip()]

def toks(seg):
    try:
        return shlex.split(seg, comments=True)
    except ValueError:
        return seg.split()

def is_download(seg):
    t = toks(seg)
    # 跳过前置的 VAR=val / sudo / env / time
    while t and (re.match(r"^\w+=", t[0]) or t[0] in ("sudo", "env", "time", "command", "exec")):
        t = t[1:]
    if not t:
        return False
    prog = t[0].rsplit("/", 1)[-1]
    args = t[1:]
    if prog in ("wget", "aria2c", "axel"):
        return True
    if prog in ("hf", "huggingface-cli") and "download" in args:
        return True
    if prog == "curl":
        if any(a in ("-I", "--head") for a in args):
            return False
        for a in args:
            if a in ("--output", "--remote-name", "--remote-name-all") or a.startswith("--output="):
                return True
            if re.match(r"^-[A-Za-z]*[oO]", a) and not a.startswith("--"):
                return True
        return ">" in seg  # curl ... > file
    return False

def urls(seg):
    return re.findall(r"https?://[^\s'\"]+", seg)

def deny(reason):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": reason}}, ensure_ascii=False))
    sys.exit(0)

TIMEOUT = re.compile(r"(^|[\s;&|(])(g?timeout\s|perl\s+-e\s+['\"]alarm)")
TAILPIPE = re.compile(r"\|\s*(tail|head)\b")

def check_background(cmd):
    if "# long-running-ok" in cmd:
        return
    if TAILPIPE.search(cmd):
        deny("后台命令不要接 | tail / | head：结束前看不到任何输出，卡死也发现不了。"
             "改成 `python -u ... > 日志 2>&1`，用 Monitor 或定期看日志是否增长。")
    if not TIMEOUT.search(cmd):
        deny("后台命令没套超时（后台任务要能感知卡死）。"
             "套 `timeout <秒数> <命令…>`；macOS 默认没有 coreutils timeout，用 `perl -e 'alarm shift; exec @ARGV' <秒数> <命令…>`，秒数取预期耗时×3（它只杀直接子进程，别包 sh -c）；"
             "常驻服务（dev server、守护进程）在命令末尾加 `# long-running-ok`。")

WIKI_REF = re.compile(r"(~|\$HOME|\$\{HOME\}|/Users/[^/\s]+|/home/[^/\s]+)/wiki\b")
WIKI_CAT_MIN = 2  # 用户原话（派活）：「整页 cat ~/wiki 下 2 页以上 .md」


def wiki_cat_pages(cmd, cwd):
    """整页 cat 的 wiki .md 个数；通配（*.md）或 for 循环里 cat 记作 WIKI_CAT_MIN。不在 wiki 下返回 0。"""
    if not WIKI or not os.path.isdir(WIKI):
        return 0
    in_wiki = bool(WIKI_REF.search(cmd)) or WIKI in cmd or os.path.realpath(cwd or "").startswith(WIKI)
    if not in_wiki:
        return 0
    n = 0
    for seg in segments(cmd):
        t = toks(seg)
        if t and t[0] == "do":
            t = t[1:]
        if not t or t[0].rsplit("/", 1)[-1] != "cat":
            continue
        mds = [a for a in t[1:] if not a.startswith("-") and a.endswith(".md")]
        loop = re.search(r"\b(for|while)\b", cmd) and any("$" in a for a in t[1:])
        if loop or any("*" in a or "?" in a for a in mds) or any(a.startswith("$") and not a.endswith(".md") for a in t[1:]):
            return WIKI_CAT_MIN  # 通配 / 循环变量：一次就是多页
        n += len(mds)
    return n


def hint(text):
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "additionalContext": text}},
                     ensure_ascii=False))
    sys.exit(0)


def main():
    d = json.load(sys.stdin)
    cmd = (d.get("tool_input") or {}).get("command", "")
    if (d.get("tool_input") or {}).get("run_in_background"):
        check_background(cmd)
    for seg in segments(cmd):
        t = toks(seg)
        if t and t[0] == "pkill" and any(re.match(r"^-[a-zA-Z]*f", a) for a in t[1:]):
            deny("不要用 pkill -f：它会匹配到执行本命令的 wrapper shell，把自己杀掉。"
                 "改用 pid 文件，或 `kill $(pgrep -f '[x]yz')`（方括号让 pattern 不匹配自身）。")
        if sys.platform == "darwin" and "# tcc-ok" not in cmd and t[:2] == ["go", "build"] and re.search(r"-o\s+\S*bothouse", seg):
            deny("不要直接 go build -o 覆盖正在用的 bothouse：macOS 上签名会变回 ad-hoc，TCC 授权失效。"
                 "编到别的路径，再用原来的证书 codesign 后替换；确实要覆盖就在命令末尾加 `# tcc-ok`。")
    direct_ok = not PROXY_URL or "# direct-ok" in cmd or PROXY.search(cmd)
    for seg in ([] if direct_ok else segments(cmd)):
        if not is_download(seg):
            continue
        us = urls(seg)
        if us and all(LOCAL.match(u) for u in us):
            continue
        reason = (
            f"下载命令没走代理（本机设了 HOOK_PROXY={PROXY_URL}：大文件走代理 + 分段并发）。"
            f"大文件用分段下载工具（如 pget）；小文件给 curl 加 `-x {PROXY_URL}`；"
            f"hf/wget 前加 `https_proxy={PROXY_URL}`。确需直连，在命令末尾加 `# direct-ok`。"
            f"\n被拦的片段：{seg.strip()[:200]}"
        )
        deny(reason)
    if wiki_cat_pages(cmd, d.get("cwd")) >= WIKI_CAT_MIN:
        hint("这条命令整页 cat 了多页 wiki（照常执行，只是提醒）。下次先 `grep -rn <关键词> <wiki 目录>`（装了 llm-wiki 就用它的 "
             "`bin/search.py <关键词>`）拿 路径:行号，再 `sed -n '<起>,<止>p' <页>` 只读命中段，不整页 cat 多页。")

if __name__ == "__main__":
    main()
