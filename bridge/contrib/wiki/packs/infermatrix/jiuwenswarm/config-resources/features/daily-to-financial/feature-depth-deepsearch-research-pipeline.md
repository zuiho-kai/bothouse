---
name: feature-depth-deepsearch-research-pipeline
description: openJiuwen-DeepSearch 管线实现深读：execute_deep_search 返回/None 语义、SKILL_ROOT 与 .env、openjiuwen-deepsearch==0.1.1 依赖、缺环境变量 ValueError、吞异常取舍、SKILL.md 手动验收流程（未执行）
metadata:
  scope: 只收 DeepSearch 管线的实现深读条目（流程、接口、配置、依赖、失败模式、取舍、验证）；功能概览归 feature-deepsearch-research-pipeline
---
# openJiuwen-DeepSearch 深度研究执行管线：实现深读

## 现状

- [[feature-deepsearch-research-pipeline]]（功能概览） · [[config-resources-overview-1]]、[[config-resources-overview-2]]（owner 入口）
- **execute_deep_search 同步封装异步工作流并返回报告或 None** execute_deep_search(query) 先调用 load_agent_config() 加载配置，再用 asyncio.run(run_jiuwen_workflow(query, agent_config)) 执行工作流；结果非空则返回报告字符串，为空时记录 warning 并返回 None。
  - run_jiuwen_workflow 内部通过 AgentFactory 创建 agent，异步消费 agent.run 的 chunk 流，用 parse_endnode_content 提取最终报告。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py:L200–L230](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py#L200-L230),
  - [jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py:L80–L98](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py#L80-L98)
- **execute_deep_search(query) 返回报告字符串，捕获 ValueError 与 Exception 时返回 None** execute_deep_search 接收研究题目 query，加载配置后用 asyncio.run 执行 run_jiuwen_workflow；结果非空则返回该字符串，为空记 warning 返回 None，ValueError 与 Exception 分支记日志后同样返回 None（不覆盖 BaseException）。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py:L200–L230](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py#L200-L230)
- **SKILL_ROOT 环境变量默认脚本上级目录，.env 仅为推荐配置位置** SKILL_ROOT 取环境变量，未设置时默认 Path(__file__).parent.parent，并 load_dotenv(SKILL_ROOT/.env)。load_agent_config 用 os.getenv 检查进程环境中必需变量（含 WEB_SEARCH_API_KEY/WEB_SEARCH_URL），缺失时抛出列出变量名的 ValueError，提示语仅建议写入 .env 文件。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py:L41–L46](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py#L41-L46),
  - [jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py:L147–L161](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py#L147-L161)
- **管线依赖 openjiuwen-deepsearch==0.1.1 并直接导入其 Config/AgentFactory/LogManager** 模块 docstring 声明依赖 openjiuwen-deepsearch==0.1.1 与 python-dotenv；
  - 源码实际 from openjiuwen_deepsearch 导入 Config、ExecutionMethod、AgentFactory、ResultExporter、parse_endnode_content、LogManager，并从本地 convert_docx/convert_html 导入转换函数，构成对 SDK 与本地脚本的硬耦合。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py:L6–L34](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py#L6-L34)
- **缺环境变量抛 ValueError，execute_deep_search 捕获后返回 None** 触发条件：任一必填环境变量为空，load_agent_config 在 guard `if missing_vars:` 中 raise ValueError；execute_deep_search 的 `except ValueError`/`except Exception` 分支记录日志并 return None，异常不向外传播，仅以 None 结果呈现。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py:L152–L161](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py#L152-L161),
  - [jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py:L225–L230](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py#L225-L230)
- **execute_deep_search 吞掉 ValueError/Exception 便于调用方，但错误细节只在日志中** 设计推断（非作者历史意图）：
- 益处：Agent 调用方拿到的失败结果统一为 None，不会因配置缺失（ValueError）或其他 Exception 中断。代价：异常的具体原因仅写入 logger.error/exception，调用方无法从返回值区分失败原因（推断）。另 run_background 以注释说明其检查用于防止后台自我重启的无限循环。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py:L225–L230](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py#L225-L230),
  - [jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py:L233–L235](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py#L233-L235)
- **SKILL.md 记录的手动验收流程（仅环境预检与启动观察，未执行）** 文档中的人工验收步骤（本轮未执行）：
- 文档化手动流程（NOT EXECUTED）：先确认技能目录存在 .venv 与已填写的 .env（占位值不算），再运行 uv run "scripts\main.py" --mode query --query "<标题>"，随后读取技能文件夹根目录 PID.info 中的后台子进程 PID，等待约15分钟，并通过该 PID 进程与技能文件夹中的 Markdown/Doc/Html 文件列表判断报告是否生成完成。仅覆盖预检与启动/观察步骤，未含报告内容的断言。
- 来源：[jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/SKILL.md:L12–L16](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/SKILL.md#L12-L16)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/feature-depth-deepsearch-research-pipeline.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py:L200-L230
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py:L80-L98
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py:L41-L46
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py:L147-L161
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py:L6-L34
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py:L152-L161
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py:L225-L230
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py:L233-L235
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/SKILL.md:L12-L16
- 源页字段（feature）：deepsearch-research-pipeline
- 入口（entry_points）：jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py
- 源页字段（source_globs）：jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/main.py；jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/validate_environment.py；jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/convert_docx.py
  - jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/convert_html.py；jiuwenswarm/resources/agent/workspace/skills/openJiuwen-DeepSearch/scripts/verify_skill_structure.py
