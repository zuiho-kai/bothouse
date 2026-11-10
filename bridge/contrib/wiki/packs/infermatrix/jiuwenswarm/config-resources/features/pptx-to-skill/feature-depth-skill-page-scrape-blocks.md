---
name: feature-depth-skill-page-scrape-blocks
description: skill-omni-creation scrape_page 实现深读：Playwright 抓取流程、同步封装、argparse 默认值、依赖、失败模式、--disable-http2 取舍、手动验收步骤
metadata:
  scope: 收 scrape_page.py 到 stage01 blocks 的实现深读，来源另含 SKILL.md；功能概览归 feature-skill-page-scrape-blocks-1、feature-skill-page-scrape-blocks-2
---
# Web Page Scraping to Unified Stage01 Blocks：实现深读

## 现状

- [[feature-skill-page-scrape-blocks-1]]、[[feature-skill-page-scrape-blocks-2]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **scrape_page_playwright: headless Chromium fetch of the exact URL, parse, dedupe, conditional platform-URL prepend** scrape_page_playwright launches headless Chromium, scrapes one page, and parses html into blocks only when html is non-empty;
  - image blocks are deduplicated by URL keeping first occurrence, video_urls deduplicated, and page_url inserted at index 0 only if is_platform_url(page_url) and it is not already in video_urls. Returns (deduped, video_urls, page_title).
- 来源：[jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L820–L876](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py#L820-L876)
- **scrape_page wraps the async Playwright path synchronously** scrape_page(url: str) -> tuple[list[dict], list[str], str] returns asyncio.run(scrape_page_playwright(url)); the async function imports playwright.async_api locally and its docstring states it scrapes only the exact URL supplied,
  - never following page links. Callers get unified blocks, video URLs, and the page title.
- 来源：[jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L820–L880](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py#L820-L880)
- **main() argparse defaults: optional url/slug, --out default None, --check-deps flag** main() declares url with nargs="?" (optional), slug nargs="?" default None, --out default None, and boolean --check-deps described as running the shared environment gate with auto-repair then exiting;
  - the shown slice ends at parse_args() so downstream handling of these values is not visible here.
- 来源：[jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L885–L895](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py#L885-L895)
- **scrape_one_page requires a caller-supplied Playwright page and common module constants** scrape_one_page(page, page_url, dismiss_cookie=False) 接收外部传入的 Playwright page：先 add_init_script 注入 canvas 文本补丁，
  - 再用 page.goto(page_url, wait_until="commit", timeout=common.PAGE_LOAD_TIMEOUT_SECONDS * 1000) 导航，超时常量来自共享 common 模块。主流程随后依赖 build_bounded_stage01_payload 与 common.write_json 落盘 stage01。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L718–L757](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py#L718-L757),
  - [jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L977–L986](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py#L977-L986)
- **Empty or marker-blocked blocks only log a warning and still write a bounded stage01 payload** 在主流程中，当 blocks 为空或（无图片块且正文命中 _blocked_markers）时，仅输出两条 logger.warning（含用 web_fetch_webpage 兜底的提示），不抛错；
  - 随后仍构造 build_bounded_stage01_payload 并 common.write_json 写出 stage01，limits 来自 payload["content_limits"]。另外 scrape_one_page 内 resp.status >= 400 有显式判断分支入口（其后续语句未在展示范围内）。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L969–L987](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py#L969-L987),
  - [jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L753–L757](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py#L753-L757)
- **Chromium launch flags trade HTTP/2 for fingerprint compatibility (inference from in-code comment)** 设计推断（非作者历史意图）：
- The browser is launched with --disable-http2 alongside --no-sandbox and related flags; the code comment states some sites reject Playwright's H2 fingerprint with ERR_HTTP2_PROTOCOL_ERROR.
  - Inference: forcing HTTP/1.1 trades multiplexing performance for compatibility with such sites — the benefit/cost is my reading of the comment, not a measured outcome.
- 来源：[jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L825–L835](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py#L825-L835)
- **Documented manual procedure for scrape_page.py to stage01.json (not executed)** 文档中的人工验收步骤（本轮未执行）：
- SKILL.md documents a manual invocation `{python} scripts/scrape_page.py <URL> <slug>` with expected result `work/<slug>/stage01.json` containing url, slug, title, blocks (heading/text/image with source field) and video_urls,
  - and that video-platform URLs (Bilibili/YouTube/Vimeo/Xiaohongshu) yield blocks=[] plus video_urls=[url]. This is a documented procedure only — NOT EXECUTED here, and it asserts no automated test coverage over block extraction.
- 来源：[jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/SKILL.md:L89–L113](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/SKILL.md#L89-L113)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-skill-page-scrape-blocks.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L820-L880
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L820-L876
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L885-L895
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L825-L835
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L718-L757
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L977-L986
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L969-L987
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L753-L757
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/SKILL.md:L89-L113
- 源页字段（feature）：skill-page-scrape-blocks
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py；jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/print_blocks.py；jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/common.py
  - jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/download_images.py；jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/environment_gate.py
