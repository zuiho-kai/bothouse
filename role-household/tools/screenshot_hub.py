"""真跑验收（云端版）：打开云端网页、发话题、盯住虚拟头、截图。云端和本地角色主机需先启动。

    uv run python tools/screenshot_hub.py [--topic "..."] [--out docs/screenshots/hub]

地址和 token 读环境变量或仓库根目录 .env（RH_HUB_URL / RH_HUB_TOKEN）。--no-send 只看不发（等补话题时用）。
反复数日志里标着“在说”（▶）的消息，超过 1 条就报错；看到新的系统消息（讨论结束）就停。
数的是消息不是头：网页最多只点亮一个头，数头永远不会超过 1，证明不了云端同一时间只有一条在说。
--sound：点“开声音”让这个网页当三个角色的设备，结束时把网页里的播放事件（开始、playing、播完、回执）
写进 <out>/audio-log.json，并检查同一时间只有一个角色在播。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from rh.host import read_dotenv  # noqa: E402

VIEWPORT = {"width": 1100, "height": 900}  # 来源：沿用 tools/screenshot.py
POLL_MS = 200  # 多久数一次“在说”的消息（毫秒）。来源：实现者定。
CONNECT_MS = 15000  # 等网页连上云端（毫秒）。来源：实现者定。
LAST_N = 8  # 结尾打印最后几条消息。来源：实现者定。


def speaking_now(page) -> list[str]:
    """网页日志里状态是 speaking 的消息（云端库里 status='speaking' 的行的投影），返回说话人名字。"""
    return page.eval_on_selector_all(".msg.speaking .who", "els => els.map(e => e.textContent)")


def main() -> None:
    env = {**read_dotenv(ROOT / ".env"), **os.environ}   # 环境变量优先（全本地时指向 127.0.0.1）
    ap = argparse.ArgumentParser()
    ap.add_argument("--topic", default="周末要不要一起去海边？各说说想法。")
    ap.add_argument("--no-send", action="store_true")
    ap.add_argument("--sound", action="store_true", help="网页当设备出声，记录播放事件")
    ap.add_argument("--out", default=str(ROOT / "docs" / "screenshots" / "hub"))
    ap.add_argument("--timeout", type=float, default=300)  # 秒。来源：沿用 tools/screenshot.py
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    url = env["RH_HUB_URL"]
    with sync_playwright() as p:
        # 无头浏览器没有真人点击，放开自动播放限制（真人用时点“开声音”就够）。
        b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"] if a.sound else [])
        page = b.new_page(viewport=VIEWPORT)
        page.goto(f"{url}/#token={env['RH_HUB_TOKEN']}")
        page.wait_for_function("document.getElementById('meta').textContent === '已连接'", timeout=CONNECT_MS)
        if a.sound:
            page.click("#sound")
        start_count = page.locator(".msg.system").count()
        if not a.no_send:
            page.fill("#in", a.topic)
            page.click("#f button")
        deadline, seen, worst, shots = time.time() + a.timeout, [], 0, 0
        while time.time() < deadline:
            lit = speaking_now(page)
            worst = max(worst, len(lit))
            if len(lit) > 1:
                raise SystemExit(f"同时有 {len(lit)} 条在说：{lit}")
            if lit and (not seen or seen[-1] != lit[0]):
                seen.append(lit[0])
                shots += 1
                page.screenshot(path=str(out / f"speaking-{shots}.png"))
                print(f"{time.strftime('%H:%M:%S')} 在说：{lit[0]} -> speaking-{shots}.png", flush=True)
            if page.locator(".msg.system").count() > start_count and not lit:
                break
            page.wait_for_timeout(POLL_MS)
        page.screenshot(path=str(out / "discussion.png"))
        if a.sound:
            log = page.evaluate("window.rhAudioLog")
            (out / "audio-log.json").write_text(json.dumps(log, ensure_ascii=False, indent=1))
            names = {m["id"]: m["name"] for m in page.evaluate("members")}
            busy, worst = set(), 0   # 正在播的角色：start 进、回执出
            for x in log:
                if x["ev"] == "start":
                    busy.add(x["play_id"])
                elif x["ev"].startswith("receipt:"):
                    busy.discard(x["play_id"])
                worst = max(worst, len(busy))
            plays = [names.get(x["role"], x["role"]) for x in log if x["ev"] == "playing"]
            done = [names.get(x["role"], x["role"]) + "=" + x["ev"][8:] for x in log if x["ev"].startswith("receipt:")]
            print("网页播放（playing 事件，按块）：", " -> ".join(plays))
            print("网页回执：", " -> ".join(done), "；同时在播最多", worst, "个")
            if worst > 1:
                raise SystemExit(f"同时有 {worst} 个角色在播")
        print("轮到的顺序：", " -> ".join(seen), "；同时在说的消息最多", worst, "条")
        print("最后几条：", page.eval_on_selector_all(
            ".msg", f"els => els.slice(-{LAST_N}).map(e => e.textContent.trim())"))
        b.close()


if __name__ == "__main__":
    main()
