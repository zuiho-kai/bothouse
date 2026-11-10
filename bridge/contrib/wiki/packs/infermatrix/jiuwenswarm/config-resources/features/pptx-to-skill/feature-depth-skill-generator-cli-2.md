---
name: feature-depth-skill-generator-cli-2
description: skill-gen CLI 实现深读第 2 部分：两个前置守卫返回 2、fetch_web_page 异常改写为 ValueError、AutoFileParser 可选依赖取舍
metadata:
  scope: 只收失败模式与取舍两个侧面；流程与 API 归 feature-depth-skill-generator-cli-1，配置、依赖与人工验收归 feature-depth-skill-generator-cli-3
---
# skill-gen CLI（sop-text / url-fetch 子命令）：实现深读（2/3）

## 现状

- 拆分说明：本页是源页 `feature-depth-skill-generator-cli.md` 的第 2/3 部分；第 1 部分 [[feature-depth-skill-generator-cli-1]]；第 3 部分 [[feature-depth-skill-generator-cli-3]]
- **CLI 两个前置守卫返回 2；fetch_web_page 的抓取异常被改写为 ValueError 且 _cmd_url_fetch 不捕获** _cmd_sop_text 中 expanduser/resolve 后非普通文件则 logger.error 并 return 2；_cmd_url_fetch 中空白 --url 同样 return 2（均为函数返回值）。fetch_web_page 的 try 块把 HTTPStatusError（含状态码）与 RequestError 等异常改写为带 URL 的 ValueError；
  - _cmd_url_fetch 未捕获 ValueError，异常沿 await 上抛。解析后正文节点缺失或文本不足 50 字符也抛 ValueError。
- 来源：jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py:L61–L65
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py#L61-L65`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py:L84–L88
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_generator_cli.py#L84-L88`）,
  - jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/web_page.py:L126–L141
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/url_ingest/web_page.py#L126-L141`）
- **Optional parser dependency: graceful fallback vs format loss** 设计推断（非作者历史意图）：
- Inference: making AutoFileParser optional (ImportError fallback to plain read) lets sop-text run without agent-core, but costs support for non-text suffixes, which raise "无法解析 SOP 文件..." telling the user to install agent-core or provide .md/.txt.
- 来源：jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py:L444–L455
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/skill-gen-4-enterprise-doc/scripts/skill_gen/sop_parser.py#L444-L455`）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-skill-generator-cli.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
