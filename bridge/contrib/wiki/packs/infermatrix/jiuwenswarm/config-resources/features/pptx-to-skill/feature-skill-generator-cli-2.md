---
name: feature-skill-generator-cli-2
description: skill-gen CLI（sop-text / url-fetch）功能概览第 2 部分：命令行参数与后端抓取默认值、URL 分发与正文抽取、使用示例与可观测点
metadata:
  scope: 只收配置、特性、验证三段；入口契约与分层结构归 feature-skill-generator-cli-1；实现深读归 feature-depth-skill-generator-cli-1
---
# skill-gen CLI（sop-text / url-fetch 子命令）（2/2）

## 现状

- 拆分说明：本页是源页 `feature-skill-generator-cli.md` 的第 2/2 部分；第 1 部分 [[feature-skill-generator-cli-1]]
- **命令行参数与后端抓取默认值**
- `sop-text` 需要 `--sop-file`（Path），`--print-raw-chars` 优先于 `--out-text`：置位时只向 stdout 打印字符数并立即返回，不会写文件；否则有 `--out-text` 就写 UTF-8 文件，否则打印原文。`url-fetch` 需要 `--url`，有 `--out-json` 写文件、否则打印 JSON。两个后端模块各自默认 `DEFAULT_TIMEOUT = 30.0` 和 Chrome/120 User-Agent；
  - router 仅当调用方显式传 `timeout`/`user_agent`（非 None）时才覆盖默认值。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py:L70–L76
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py#L70-L76`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py:L91–L95
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py#L91-L95`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/web_page.py:L24–L28
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/web_page.py#L24-L28`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/router.py:L33–L37
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/router.py#L33-L37`）
- **URL 分发与正文抽取行为**
- `fetch_pages_from_url` 按 URL 形态分发：匹配 `mp.weixin.qq.com` 等 `/s` 链接走 `fetch_wechat_article`，其余 HTTP(S) 走 `fetch_web_page`；通用页面在 `MAIN_CONTENT_SELECTORS` 候选中选取文本量 >100 字符的节点，失败时降级为 body 内 >200 字符的容器，最终回退到整个 body，且抽取出的正文至少 50 字符否则报错。WeChat 抓取器要求页面存在 `div#js_content` 节点，抽取为空即抛错；
  - 两者都输出单个 `FetchedPage`（含 title、source_type、metadata）。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/router.py:L39–L41
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/router.py#L39-L41`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/web_page.py:L70–L80
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/web_page.py#L70-L80`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/web_page.py:L139–L141
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/web_page.py#L139-L141`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/wechat_article.py:L110–L115
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/wechat_article.py#L110-L115`）
- **使用示例与运行期可观测点**
- 模块 docstring 给出两个子命令的调用模板（`/ABS/.../skill_generator_cli.py sop-text --sop-file /ABS/SOP.md [--out-text ...] [--print-raw-chars]` 与 `url-fetch --url 'https://...' [--out-json ...]`），是带占位符的示例而非可直接执行的完整命令。
  - 运行期可观测点包括：两个抓取器成功解析后通过 logger 记录 `Parsed ...: url=... title=...`（web_page.py:152、wechat_article.py:126），CLI 对文件不存在或空 URL 返回退出码 2。所示文件中未包含测试入口。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py:L8–L13
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py#L8-L13`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/web_page.py:L152–L153
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/web_page.py#L152-L153`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/wechat_article.py:L126–L127
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/wechat_article.py#L126-L127`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py:L62–L65
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py#L62-L65`）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-skill-generator-cli.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
