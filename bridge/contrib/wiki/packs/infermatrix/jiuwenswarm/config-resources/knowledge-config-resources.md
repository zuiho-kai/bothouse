---
name: knowledge-config-resources
description: 内置日报技能 advanced-daily-report 的采集、分析、渲染链路，generate_daily/collect 入口，ReportConfig 默认值与 AIAnalyzer 模型配置，baoyu-image-gen 与 register_group.py 的校验入口
metadata:
  scope: 只收 config-resources 的 knowledge 页：advanced-daily-report 的链路、接口、配置、取舍、可选集成与校验入口；目录索引归 config-resources-overview-1 和 config-resources-overview-2
---
# 内置日报技能：采集、报告接口与模型配置

## 现状

### 内置日报技能的采集、分析、渲染链路

- 此处说明 resources 中随包提供的 advanced-daily-report 技能。DataAggregator 固定创建 memory 与 todo 采集器，Git 根据 git_repo 可选创建，邮件采集器则在 collect() 中按 email_config 延迟创建。ReportGenerator.generate_daily() 依次采集、调用 WorkAnalyzer、按开关执行 AI 分析，最后渲染日报。
- 来源：
  - [jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/collectors/aggregator.py:L65–L148](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/collectors/aggregator.py#L65-L148),
  - jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/generators/report_generator.py:L45–L92
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/generators/report_generator.py#L45-L92`）

### 日报入口的参数与返回值

- `generate_daily(date=None, config=None) -> str` 的函数文档约定返回 Markdown 日报；未传 config 时创建 ReportConfig。采集入口 `collect(date=None, include_comparison=True) -> CollectedData` 将日期、采集时间以及 memory/todo/Git/email 数据组织成聚合对象。日期未传时由两个入口各自计算当天日期。
- 来源：jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/generators/report_generator.py:L63–L92
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/generators/report_generator.py#L63-L92`）,
  - [jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/collectors/aggregator.py:L97–L148](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/collectors/aggregator.py#L97-L148)

### 报告开关与技能专用模型配置

- ReportConfig 默认 enable_ai_analysis=False、include_trends=True、include_suggestions=True、output_format=markdown。AIAnalyzer 的配置加载优先读 ai_analysis 的 model_name/api_base/api_key；没有这一段时读 react.model_name，并从 react.model_client_config 读 api_base 与 api_key。
  - 该技能的回退默认 model_name 为 glm-4.7、api_base 为 `https://open.bigmodel.cn/api/paas/v4`、api_key 为空；它们是这个 helper 的默认值。
- 来源：jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/generators/report_generator.py:L28–L39
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/generators/report_generator.py#L28-L39`）,
  - jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/analyzers/ai_analyzer.py:L104–L139
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/analyzers/ai_analyzer.py#L104-L139`）

### 可选 AI 与本地报告链路

- 设计推断（非作者历史意图）：
- 日报入口默认关闭 AI 分析。启用后，AIAnalyzer 延迟创建，并由同步入口通过 asyncio.run 调用其异步分析；初始化或分析异常会在这一层记录日志并返回 None，随后日报入口仍进入渲染。由此推断，本地报告链路减少了对 LLM 可用性的依赖，但启用 AI 后该同步调用仍需等待分析完成。
- 来源：jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/generators/report_generator.py:L77–L111
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/generators/report_generator.py#L77-L111`）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/knowledge-config-resources.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/collectors/aggregator.py:L65-L148
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/generators/report_generator.py:L45-L92
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/generators/report_generator.py:L63-L92
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/collectors/aggregator.py:L97-L148
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/generators/report_generator.py:L28-L39
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/analyzers/ai_analyzer.py:L104-L139
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/generators/report_generator.py:L77-L111
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/collectors/aggregator.py:L116-L148
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/agnes.test.ts:L66-L120
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/dashscope.test.ts:L343-L350
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/agent-group-creator/scripts/register_group.py:L14-L30

## 待办

### memory、todo、Git 与邮件的可选集成

- 聚合器始终采集 workspace 中的 memory 和 todo；只有配置了 Git 采集器才取指定日期的提交。邮件配置包含 address、auth_code 与可选 provider（默认 163），初始化和采集异常在 collect() 内记录日志后继续；include_comparison 控制是否追加历史对比数据。
- 来源：jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/collectors/aggregator.py:L116–L148
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/collectors/aggregator.py#L116-L148`）
- **baoyu-image-gen 供应商脚本的单元测试与技能脚本的运行时校验入口**
- baoyu-image-gen 的 provider 模块带有 node:test 单元测试（helper 单测类别，此处未执行）：如 agnes.test.ts 用断言覆盖 snapDim 的 32 对齐、parseAspectRatio 的合法/非法输入、resolveSize 的 32 对齐与 2048 最大边，以及 validateArgs 对 --n>1 的拒绝；dashscope.test.ts 同样断言 n=2 被拒以防多图计费，并用 mock 的 globalThis.fetch 捕获请求体做契约断言。
  - 此外，agent-group-creator 的 register_group.py 提供 --validate-only 运行时校验入口：调用 load_agent_group_package 加载并校验包（含 README.md 存在、禁止符号链接检查），通过时输出 RESULT: PASS。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/agnes.test.ts:L66–L120
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/agnes.test.ts#L66-L120`）,
  - jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/dashscope.test.ts:L343–L350
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/baoyu-image-gen/scripts/providers/dashscope.test.ts#L343-L350`）,
  - [jiuwenswarm/resources/agent/workspace/skills/agent-group-creator/scripts/register_group.py:L14–L30](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/agent-group-creator/scripts/register_group.py#L14-L30)
