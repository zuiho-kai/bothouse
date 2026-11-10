---
name: feature-skill-generator-cli-1
description: skill-gen CLI（sop-text / url-fetch）功能概览第 1 部分：命令行入口与子命令契约、分层结构与数据流
metadata:
  scope: 只收 API 与架构两段；参数默认值、URL 分发与使用示例归 feature-skill-generator-cli-2；实现深读归 feature-depth-skill-generator-cli-1
---
# skill-gen CLI（sop-text / url-fetch 子命令）（1/2）

## 现状

- 拆分说明：本页是源页 `feature-skill-generator-cli.md` 的第 1/2 部分；第 2 部分 [[feature-skill-generator-cli-2]]
- **命令行入口与子命令契约**
- CLI 通过 `python3 .../scripts/skill_generator_cli.py` 调用，argparse 定义两个必选子命令：`sop-text --sop-file <Path>`（可选 `--out-text`、`--print-raw-chars`）和 `url-fetch --url <str>`（可选 `--out-json`）。handler 返回 int 作为进程退出码；文件不存在或 URL 为空返回 2。
  - `sop-text` 仅输出纯文本（复用 `skill_gen.sop_parser._extract_raw_text`），明确不产出 SOPStructure JSON；`url-fetch` 输出 `FetchedPage` 的 JSON 数组（dataclass 经 `asdict` 序列化），写到 `--out-json` 或 stdout。脚本必须以绝对路径调用，不依赖 cwd。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py:L99–L124
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py#L99-L124`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py:L61–L96
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py#L61-L96`）
- **分层结构与数据流**
- CLI 是薄壳：`main()` 配置日志并把脚本目录追加到 `sys.path` 尾部（避免遮蔽 stdlib），然后 `asyncio.run` 进入子命令 handler；重依赖（skill_gen 各模块）在 handler 内延迟导入。`url-fetch` 数据流为 CLI → `url_ingest.fetch_pages_from_url`（router）→ 按 URL 形态分发到 `fetch_wechat_article` 或 `fetch_web_page` → 各自解析 HTML 并返回 `List[FetchedPage]`（通常一个元素）。
  - `url_ingest.__init__` 另提供 `validate_fetch_and_flatten`：先做 SSRF 校验（`check_url_allowed_for_fetch`）再抓取并拼平为单一文档字符串——CLI 路径未调用该校验，属上层组合入口。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py:L40–L44
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py#L40-L44`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/router.py:L19–L41
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/router.py#L19-L41`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/__init__.py:L34–L51
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/__init__.py#L34-L51`）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-skill-generator-cli.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py:L99-L124
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py:L61-L96
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py:L40-L44
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/router.py:L19-L41
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/__init__.py:L34-L51
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py:L70-L76
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py:L91-L95
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/web_page.py:L24-L28
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/router.py:L33-L37
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/router.py:L39-L41
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/web_page.py:L70-L80
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/web_page.py:L139-L141
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/wechat_article.py:L110-L115
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py:L8-L13
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/web_page.py:L152-L153
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/wechat_article.py:L126-L127
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py:L62-L65
- 源页字段（feature）：skill-generator-cli
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py；jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/web_page.py
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/__init__.py；jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/models.py
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/router.py；jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/wechat_article.py
