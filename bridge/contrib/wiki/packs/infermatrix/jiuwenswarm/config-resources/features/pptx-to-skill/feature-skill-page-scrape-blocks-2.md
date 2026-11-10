---
name: feature-skill-page-scrape-blocks-2
description: skill-omni-creation 网页抓取（scrape_page）功能概览第 2 部分：--check-deps 依赖门自检、Stage01 有界输出常量与 JS 叶子文本容器取舍
metadata:
  scope: 只收验证、配置、取舍三段；抓取行为、入口契约与数据流归 feature-skill-page-scrape-blocks-1；实现深读归 feature-depth-skill-page-scrape-blocks
---
# skill-omni-creation 网页抓取到统一 Stage01 Blocks（scrape_page）（2/2）

## 现状

- 拆分说明：本页是源页 `feature-skill-page-scrape-blocks.md` 的第 2/2 部分；第 1 部分 [[feature-skill-page-scrape-blocks-1]]
- **依赖门与 --check-deps 自检**
- 两个脚本都提供 `--check-deps`：只运行共享环境门（自动修复后退出），成功打印 DEPENDENCIES_OK，EnvironmentGateError 时退出码 2。Chromium 启动校验仅在 web/web-images profile 下执行——scrape_page 的 `--check-deps` 走 require_web=True 的 web profile，会验证/修复 Chromium；download_images 使用 images profile（仅 requests/Pillow），不做 Chromium 校验。
- Sources /
  - 来源：[jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L895–L911](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py#L895-L911),
  - jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/download_images.py:L109–L115
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/download_images.py#L109-L115`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/environment_gate.py:L418–L424
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/environment_gate.py#L418-L424`）,
  - [jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/download_images.py:L27–L31](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/download_images.py#L27-L31)
- **Stage01 有界输出的常量与环境门配置**
- Stage01 的体量由 scrape_page.py 顶部的模块常量控制：STAGE01_MAX_BLOCKS=420、STAGE01_MAX_TOTAL_TEXT_CHARS=60_000、STAGE01_MAX_PAGE_OUTPUT_CHARS=90_000；STAGE01_MIN_TEXT_ALLOCATION=40 是加权水填充分配的基准下限参数，实际分配会被预算和原文长度截断（base = min(floor, budget//len)），并非每个保留文本块保证拿到 40 字符。
  - 另有按 format 的结构化文本上限（code/editor 4000、table 2500、definition 2000、canvas 2000、js_text 1200）。运行环境由 environment_gate 的 profile 决定（requests/images/web/web-images），解释器选择顺序为：激活的 VIRTUAL_ENV、已存在的项目 .venv、当前 venv，之后才可能自动创建项目 .venv；web/web-images profile 额外校验并自动修复 Playwright Chromium。
- Sources /
  - 来源：[jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L94–L108](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py#L94-L108),
  - [jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L542–L551](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py#L542-L551),
  - jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/environment_gate.py:L141–L168
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/environment_gate.py#L141-L168`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/environment_gate.py:L418–L424
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/environment_gate.py#L418-L424`）
- **JS 叶子文本容器的取舍与 stage01 单点有界化的取舍**
- 为了捕获用 div/section/article 而非语义标签渲染的 JS 文本，_is_leaf_js_text_container 仅接受文本长度严格大于 15 且不超过 5000 字符的包装元素；当任一后代 div/section/article 的文本超过 15 字符时放弃该容器，代码注释说明这是为了优先取最深层有用包装、避免同一段 JS 文本重复输出——即以可能漏掉部分非语义文本为代价换取去重和噪声控制。
  - 体量控制方面，stage01 被设计为唯一对全页做有界化的环节（420 块 / 60 000 文本字符 / 90 000 序列化字符目标），stage02/03 保持原行为消费有界后的块；超限时按 heading/image 优先级做全局均匀采样并对文本做加权水填充截断。90 000 序列化上限是尽力而非硬保证：保留块数减到 1 后循环停止，且 serialized_chars 字段是在测量之后才附加进 payload 的。
- Sources /
  - 来源：[jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L353–L370](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py#L353-L370),
  - [jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L103–L108](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py#L103-L108),
  - [jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L502–L526](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py#L502-L526),
  - [jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py:L671–L689](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-omni-creation/scripts/scrape_page.py#L671-L689)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-skill-page-scrape-blocks.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
