"""生成「添加到主屏幕」的图标（rh/static/icons/）：和网页左上角「家」那个按钮同样子（hub.html .srv.on：橙底深色字）。
整块铺满底色：苹果自己切圆角，安卓按 maskable 裁成圆或方，字在中间安全区（直径 80% 的圆）里。

    uv run python tools/make_icons.py
"""
import asyncio
from pathlib import Path

from playwright.async_api import async_playwright

OUT = Path(__file__).resolve().parent.parent / "rh" / "static" / "icons"
# 尺寸：192、512 是 Chrome 判可安装要的两种（web.dev「Add a web app manifest」）；180 是苹果主屏图标（Apple HIG App icons）。
SIZES = {"icon-192.png": 192, "icon-512.png": 512, "apple-touch-icon.png": 180}
HTML = """<body style="margin:0"><div style="width:{n}px;height:{n}px;background:#f0a020;color:#1e1f22;display:flex;
align-items:center;justify-content:center;font:600 {f}px 'PingFang SC',sans-serif">家</div></body>"""


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--mute-audio"])
        for name, n in SIZES.items():
            pg = await b.new_page(viewport={"width": n, "height": n})
            await pg.set_content(HTML.format(n=n, f=int(n * 0.5)))   # 字高约一半：在 maskable 安全区里
            await pg.screenshot(path=str(OUT / name), clip={"x": 0, "y": 0, "width": n, "height": n})
        await b.close()

asyncio.run(main())
