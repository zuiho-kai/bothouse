"""宣传片动画渲染：场景 JSON + 模板 HTML -> mp4。

用法：uv run --with playwright python docs/launch/anim/render.py [场景名...] [--lang zh,en]
不给场景名就渲染 scenes/ 下全部；输出 out/<场景>.<lang>.mp4。
首次要装浏览器：https_proxy=http://127.0.0.1:7890 uv run --with playwright playwright install chromium
"""
import argparse, asyncio, json, pathlib, shutil, subprocess, tempfile, time
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent
# 成片规格 1280×720，来源：docs/launch/x-15s.md「成片规格：1280×720 mp4」
SIZE = {"width": 1280, "height": 720}
# 记下 __done 被设置的时刻（页面时钟 Date.now()），不用改模板
DONE_HOOK = """Object.defineProperty(window, '__done', { configurable: true,
  get() { return this.__doneVal; }, set(v) { this.__doneVal = v; if (v) this.__doneAt = Date.now(); } });"""


async def render(browser, name, lang):
    scene = json.loads((ROOT / "scenes" / f"{name}.json").read_text("utf-8"))
    tpl = ROOT / "templates" / f"{scene['template']}.html"
    if not tpl.exists():
        print(f"跳过 {name}.{lang}：模板 {tpl.name} 还不存在")
        return
    out = ROOT / "out" / f"{name}.{lang}.mp4"
    out.parent.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        ctx = await browser.new_context(viewport=SIZE, record_video_dir=tmp, record_video_size=SIZE)
        await ctx.add_init_script(DONE_HOOK +
            f"window.SCENE = {json.dumps(scene, ensure_ascii=False)}; window.LANG = {json.dumps(lang)};")
        page = await ctx.new_page()
        # 录屏第 0 帧约等于 new_page 返回的时刻（校准页实测偏差 < 0.05 秒），之后按墙钟 25fps 补帧
        t_page = time.time() * 1000
        await page.goto(tpl.as_uri())
        await page.wait_for_function("window.__done === true", timeout=0)
        start, done = await page.evaluate("[window.__start, window.__doneAt]")
        await ctx.close()
        webm = await page.video.path()
        # 只留 [__start, __done]：去掉片头加载空白和片尾 close 前多录的帧。模板没设 __start 就从第 0 帧开始
        ss = max(0.0, (start - t_page) / 1000) if start else 0.0
        length = (done - (start or t_page)) / 1000
        # 转码参数来源：样品 rec.py 的说明「ffmpeg -i x.webm -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart x.mp4」
        # -ss/-t 放在 -i 之后：逐帧解码后精确裁剪
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(webm), "-ss", f"{ss:.3f}", "-t", f"{length:.3f}",
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30", "-movflags", "+faststart", str(out)],
                       check=True)
    print(f"{out}  播放 {length:.2f}s（片头裁掉 {ss:.2f}s）")


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("scenes", nargs="*")
    ap.add_argument("--lang", default="zh,en")
    a = ap.parse_args()
    names = a.scenes or sorted(p.stem for p in (ROOT / "scenes").glob("*.json"))
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for n in names:
            for lang in a.lang.split(","):
                await render(b, n, lang.strip())
        await b.close()


if __name__ == "__main__":
    assert shutil.which("ffmpeg"), "需要 ffmpeg"
    asyncio.run(main())
