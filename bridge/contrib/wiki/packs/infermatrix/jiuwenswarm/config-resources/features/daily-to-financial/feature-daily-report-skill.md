---
name: feature-daily-report-skill
description: 进阶版日报/周报/月报生成器 Skill（advanced-daily-report）功能概览：collectors/analyzers/generators 三层与 run_report.py 独立脚本路径、AGENT_ROOT/.env/AIAnalyzer 配置解析优先级、AI 降级行为、report_generator.py main() 验证入口
metadata:
  scope: 只收 advanced-daily-report 的功能概览（分层结构、路径凭据与 LLM 配置、已实现行为、验证入口）；逐点实现深读归 feature-depth-daily-report-skill
---
# 进阶版日报/周报/月报生成器 Skill（advanced-daily-report）

## 现状

- **分层结构与双实现路径**
- 包结构按文档分为三层：collectors（Git/Email/Memory/Todo 采集器 + DataAggregator 聚合）、analyzers（WorkAnalyzer 工作分析、AIAnalyzer 智能分析）、generators（ReportGenerator 渲染日报/周报/月报）；ReportGenerator.generate_daily 的控制流是 collect → work_analyzer.analyze → 可选 _run_ai_analysis → 渲染 Markdown。
  - 独立脚本 run_report.py 绕过 DataAggregator/WorkAnalyzer/ReportGenerator 流程，自行用 collect_git_stats、collect_email_stats、解析记忆与 todo.md 拼装报告，但它仍复用分析层：从 analyzers.ai_analyzer 导入 AIAnalyzer 并调用 analyze_full。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/generators/report_generator.py:L63–L111
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/generators/report_generator.py#L63-L111`）,
  - [jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/run_report.py:L501–L546](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/run_report.py#L501-L546),
  - [jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/collectors/__init__.py:L13–L28](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/collectors/__init__.py#L13-L28)
- **路径、凭据与 LLM 配置**
- AGENT_ROOT 的解析优先级是 jiuwenswarm.common.utils.get_agent_root_dir()，其次 `JIUWENSWARM_DATA_DIR` 环境变量下的 agent/，最后 `JIUWENSWARM_AGENT_ROOT` 或硬编码 `~/.jiuwenswarm/agent`；
  - CONFIG_ENV 同样优先 get_env_file()，否则 `JIUWENSWARM_DATA_DIR/config/.env` 或 `~/.jiuwenswarm/config/.env`（不使用 JIUWENSWARM_AGENT_ROOT 定位 .env）。collect_email_stats 先解析该 .env 中的 EMAIL_ADDRESS/EMAIL_TOKEN，为空时才回退到同名进程环境变量；EMAIL_PROVIDER 初始即为 "163"，.env 缺失时不会触发其环境回退。
  - AIAnalyzer 从 config.yaml 的 ai_analysis 段读取 model_name/api_base/api_key（缺省 glm-4.7 与 bigmodel OpenAI 兼容端点），否则回退到 react 段——model_name 直接取自 react 本身，api_base/api_key 取自 react.model_client_config。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/run_report.py:L71–L89](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/run_report.py#L71-L89),
  - [jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/run_report.py:L162–L190](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/run_report.py#L162-L190),
  - jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/analyzers/ai_analyzer.py:L104–L139
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/analyzers/ai_analyzer.py#L104-L139`）
- **已实现行为与依赖**
- daily 报告聚合 git log 提交统计、IMAP 邮箱统计、记忆文件条目和 todo.md 勾选框任务，并可启用 AIAnalyzer 的智能摘要、明日计划建议与近 7 天工作模式分析；其中工作模式分析（analyze_work_pattern）是纯统计的确定性计算，不调用 LLM。
  - AI 能力的降级行为分路径：generate_summary/suggest_tomorrow 在 LLM 调用返回空时使用模板化 fallback 文本，但 _get_model 对缺少 openjiuwen 依赖或 API Key 会直接抛 RuntimeError（该调用位于 _call_llm 的 try 之外），ReportGenerator._run_ai_analysis 则捕获整个分析过程的异常并返回 None。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/analyzers/ai_analyzer.py:L141–L195
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/analyzers/ai_analyzer.py#L141-L195`）,
  - jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/analyzers/ai_analyzer.py:L244–L247
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/analyzers/ai_analyzer.py#L244-L247`）,
  - jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/generators/report_generator.py:L94–L111
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/generators/report_generator.py#L94-L111`）,
  - [jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/run_report.py:L735–L775](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/run_report.py#L735-L775)
- **验证入口**
- report_generator.py 自带 main() 测试入口：接收 workspace_dir（可选 git_repo）参数构造 DataAggregator 与 ReportGenerator 并调用 generate_daily()，结果通过 logging.info 输出（未配置日志格式，INFO 级默认不显示）；由于模块顶部使用 `from ..analyzers...` 等包相对导入，直接以脚本方式运行该文件会在进入 main() 前失败，需以包内模块方式执行。
  - 文档另给出手动 CLI 验证命令（如 `python run_report.py daily --save`）作为端到端流程的检验入口。
- Sources / 来源：jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/generators/report_generator.py:L484–L506
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/generators/report_generator.py#L484-L506`）,
  - jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/generators/report_generator.py:L21–L25
  - （源链接 `https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/generators/report_generator.py#L21-L25`）,
  - [docs/zh/开发实践/JiuwenSwarm日报生成器开发实践.md:L276–L295](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%BC%80%E5%8F%91%E5%AE%9E%E8%B7%B5/JiuwenSwarm%E6%97%A5%E6%8A%A5%E7%94%9F%E6%88%90%E5%99%A8%E5%BC%80%E5%8F%91%E5%AE%9E%E8%B7%B5.md#L276-L295)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-daily-report-skill.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/generators/report_generator.py:L63-L111
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/run_report.py:L501-L546
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/collectors/__init__.py:L13-L28
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/run_report.py:L71-L89
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/run_report.py:L162-L190
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/analyzers/ai_analyzer.py:L104-L139
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/analyzers/ai_analyzer.py:L141-L195
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/analyzers/ai_analyzer.py:L244-L247
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/generators/report_generator.py:L94-L111
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/run_report.py:L735-L775
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/generators/report_generator.py:L484-L506
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/generators/report_generator.py:L21-L25
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/开发实践/JiuwenSwarm日报生成器开发实践.md:L276-L295
- 源页字段（feature）：daily-report-skill
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/generators/__init__.py；jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/generators/report_generator.py；jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/run_report.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/generators/__init__.py；jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/generators/report_generator.py；jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/run_report.py
  - jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/analyzers/ai_analyzer.py；jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/collectors/email_collector.py
  - jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/collectors/git_collector.py；jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/collectors/__init__.py
  - jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/collectors/aggregator.py；jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/report_helper.py；jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/collectors/todo_collector.py
  - jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/analyzers/work_analyzer.py
