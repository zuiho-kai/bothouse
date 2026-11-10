---
name: feature-depth-skill-generator-cli-1
description: skill-gen CLI 实现深读第 1 部分：url-fetch 非微信 URL 的流程、sop-text 与 url-fetch 的 API 契约（skill_generator_cli.py L61-L96）
metadata:
  scope: 只收流程与 API 两个侧面；失败模式与可选解析依赖取舍归 feature-depth-skill-generator-cli-2，配置、依赖与人工验收记录归 feature-depth-skill-generator-cli-3
---
# skill-gen CLI（sop-text / url-fetch 子命令）：实现深读（1/3）

## 现状

- 拆分说明：本页是源页 `feature-depth-skill-generator-cli.md` 的第 1/3 部分；第 2 部分 [[feature-depth-skill-generator-cli-2]]；第 3 部分 [[feature-depth-skill-generator-cli-3]]
- [[feature-skill-generator-cli-1]]、[[feature-skill-generator-cli-2]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **url-fetch with a non-WeChat URL: trimmed input routed to the generic fetcher, pages serialized, return 0** In _cmd_url_fetch, a stripped-empty --url logs "error: empty --url" and returns 2 locally; otherwise fetch_pages_from_url is awaited,
  - each FetchedPage is converted via asdict to indent=2 JSON, written to --out-json (parent dirs created) or emitted to stdout by the dedicated stdout_payload logger (INFO, propagate disabled), and the handler returns 0. The router strips the URL, generates a uuid4 doc_id,
  - and dispatches to fetch_web_page when is_wechat_article_url is false.
- 来源：jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py:L81–L96
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py#L81-L96`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py:L47–L58
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py#L47-L58`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/router.py:L31–L41
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/router.py#L31-L41`）
- **sop-text extracts raw text; url-fetch fetches pages as JSON** _cmd_sop_text takes --sop-file (expanded/resolved), and with --print-raw-chars logs len(raw) and returns 0; with --out-text writes the file (mkdir parents) and returns 0; otherwise logs raw text.
  - _cmd_url_fetch requires a non-empty --url, awaits fetch_pages_from_url, and writes or logs json.dumps of [asdict(p)] with --out-json.
- 来源：jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py:L61–L96
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py#L61-L96`）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-skill-generator-cli.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py:L61-L96
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L444-L455
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py:L61-L65
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py:L84-L88
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/web_page.py:L126-L141
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py:L81-L96
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py:L47-L58
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/router.py:L31-L41
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/reference/operator-playbook.md:L3-L19
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py:L114-L117
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/router.py:L19-L41
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/web_page.py:L24-L28
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/web_page.py:L14-L15
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/web_page.py:L44-L49
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py:L40-L44
- 源页字段（feature）：skill-generator-cli
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py；jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/web_page.py
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/__init__.py；jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/models.py
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/router.py；jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/wechat_article.py
