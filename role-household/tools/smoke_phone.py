"""线上手机视角巡检：不用人盯，在真实云端网页上找「刷屏、露原始报错、成员重复、露 markdown、断线」这类问题。

    .venv/bin/python -I tools/smoke_phone.py [--url <云端地址>] [--rooms 1,2] [--out logs/smoke] [--co-mention]

起因：用户 2026-10-20 大厅被「这一轮做完了」系统消息和原始 429/503 报错刷屏、成员栏同一个角色两行，
原话「这种能不能让ai搞测试，我不想自己看护」「你这什么狗屎，你是怎么验收过的，这叫对齐么」。

默认只读：不发消息、不点开声音、不改频道（--co-mention 例外，见下）。打开页面会照常推进该频道的已读位置（网页本身的行为）。
无头 Chromium、静音、390×844 手机视口登录；每个频道加载全部历史，把消息区从头到尾一屏一屏截图，
再查 DOM（第 1–4、6 条）和接口（第 5 条）。结果写到 <out>/<时间>/report.md 和截图。
退出码：0 全过，1 有不过（含打不开页面）。

--co-mention（默认不跑；会发消息）：先在 room 2 以用户身份发「@橘 @龙娘 帮我算 A×B，龙娘算，橘核对」（A、B 每次随机），
等两个 bot 回完，查第 7–9 条：龙娘这一轮的回复 @ 了橘、且在橘之前；橘引用龙娘这一轮回复的数、并表态「对」或「核对过」；橘在那之前没有别的回复。
起因：用户 2026-10-20 发这句，橘 3 秒就拿 80 分钟前的「391」说核对过了（conest issue #182）。只往 room 2 发，绝不往 room 1 发。
"""
from __future__ import annotations

import argparse
import json
import random
import re
import ssl
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from rh.host import read_dotenv  # noqa: E402
from rh.cloudweb import FOOTER, NOTICE_PREFIXES  # noqa: E402

ROOMS = [1, 2]                            # 来源：派活原话「打开大厅（room 1）和测试频道（room 2）」
VIEWPORT = {"width": 390, "height": 844}  # 来源：派活原话「390×844 尺寸」
SCALE = 2                                 # 设备像素比。来源：沿用 /tmp/rh-nospam-shots/shot.py
CONNECT_MS = 20000                        # 等网页连上云端。来源：沿用 /tmp/rh-nospam-shots/shot.py
SETTLE_MS = 2500                          # 连上后等首屏画完。来源：沿用 /tmp/rh-nospam-shots/shot.py
UI_MS = 300                               # 滚动、开关抽屉后等动画（抽屉 transition .25s，见 rh/static/hub.html）
MAX_OLDER_PAGES = 100                     # 往上加载更早消息的页数上限（防死循环，一页 200 条）。来源：实现者定
OVERLAP_PX = 40                           # 相邻两张截图叠多少，不漏中间那条。来源：实现者定
SPAM_LOOKBACK_S = 3600                    # 来源：派活原话「最近 1 小时里」
SPAM_WINDOW_S = 300                       # 来源：派活原话「同一作者 5 分钟内」
SPAM_MAX = 2                              # 来源：派活原话「系统消息不超过 2 条」
EXCERPT = 120                             # 证据里每条摘多少字。来源：实现者定

# --co-mention 场景
CO_ROOM = 2                               # 来源：派活原话「在 room 2 发」「绝对不往 room 1 发」
# hub 里主 bot（橘）、sub（龙娘）的作者 id：.env 的 RH_CO_LEAD / RH_CO_SUB（或 --co-lead / --co-sub）给，
# 不写死成维护者自己的 id；--co-mention 没给就报错退出。
CO_LEAD: str | None = None
CO_SUB: str | None = None
CO_FACTOR = (11, 99)                      # A、B 取两位数。来源：用户 2026-10-20 原句「17×23」是两位数乘两位数
CO_WAIT_S = 600                           # 等两个 bot 回完的上限。来源：实现者定（龙娘一轮通常一两分钟）
CO_POLL_S = 5                             # 来源：实现者定
# 第 8 条：橘要在提到龙娘那个数的同一句里表态「对」或「核对过」（来源：派活原话「必须表态"对"或"核对过"，并且引用的是龙娘这一轮的回复」）。
# 只认白名单写法：独立的「对」（前面是句首/标点/是/算/得，后面是句末/标点/的/了）、「核对过」后面接句末/标点/了/是；
# 句子按 。！？；换行 切，同一句里有否定、疑问或含糊词就不算（两轮审查实测的误判：「391 不太对」「391 对吧」「我先对一下 391」「核对过程」「也许对」）。
# 不收「再」：橘的核对过程常写「再加 26 得 1066」「再减 19」（线上 room 2 #309、#300 因此被误判没表态）；「再对一遍」这类动词「对」
# 前面是「再」、不在 CO_VERDICT 认的前缀里，本来就不算表态
CO_VERDICT = re.compile(r"(?:^|[\s，,、：:]|是|算|得)对(?=$|[\s，,。！!；;]|的|了)|核对过(?=$|[\s，,。！!；;]|了|是)")
CO_NOT = re.compile(r"[不没未错误吗么嘛吧否？?]|可能|也许|应该|是否|待")

# 第 1 条。来源：用户 2026-10-20 大厅被「这一轮做完了」系统消息刷屏
DONE_TEXT = "这一轮做完了"
# 第 2 条：原始报错。来源：用户 2026-10-20 大厅被原始 429/503 报错刷屏；派活原话列了
# 「status 429/503、exceeded retry limit、Traceback、英文报错原文」
RAW_ERR = [
    ("状态码 429/503", re.compile(r"(?i)(status|http|code|error|错误|状态)\W{0,3}(429|503)\b")),
    ("状态码 429/503", re.compile(r"[（(]\s*(429|503)\s*[)）]")),
    ("状态码 429/503", re.compile(r"(?i)\b(429|503)\b\W{0,3}(too many|service unavailable)")),
    ("exceeded retry limit", re.compile(r"(?i)exceeded\s+(the\s+)?retry\s+limit")),
    ("Traceback", re.compile(r"\bTraceback\b")),
    ("英文报错原文", re.compile(r"\b[A-Z][A-Za-z]*(Error|Exception)\b")),
    ("英文报错原文", re.compile(r"(?i)\b(too many requests|service unavailable|rate[ _-]?limit(ed)?|"
                            r"internal server error|bad gateway|gateway time-?out|connection (refused|reset)|"
                            r"request failed|timed out)\b")),
]
# 第 4 条：markdown 原文。来源：派活原话「成对的星号、反引号代码块标记」（rh-md.js 渲染过的正文不该再有这些）
RAW_MD = [
    ("成对的星号", re.compile(r"(?<![*\w])\*{1,3}[^*\s][^*\n]*?(?<!\s)\*{1,3}(?![*\w])")),
    ("代码块标记 ```", re.compile(r"```")),
    ("成对的反引号", re.compile(r"`[^`\n]+`")),
]

# 页面里每条消息的可见文字（plain 去掉 <code>/<pre>：代码里本来就可以有星号）、作者、类型、在消息区里的纵坐标
JS_MSGS = """() => { const l = document.getElementById('log');
  return [...l.querySelectorAll(':scope > .msg')].map(el => {
    const t = el.querySelector('.text'), c = t ? t.cloneNode(true) : null;
    const plain = c ? (c.querySelectorAll('code, pre').forEach(n => n.remove()), c.textContent) : '';
    return {id: el.dataset.id, system: el.classList.contains('system'),
            who: (el.querySelector('.who') || {}).textContent || '', all: el.innerText, plain,
            top: el.getBoundingClientRect().top - l.getBoundingClientRect().top + l.scrollTop};
  }); }"""
# 消息区以外会露字的地方：断线横幅、错误行、顶部加载提示、toast、成员栏
JS_CHROME = """() => Object.fromEntries(['banner', 'err', 'logtop', 'toast', 'members'].map(id => {
  const e = document.getElementById(id); return [id, e && !e.hidden ? e.innerText : ''];
}))"""
JS_MEMBERS = """() => [...document.querySelectorAll('#members .member .nm')].map(n => {
  const c = n.cloneNode(true); c.querySelectorAll('.tag').forEach(t => t.remove()); return c.textContent.trim(); })"""


def api(url: str, token: str, path: str):
    r = urllib.request.Request(url + path, headers={"Authorization": "Bearer " + token})
    return json.loads(urllib.request.urlopen(r, timeout=CONNECT_MS / 1000, context=ssl.create_default_context()).read())


def recent_messages(url: str, token: str, room: int, since: float) -> list[dict]:
    """接口翻页取 created_at >= since 的消息（旧到新）。"""
    out, before = [], None
    for _ in range(MAX_OLDER_PAGES):
        d = api(url, token, f"/api/rooms/{room}/messages" + (f"?before={before}" if before else ""))
        ms = d["messages"]
        out = [m for m in ms if m["created_at"] >= since] + out
        if not ms or not d["has_more"] or ms[0]["created_at"] < since:
            break
        before = ms[0]["id"]
    return out


def spam_bursts(msgs: list[dict]) -> list[list[dict]]:
    """同一作者的系统消息，任意 SPAM_WINDOW_S 秒内超过 SPAM_MAX 条的那几段。"""
    by: dict[tuple, list[dict]] = {}
    for m in msgs:
        if m["author_kind"] == "system":
            by.setdefault((m["author"], m["name"]), []).append(m)
    bursts = []
    for ms in by.values():
        ms.sort(key=lambda m: m["created_at"])
        i = 0
        while i < len(ms):
            j = i
            while j + 1 < len(ms) and ms[j + 1]["created_at"] - ms[i]["created_at"] <= SPAM_WINDOW_S:
                j += 1
            if j - i + 1 > SPAM_MAX:
                bursts.append(ms[i:j + 1])
                i = j + 1
            else:
                i += 1
    return bursts


def post_message(url: str, token: str, room: int, text: str) -> dict:
    if room == 1:
        raise ValueError("不往 room 1 发")   # 派活原话「绝对不往 room 1 发」
    body = json.dumps({"text": text, "client_key": f"smoke-co-{time.time_ns()}"}).encode()
    r = urllib.request.Request(f"{url}/api/rooms/{room}/messages", body, method="POST",
                               headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(r, timeout=CONNECT_MS / 1000, context=ssl.create_default_context()).read())


def _ints(text: str) -> list[int]:
    return [int(x) for x in re.findall(r"\d+", FOOTER.sub("", text))]


def co_replies(msgs: list[dict]) -> tuple[dict | None, dict | None]:
    """→ (龙娘这一轮的回复, 橘的核对)：各自在用户那条之后的第一条正文（不算进度卡片和「↪ 已插入」这类提示）。"""
    reply = lambda m: not m.get("card") and not m["text"].lstrip().startswith(NOTICE_PREFIXES)
    first = lambda who: next((m for m in msgs if m["author"] == who and reply(m)), None)
    return first(CO_SUB), first(CO_LEAD)


def judge_co_mention(msgs: list[dict], a: int, b: int) -> list[tuple[int, str, bool, list[str]]]:
    """msgs：用户那条之后的消息（旧到新）。→ 第 7–9 条 (编号, 标题, 过?, 证据)。"""
    sub, lead = co_replies(msgs)
    show = lambda m: f"#{m['id']} {cut(FOOTER.sub('', m['text']))}" if m else "没有"
    ev = [f"龙娘：{show(sub)}", f"橘：{show(lead)}"]
    # 龙娘的回复要 @橘（交接，conest lead_return.go），橘被这条 @ 到才开轮，所以在它之后。
    # 只比先后不够：修之前两个 bot 同时开轮，龙娘碰巧先发完、橘随后自说自话也会过（2026-10-20 20:56 实测）
    handoff = bool(sub and "@橘" in FOOTER.sub("", sub["text"]))
    order = bool(handoff and lead and sub["id"] < lead["id"])
    nums = [n for n in _ints(sub["text"]) if n not in (a, b)] if sub else []
    # 龙娘的答案：她回复里有 A×B 就是它（「17×23=391，340+51」最后一个数是 51），否则取最后一个数（她算错时）
    n = (a * b if a * b in nums else nums[-1]) if nums else None
    lead_text = FOOTER.sub("", lead["text"]) if lead else ""
    quoted = bool(lead and n is not None and n in _ints(lead["text"]))
    verdict = n is not None and any(n in _ints(c) and CO_VERDICT.search(c) and not CO_NOT.search(c)
                                    for c in re.split(r"(?<=[。！!？?；;\n])", lead_text))
    before = [m for m in msgs if m["author"] == CO_LEAD and (sub is None or m["id"] < sub["id"])]
    return [
        (7, "龙娘这一轮的回复 @ 了橘，且在橘之前", order, ev + ([] if handoff or not sub else ["龙娘的回复没有 @橘"])),
        (8, "橘引用龙娘这一轮回复的数，并表态「对」或「核对过」", quoted and verdict,
         [f"龙娘这一轮的数：{n if n is not None else '没有'}（{a}×{b}={a * b}）", f"橘：{show(lead)}"]
         + ([] if quoted else ["橘没引用龙娘这一轮的数"]) + ([] if verdict or not lead else ["橘没表态「对」或「核对过」"])),
        (9, "橘在龙娘回复之前没有别的回复", bool(sub and lead) and not before,
         [f"龙娘回复之前橘发了：{show(m)}" for m in before] or ev),
    ]


def check_co_mention(url: str, token: str, rooms: list) -> None:
    R = Room(CO_ROOM)
    R.name = "同时 @橘和龙娘（--co-mention）"
    rooms.append(R)
    a, b = random.randint(*CO_FACTOR), random.randint(*CO_FACTOR)
    sent = post_message(url, token, CO_ROOM, f"@橘 @龙娘 帮我算 {a}×{b}，龙娘算，橘核对")
    deadline, after = time.time() + CO_WAIT_S, []
    while time.time() < deadline:
        time.sleep(CO_POLL_S)
        after = [m for m in recent_messages(url, token, CO_ROOM, sent["created_at"]) if m["id"] > sent["id"]]
        if all(co_replies(after)):   # 两个都回了
            break
    for no, title, ok, ev in judge_co_mention(after, a, b):
        R.results.append((no, title, ok, [f"发的：#{sent['id']} {sent['text']}"] + ev))


def cut(s: str) -> str:
    s = " ".join(s.split())
    return s if len(s) <= EXCERPT else s[:EXCERPT] + "…"


class Room:
    def __init__(self, rid: int):
        self.rid, self.name, self.shots, self.results = rid, "", [], []   # results: (编号, 标题, 过?, 证据行)

    def add(self, no: int, title: str, bad: list[str], ok_note: str = ""):
        self.results.append((no, title, not bad, bad or ([ok_note] if ok_note else [])))


def shoot_log(page, out: Path, tag: str) -> list[tuple[str, float, float]]:
    """消息区从头到尾一屏一屏截图；返回 [(文件名, 起始 scrollTop, 结束)]。"""
    h = page.evaluate("document.getElementById('log').clientHeight")
    total = page.evaluate("document.getElementById('log').scrollHeight")
    shots, y, k = [], 0, 1
    while True:
        page.evaluate(f"document.getElementById('log').scrollTop = {y}")
        page.wait_for_timeout(UI_MS)
        real = page.evaluate("document.getElementById('log').scrollTop")
        name = f"{tag}-{k:03d}.png"
        page.screenshot(path=str(out / name))
        shots.append((name, real, real + h))
        if real + h >= total - 1 or (len(shots) > 1 and real <= shots[-2][1]):
            break
        y, k = real + h - OVERLAP_PX, k + 1
    return shots


def shot_of(shots, top: float) -> str:
    for name, a, b in shots:
        if a <= top < b:
            return name
    return shots[-1][0] if shots else "?"


def check_room(page, url, token, rid, out: Path, ws_frames: list, rooms: list) -> None:
    R = Room(rid)
    rooms.append(R)   # 先放进去：中途出错时已查完的几条照样进报告
    page.evaluate(f"joinRoom({rid})")
    page.wait_for_function(f"room === {rid} && document.getElementById('meta').textContent === '已连接'", timeout=CONNECT_MS)
    page.wait_for_timeout(SETTLE_MS)
    R.name = page.evaluate("roomName")
    for _ in range(MAX_OLDER_PAGES):   # 加载全部历史，「从头到尾」
        if not page.evaluate("hasMore"):
            break
        page.evaluate("loadOlder()")
        page.wait_for_function("!loadingOlder", timeout=CONNECT_MS)
        page.wait_for_timeout(UI_MS)
    tag = f"room{rid}"
    shots = shoot_log(page, out, tag)
    R.shots = [s[0] for s in shots]
    msgs = page.evaluate(JS_MSGS)
    chrome = page.evaluate(JS_CHROME)
    where = lambda m: f"#{m['id']} [{shot_of(shots, m['top'])}] {m['who']}：{cut(m['all'])}"

    # 1. 系统消息里没有「这一轮做完了」
    R.add(1, f"系统消息里没有「{DONE_TEXT}」", [where(m) for m in msgs if m["system"] and DONE_TEXT in m["all"]],
          f"页面上 {sum(m['system'] for m in msgs)} 条系统消息都不含")
    # 2. 页面上没有原始报错
    bad = []
    for m in msgs:
        for label, rx in RAW_ERR:
            if (hit := rx.search(m["all"])):
                bad.append(f"{label}「{hit.group(0)}」 {where(m)}"); break
    for k, v in chrome.items():
        for label, rx in RAW_ERR:
            if v and (hit := rx.search(v)):
                bad.append(f"{label}「{hit.group(0)}」 在 #{k}：{cut(v)}"); break
    R.add(2, "页面上没有原始报错（429/503、exceeded retry limit、Traceback、英文报错）", bad,
          f"查了 {len(msgs)} 条消息和横幅/错误行/成员栏")
    # 3. 成员栏每个名字只出现一次（来源：用户 2026-10-20 成员栏同一个角色两行）。手机上成员栏是抽屉，打开截一张
    page.click("#open-right")
    page.wait_for_timeout(UI_MS)
    page.screenshot(path=str(out / f"{tag}-members.png"))
    R.shots.append(f"{tag}-members.png")
    names = page.evaluate(JS_MEMBERS)
    page.click("#scrim", position={"x": 10, "y": VIEWPORT["height"] // 2})   # 点抽屉左边露出的遮罩关掉（中间被抽屉盖着）
    page.wait_for_timeout(UI_MS)
    dup = sorted({n for n in names if names.count(n) > 1})
    R.add(3, "成员栏每个名字只出现一次",
          [f"「{n}」出现 {names.count(n)} 次 [{tag}-members.png]；全部：{'、'.join(names)}" for n in dup],
          f"成员栏：{'、'.join(names)}")
    # 4. 不露 markdown 原文（代码里的不算）
    bad = []
    for m in msgs:
        for label, rx in RAW_MD:
            if (hit := rx.search(m["plain"])):
                bad.append(f"{label}「{cut(hit.group(0))}」 {where(m)}"); break
    R.add(4, "不露 markdown 原文（成对星号、反引号、```）", bad, f"查了 {len(msgs)} 条消息")
    # 5. 刷屏：最近 1 小时同一作者 5 分钟内的系统消息不超过 2 条（接口）
    recent = recent_messages(url, token, rid, time.time() - SPAM_LOOKBACK_S)
    hm = lambda t: time.strftime("%H:%M:%S", time.localtime(t))
    R.add(5, f"最近 1 小时同一作者 {SPAM_WINDOW_S // 60} 分钟内系统消息不超过 {SPAM_MAX} 条",
          [f"{b[0]['name']}（{b[0]['author']}）{len(b)} 条，{hm(b[0]['created_at'])}–{hm(b[-1]['created_at'])}："
           + " | ".join(f"#{m['id']} {cut(m['text'])}" for m in b) for b in spam_bursts(recent)],
          f"最近 1 小时 {len(recent)} 条消息，其中系统消息 {sum(m['author_kind'] == 'system' for m in recent)} 条")
    # 6. 连得上 WebSocket，没有断线横幅
    st = page.evaluate("""() => ({meta: document.getElementById('meta').textContent,
      open: document.body.classList.contains('conn-open'), banner: !document.getElementById('banner').hidden,
      bannerText: document.getElementById('banner').textContent})""")
    bad = []
    if not ws_frames:
        bad.append("浏览器没收到任何 /ws 帧")
    if not st["open"] or st["meta"] != "已连接":
        bad.append(f"连接状态：{st['meta']}（conn-open={st['open']}）")
    if st["banner"]:
        bad.append(f"断线横幅在显示：{st['bannerText']}")
    R.add(6, "连得上 WebSocket，没有断线横幅", bad, f"状态「{st['meta']}」，收到 {len(ws_frames)} 个 /ws 帧，横幅隐藏")


def write_report(out: Path, url: str, rooms: list[Room], fatal: str | None, co: bool = False) -> bool:
    ok = fatal is None and all(r[2] for R in rooms for r in R.results)
    L = [f"# 手机视角巡检 {time.strftime('%Y-%m-%d %H:%M:%S')}", "",
         f"- 地址：{url}（无头 Chromium，静音，{VIEWPORT['width']}×{VIEWPORT['height']}，"
         f"{'--co-mention 往 room 2 发了一条，其余只读' if co else '只读'}）",
         f"- 总结果：{'全过' if ok else '有不过'}", ""]
    if fatal:
        L += ["## 没跑完", "", "```", fatal, "```", ""]
    for R in rooms:
        L += [f"## room {R.rid}「{R.name}」", ""]
        for no, title, passed, ev in R.results:
            L.append(f"- [{'过' if passed else '不过'}] {no}. {title}")
            L += [f"    - {e}" for e in ev]
        L += ["", f"截图（{len(R.shots)} 张）：" + "、".join(R.shots), ""]
    (out / "report.md").write_text("\n".join(L))
    return ok


def main() -> int:
    env = read_dotenv(ROOT / ".env")
    ap = argparse.ArgumentParser()
    # 默认地址取 .env 的 RH_HUB_URL（deploy/hub/deploy.sh 写的线上地址）；仓库里不写公网 IP（tests/test_device.py test_9）
    ap.add_argument("--url", default=env.get("RH_HUB_URL"))
    ap.add_argument("--rooms", default=",".join(map(str, ROOMS)))
    ap.add_argument("--out", default=str(ROOT / "logs" / "smoke"))
    ap.add_argument("--co-mention", action="store_true", help="在 room 2 发一条同时 @橘和龙娘的消息并查顺序（会发消息）")
    ap.add_argument("--co-lead", default=env.get("RH_CO_LEAD"), help="--co-mention：hub 里主 bot 的作者 id（默认 .env RH_CO_LEAD）")
    ap.add_argument("--co-sub", default=env.get("RH_CO_SUB"), help="--co-mention：hub 里 sub 的作者 id（默认 .env RH_CO_SUB）")
    a = ap.parse_args()
    global CO_LEAD, CO_SUB
    CO_LEAD, CO_SUB = a.co_lead, a.co_sub
    if a.co_mention and not (CO_LEAD and CO_SUB):
        ap.error("--co-mention 要知道 hub 里两个 bot 的作者 id：在 .env 写 RH_CO_LEAD= 和 RH_CO_SUB=，或加 --co-lead / --co-sub")
    token = env["RH_HUB_TOKEN"]
    out = Path(a.out) / time.strftime("%Y%m%d-%H%M%S")
    out.mkdir(parents=True, exist_ok=True)
    rooms, fatal = [], None
    if a.co_mention:
        try:
            check_co_mention(a.url, token, rooms)
        except Exception as e:
            fatal = f"--co-mention: {type(e).__name__}: {e}"
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--mute-audio"])
        ctx = b.new_context(viewport=VIEWPORT, device_scale_factor=SCALE, is_mobile=True, has_touch=True)
        page = ctx.new_page()
        ws_frames: list = []
        page.on("websocket", lambda ws: ws.url.endswith("/ws") and ws.on("framereceived", lambda f: ws_frames.append(1)))
        try:
            page.goto(f"{a.url}/#token={token}")
            page.wait_for_function("document.getElementById('meta').textContent === '已连接'", timeout=CONNECT_MS)
            for rid in [int(x) for x in a.rooms.split(",")]:
                check_room(page, a.url, token, rid, out, ws_frames, rooms)
        except Exception as e:   # 页面打不开、连不上也是不过，写进报告
            fatal = f"{type(e).__name__}: {e}"
            try:
                page.screenshot(path=str(out / "fatal.png"))
            except Exception:
                pass
        b.close()
    ok = write_report(out, a.url, rooms, fatal, a.co_mention)
    print(out / "report.md")
    print((out / "report.md").read_text())
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
