---
name: feature-depth-coding-memory
description: Code 模式编码记忆实现深读：_build_coding_memory_rail 装配调用链与指纹缓存复用、is_memory_enabled 与 text-embedding-v3 默认值、后台初始化取舍、resolve_project_coding_memory_dir 与 get_node_path 契约、目录解析 helper 单测
metadata:
  scope: 收 interface_code.py 与 coding_memory_paths 的实现级证据，来源另含 config.py、test_coding_memory_paths.py；功能概览与配置入口归 feature-coding-memory
---
# Code 模式编码记忆：实现深读

## 现状

- [[feature-coding-memory]]（功能概览） · [[agent-server-runtime-overview]]（owner 入口）
- **CodingMemoryRail 装配调用链** JiuwenSwarmCodeAdapter._build_coding_memory_rail 以活动配置快照为输入，先经 is_memory_enabled 校验开关与 embed/project_dir/workspace 指纹决定缓存复用，再调用 create_coding_memory_rail；后者通过 _resolve_coding_memory_dir 解析项目级记忆目录并构造 CodingMemoryRail 实例作为输出缓存到 self._coding_memory_rail。
- 调用路径：`jiuwenswarm/server/runtime/agent_adapter/interface_code.py`（`JiuwenSwarmCodeAdapter._build_coding_memory_rail`） → `jiuwenswarm/server/runtime/agent_adapter/interface_code.py`（`create_coding_memory_rail`） →
  - `jiuwenswarm/server/runtime/agent_adapter/interface_code.py`（`_resolve_coding_memory_dir`）
- 来源：[jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L1697–L1739](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_code.py#L1697-L1739),
  - [jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L426–L465](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_code.py#L426-L465),
  - [jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L414–L423](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_code.py#L414-L423),
  - [jiuwenswarm/agents/harness/common/memory/config.py:L250–L281](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/config.py#L250-L281)
- **开关与 Embedding 默认值** is_memory_enabled 读取 modes.code.memory.enabled，code 及 code.* 子模式缺省为 True（agent 模式缺省 False）；create_coding_memory_rail 中 embed_model 缺省 "text-embedding-v3"，embed_base_url 依次取 embed 的 embed_base_url 或 embed_api_base，三者（含 embed_api_key）任一缺失即视为配置不完整并将 api_key 置 None 降级。
- 来源：[jiuwenswarm/agents/harness/common/memory/config.py:L250–L281](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/config.py#L250-L281),
  - [jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L426–L465](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_code.py#L426-L465)
- **后台初始化换取首请求延迟** 设计推断（非作者历史意图）：
- （推断）把冷启动索引用后台 task 完成，收益是 before_invoke 不等待初始化、首个用户请求不被阻塞；代价是管理器就绪前的请求拿不到 _auto_recall 预取，且需用 asyncio.current_task 判断防止取消后的旧 task 覆盖新一轮 rail 状态。
- 来源：[jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L156–L198](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_code.py#L156-L198)
- **resolve_project_coding_memory_dir 目录解析与 get_node_path 双节点名返回契约** resolve_project_coding_memory_dir(*, agent_workspace_dir, project_dir) 将 abspath(agent_workspace_dir)、"coding_memory" 与 resolve_coding_memory_project_name(project_dir) 拼接后返回；
  - project_dir 为 None 或 strip 后为空时该名称取 DEFAULT_CODING_MEMORY_PROJECT。_CodingMemoryToolWorkspace.get_node_path 仅当 node_name 为 "memory" 或 "coding_memory" 时返回构造时传入的目录，否则返回 None。
- 来源：[jiuwenswarm/common/coding_memory_paths.py:L70–L80](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/coding_memory_paths.py#L70-L80),
  - [jiuwenswarm/common/coding_memory_paths.py:L43–L56](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/coding_memory_paths.py#L43-L56),
  - [jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L130–L136](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_code.py#L130-L136)
- **interface_code.py 依赖共享 coding_memory_paths 并声明 _CodingMemoryToolWorkspace** Code 适配器模块从 jiuwenswarm.common.coding_memory_paths 导入 resolve_project_coding_memory_dir，并在模块级声明 _CodingMemoryToolWorkspace；编码记忆路径解析由共享 common 模块定义，不是适配器私有实现。
- 来源：[jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L104–L119](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_code.py#L104-L119)
- **get_node_path 对未知 node_name 返回 None，不抛异常** 触发条件：node_name 不在 {"memory", "coding_memory"} 集合内；守卫分支在本地直接 return None，调用方在此分支拿不到路径也不会收到异常。
- 来源：[jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L133–L136](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_code.py#L133-L136)
- **编码记忆项目目录解析 helper 的既有单测断言（helper 级，本轮未执行）** test_project_memory_directory_uses_isolated_key 直接导入生产 helper，用 tmp_path 下的 agent_workspace 与 project_dir 调用 resolve_project_coding_memory_dir，断言返回路径的父目录等于 agent_workspace.absolute()/"coding_memory"，
  - 末级名称等于 resolve_coding_memory_project_name(project_dir)。断言仅覆盖该目录解析 helper，不构成 CodingMemoryRail 记忆读写的运行时集成测试，本轮未执行。
- 来源：[tests/unit_tests/common/test_coding_memory_paths.py:L9–L16](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/common/test_coding_memory_paths.py#L9-L16),
  - [tests/unit_tests/common/test_coding_memory_paths.py:L47–L59](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/common/test_coding_memory_paths.py#L47-L59),
  - [jiuwenswarm/common/coding_memory_paths.py:L70–L80](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/coding_memory_paths.py#L70-L80)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/feature-depth-coding-memory.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L1697-L1739；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L426-L465
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L414-L423；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/memory/config.py:L250-L281
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L156-L198；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L104-L119
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L133-L136；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/coding_memory_paths.py:L70-L80
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/coding_memory_paths.py:L43-L56；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L130-L136
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/common/test_coding_memory_paths.py:L9-L16；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/common/test_coding_memory_paths.py:L47-L59
- 源页字段（feature）：coding-memory
- 入口（entry_points）：jiuwenswarm/server/runtime/agent_adapter/interface_code.py
- 源页字段（source_globs）：jiuwenswarm/server/runtime/agent_adapter/interface_code.py；jiuwenswarm/agents/harness/code/*
