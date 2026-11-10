---
name: feature-deepsearch-research-pipeline
description: openJiuwen-DeepSearch 深度研究执行管线功能概览：main.py 命令行与 execute_deep_search 契约、后台/前台模式、.env 必需变量与固定默认值、AgentFactory 执行链路、引用标记清洗与 Markdown/HTML/DOCX 导出
metadata:
  scope: 只收 DeepSearch 管线的功能概览（入口契约、配置、执行链路、报告清洗与导出）；实现深读归 feature-depth-deepsearch-research-pipeline
---
# openJiuwen-DeepSearch 深度研究执行管线

## 现状

- **入口与调用契约**
- 命令行入口 `main.py --mode query --query "题目" [--background|--foreground]`，`--mode` 仅支持 `query`，`--query` 默认为 "AI手机研究报告"。`execute_deep_search(query)` 供 Agent 调用，成功返回报告字符串，配置缺失（ValueError）或执行异常时记日志并返回 None；main 据此以退出码 0/1 结束。
  - 未指定 `--foreground` 时默认走后台模式：父进程以 `JIUWEN_BACKGROUND_MODE=1` 重新拉起分离的子进程并写 PID.info 后退出；若环境已是 `JIUWEN_BACKGROUND_MODE=1`，run_background 直接返回，由 main 继续前台执行研究。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py:L200–L230](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py#L200-L230),
  - [jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py:L293–L339](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py#L293-L339),
  - [jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py:L233–L258](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py#L233-L258)
- **配置来源与固定分支默认值**
- 配置来自 `SKILL_ROOT`（环境变量 `SKILL_ROOT`，默认脚本上级目录）下的 `.env`（python-dotenv 加载）。必需环境变量包括 `LLM_MODEL_NAME/LLM_MODEL_TYPE/LLM_BASE_URL/LLM_API_KEY` 与 `WEB_SEARCH_ENGINE_NAME/WEB_SEARCH_API_KEY/WEB_SEARCH_URL`，缺失即在 `load_agent_config` 抛 ValueError。
  - 可选 `MAX_WEB_SEARCH_RESULTS`（默认 "5"）与 `EXECUTION_METHOD`（默认 "parallel"，仅当等于 DEPENDENCY_DRIVING 枚举值才改用依赖驱动）。代码还硬编码分支默认：`search_mode="research"`、`outliner_max_section_num=5`、人机交互与大纲交互均关闭，且导入时强制设置 `LLM_SSL_VERIFY=false`、`TOOL_SSL_VERIFY=false`。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py:L141–L197](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py#L141-L197),
  - [jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py:L41–L49](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py#L41-L49)
- **执行链路与报告产出**
- `execute_deep_search(query)` 先用 `load_agent_config()` 组装配置，再经 `asyncio.run` 调用 `run_jiuwen_workflow`：该协程实例化 `AgentFactory` 并调用其实例方法 `create_agent(agent_config)`，随后异步消费 `agent.run(...)` 的流式 chunk，对每个 chunk 做 `parse_endnode_content` 判定；
  - 只要 `full_report` 仍为假值就取该节点的 `response_content` 并清洗引用标记，因此空报告可被后续节点覆盖。最终报告写入 Markdown 并转换为 HTML/DOCX。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py:L200–L230](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py#L200-L230),
  - [jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py:L70–L127](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py#L70-L127)
- **报告引用清洗与多格式导出**
- 报告文本在返回前做两种引用标记清洗：`CHECKED_CITATION_RE` 把 `[checked_citation: N]` 前缀剥掉、保留其后的 `[[N]](url)` 链接，`LEGACY_CITATION_RE` 直接删除旧式 `[citation: N]` 标记。导出时 `run_jiuwen_workflow` 将报告写成 Markdown，再调用 `convert_md_to_html` 和 `convert_md_to_docx`，并把三个文件移入 `SKILL_ROOT/output/reports`；
  - 该 try 块仅捕获 OSError，此时只在当前目录重写 Markdown 文件作为回退。
- Sources / 来源：[jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py:L36–L39](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py#L36-L39),
  - [jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py:L98–L127](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py#L98-L127)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-deepsearch-research-pipeline.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py:L200-L230
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py:L293-L339
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py:L233-L258
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py:L141-L197
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py:L41-L49
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py:L70-L127
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py:L36-L39
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py:L98-L127
- 源页字段（feature）：deepsearch-research-pipeline
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py；jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/validate_environment.py；jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/convert_docx.py
  - jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/convert_html.py；jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/verify_skill_structure.py
