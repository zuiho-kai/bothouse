---
name: feature-depth-task-memory
description: 任务经验实现深读：experience_retrieve 服务初始化链与输入输出契约、task-data.json 本地持久化、缺配置降级、task_memory.enabled 默认关闭、API_BASE 临时覆写与文档化验收
metadata:
  scope: 只收 task_tools 的实现级事实；任务经验概览归 feature-task-memory
---
# 任务经验检索与沉淀：实现深读

## 现状

- [[feature-task-memory]]（功能概览） · [[agents-team-overview-1]]、[[agents-team-overview-2]]（owner 入口）
- **experience_retrieve 的服务初始化调用链** 工具函数 experience_retrieve(query) 先经 _get_task_data_path() 定位本地 task-data.json，再调用 _get_service() 惰性初始化 TaskMemoryService 单例；
  - _get_service 内部调用 get_config() 读取 config.yaml 的 task_memory 与 embed 段解析模型与密钥，最终 experience_retrieve 用返回的服务执行检索并把本地持久化条目与服务端结果合并为 memory_string 与 retrieved_memory 返回。
- 调用路径：`jiuwenswarm/agents/harness/common/tools/task_tools.py`（`experience_retrieve`） → `jiuwenswarm/agents/harness/common/tools/task_tools.py`（`_get_service`） → `jiuwenswarm/common/config.py`（`get_config`）
- 来源：[jiuwenswarm/agents/harness/common/tools/task_tools.py:L204–L269](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/task_tools.py#L204-L269),
  - [jiuwenswarm/agents/harness/common/tools/task_tools.py:L104–L194](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/task_tools.py#L104-L194),
  - [jiuwenswarm/common/config.py:L237–L244](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config.py#L237-L244)
- **experience_retrieve 的输入输出契约** experience_retrieve 接收 query 字符串，返回含 memory_string（可读文本）与 retrieved_memory（结构化列表）的字典；调用方需注意三种状态：服务可用时为合并结果，服务禁用时返回 status="persisted_only"（仅本地数据），检索抛异常时返回 status="error" 且列表为空。
- 来源：[jiuwenswarm/agents/harness/common/tools/task_tools.py:L204–L269](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/task_tools.py#L204-L269)
- **对 get_agent_workspace_dir 的本地持久化耦合** _get_task_data_path() 通过 get_agent_workspace_dir()（返回 agent 根目录下的 workspace，即 <用户主目录>/.jiuwenswarm/agent/workspace）拼接 task-data.json，使经验数据在 TaskMemoryService 外部服务不可用时仍可从本地文件读出，这是 persisted_only 降级路径的物理基础。
- 来源：[jiuwenswarm/agents/harness/common/tools/task_tools.py:L37–L39](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/task_tools.py#L37-L39),
  - [jiuwenswarm/common/utils.py:L1751–L1760](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/utils.py#L1751-L1760)
- **缺配置与服务异常的降级行为** _get_service 中若 api_key、llm_model 或 embedding_model 任一缺失，记录 warning 并返回 None（工具退化为仅本地持久化）；TaskMemoryService 构造抛异常时置 _service=None 并在下次调用重试初始化。experience_retrieve 中 svc.retrieve 抛异常不向上传播，而是返回 {"status":"error", "error": str(exc), "memory_string":"", "retrieved_memory":[]}。
- 来源：[jiuwenswarm/agents/harness/common/tools/task_tools.py:L150–L194](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/task_tools.py#L150-L194),
  - [jiuwenswarm/agents/harness/common/tools/task_tools.py:L266–L269](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/task_tools.py#L266-L269)
- **task_memory.enabled 默认关闭，模型与凭据经 YAML→专用环境变量→embed 回退链解析，缺项时停用服务** _is_task_memory_enabled() 只读取 get_config()['task_memory']['enabled']，未设置时返回 False；文档记载 enabled: true 后 Agent 获得三个经验工具。
  - _get_service() 构造服务时，llm_model/embedding_model/api_key/api_base 依次取自 YAML task_memory 小节、TASK_MEMORY_* 环境变量、embed 小节或 EMBED_*/通用环境变量；api_key、llm_model 或 embedding_model 任一无法解析时记录「task tools will be disabled」警告并返回 None。
- 来源：[jiuwenswarm/agents/harness/common/tools/task_tools.py:L96–L101](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/task_tools.py#L96-L101),
  - [jiuwenswarm/agents/harness/common/tools/task_tools.py:L121–L146](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/task_tools.py#L121-L146),
  - [jiuwenswarm/agents/harness/common/tools/task_tools.py:L150–L158](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/task_tools.py#L150-L158),
  - [docs/zh/经验记忆.md:L12–L22](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E7%BB%8F%E9%AA%8C%E8%AE%B0%E5%BF%86.md#L12-L22)
- **仅当 api_base 为真时临时覆写进程环境变量 API_BASE，TaskMemoryService 构造返回后才恢复** 设计推断（非作者历史意图）：
- 该分支在 api_base 为真时覆写 os.environ["API_BASE"]，仅在 TaskMemoryService(**kwargs) 返回后按原值恢复或删除；同进程内此窗口中的其他环境变量读取者可能看到被覆写的值（代码注释自述构造器无 api_base 参数、借环境变量传递；收益/代价权衡为我的推断）。
- 来源：[jiuwenswarm/agents/harness/common/tools/task_tools.py:L175–L187](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/task_tools.py#L175-L187)
- **task_memory 启用与 experience_retrieve 调用的文档化验收（本轮未执行）** 文档中的人工验收步骤（本轮未执行）：
- 文档化人工验收步骤（NOT EXECUTED）：在 config/config.yaml 将 task_memory.enabled 设为 true（文档标注为总开关），文档称 Agent 将获得三个工具；再按文档建议在任务开始时以 query 描述当前任务或问题调用 experience_retrieve，检查返回的 memory_string（可读文本）与 retrieved_memory（结构化列表）。不据此声称检索必命中或服务已运行。
- 来源：[docs/zh/经验记忆.md:L7–L22](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E7%BB%8F%E9%AA%8C%E8%AE%B0%E5%BF%86.md#L7-L22),
  - [docs/zh/经验记忆.md:L28–L38](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E7%BB%8F%E9%AA%8C%E8%AE%B0%E5%BF%86.md#L28-L38)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-depth-task-memory.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/task_tools.py:L204-L269；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/task_tools.py:L104-L194
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/config.py:L237-L244；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/task_tools.py:L37-L39
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/utils.py:L1751-L1760；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/task_tools.py:L150-L194
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/task_tools.py:L266-L269；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/task_tools.py:L96-L101
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/task_tools.py:L121-L146；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/task_tools.py:L150-L158
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/经验记忆.md:L12-L22；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/task_tools.py:L175-L187
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/memory/test_external_memory_config.py:L117-L126；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/经验记忆.md:L7-L22
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/经验记忆.md:L28-L38
- 源页字段（feature）：task-memory
- 入口（entry_points）：jiuwenswarm/agents/harness/common/tools/task_tools.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/tools/task_tools.py；jiuwenswarm/agents/harness/common/memory/*
