---
name: feature-skill-page-scrape-blocks-1
description: skill-omni-creation 网页抓取（scrape_page）功能概览第 1 部分：支持的抓取行为与依赖、命令行入口与退出契约、stage01 数据流
metadata:
  scope: 只收特性、API、架构三段；依赖门、有界输出常量与取舍归 feature-skill-page-scrape-blocks-2；实现深读归 feature-depth-skill-page-scrape-blocks
---
# skill-omni-creation 网页抓取到统一 Stage01 Blocks（scrape_page）（1/2）

## 现状

- 拆分说明：本页是源页 `feature-skill-page-scrape-blocks.md` 的第 1/2 部分；第 2 部分 [[feature-skill-page-scrape-blocks-2]]
- **支持的抓取行为与依赖关系**
- 支持：无头 Chromium 单页抓取（stealth UA、可选 playwright_stealth、cookie 横幅点掉、懒加载滚动）；统一 blocks 提取，覆盖语义标签、ARIA 角色、contenteditable/自定义编辑器、canvas、JS 渲染的 div/section/article 叶子文本，并对嵌入的 YouTube/Bilibili/Vimeo 链接做 `detect_video_urls_from_html` 归一；平台 URL 走 yt-dlp/Bilibili API 取标题后直接移交流程。
  - 外部依赖包括 Playwright+Chromium（由 environment_gate 自动修复安装）、bs4、yt-dlp 子进程和 stage_04b 视频处理、download_images 的 stage02 消费方。文档证据缺失，以上仅来自所示实现。
- Sources /
  - 来源：[jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L375–L402](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py#L375-L402),
  - [jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L703–L713](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py#L703-L713),
  - [jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L820–L876](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py#L820-L876)
- **命令行入口与退出契约**
- scrape_page.py 以 `main()` 为入口，接受可选位置参数 url、slug，以及 `--out`（覆盖默认的 work/<slug>/stage01.json 输出路径）和 `--check-deps`。环境门失败时退出码为 2；仅当异常从 `scrape_page()` 逃逸（如浏览器启动失败）才以退出码 4 结束，而单页加载异常在 `scrape_one_page` 内被捕获并返回空 HTML 继续。写入由 common.write_json 原子完成（tmp 文件加 os.replace）。
- Sources /
  - 来源：[jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L885–L911](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py#L885-L911),
  - [jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L922–L922](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py#L922-L922),
  - [jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L955–L966](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py#L955-L966),
  - [jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/common.py:L52–L57](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/common.py#L52-L57)
- **阶段数据流：stage01 块到下游消费**
- scrape_page 用 Playwright 抓单页，将 DOM 解析为统一 blocks（heading/text/image）并写入有界的 stage01.json。download_images（stage02）读取整个 stage01：仅对 image 块并发下载与去重，但所有非 image 块原样保留并连同资产清单一起写入 stage02.json。print_blocks 为 stage01/02/03 提供同一套有界代表视图（`_select_bounded_indices` + 字符预算），避免下游扩大模型可见上下文。
- Sources /
  - 来源：[jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L860–L876](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py#L860-L876),
  - [jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/download_images.py:L94–L95](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/download_images.py#L94-L95),
  - jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/download_images.py:L134–L158
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/download_images.py#L134-L158`）,
  - [jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/print_blocks.py:L126–L138](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/print_blocks.py#L126-L138)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-skill-page-scrape-blocks.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L375-L402
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L703-L713
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L820-L876
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L885-L911
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L922-L922
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L955-L966
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/common.py:L52-L57
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L860-L876
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/download_images.py:L94-L95
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/download_images.py:L134-L158
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/print_blocks.py:L126-L138
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L895-L911
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/download_images.py:L109-L115
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/environment_gate.py:L418-L424
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/download_images.py:L27-L31
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L94-L108
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L542-L551
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/environment_gate.py:L141-L168
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L353-L370
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L103-L108
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L502-L526
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L671-L689
- 源页字段（feature）：skill-page-scrape-blocks
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py；jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/print_blocks.py；jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/common.py
  - jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/download_images.py；jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/environment_gate.py
