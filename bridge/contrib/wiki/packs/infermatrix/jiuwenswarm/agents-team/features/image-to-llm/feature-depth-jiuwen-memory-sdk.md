---
name: feature-depth-jiuwen-memory-sdk
description: JiuwenMemory SDK 接入实现深读：配置读取链、sdk 后端默认值（sqlite/milvus/elasticsearch、embedder_dim=1024）、顶层 LLM/embed 凭据复用、recall/write 线程调用、构建失败兜底、现有单测
metadata:
  scope: 收 external_memory_builder.py 与 external_memory_config.py 的实现级事实，来源另含 test_external_memory_builder.py、test_external_memory_config.py；职责、配置入口与验证方法的概览归 feature-jiuwen-memory-sdk
---
# JiuwenMemory 进程内 SDK 接入：实现深读

## 现状

- [[feature-jiuwen-memory-sdk]]（功能概览） · [[agents-team-overview-1]]、[[agents-team-overview-2]]（owner 入口）
- **rail 装配入口的配置读取链** build_external_memory_rail 以可选 config 字典为输入：先尝试从 openjiuwen.harness.rails 导入 ExternalMemoryRail（失败即返回 None），再调用 get_external_memory_config 取得 memory.external 段；该函数在未显式传入 config 时调用 _load_config 从 YAML（经环境变量解析并缓存）读取。产出为填好默认值的配置字典，供后续按 provider 字段分派构造 provider 与 rail。
- 调用路径：`jiuwenswarm/agents/harness/common/memory/external_memory_builder.py`（`build_external_memory_rail`） → `jiuwenswarm/agents/harness/common/memory/external_memory_config.py`（`get_external_memory_config`） → `jiuwenswarm/agents/harness/common/memory/config.py`（`_load_config`）
- 来源：[jiuwenswarm/agents/harness/common/memory/external_memory_builder.py:L30–L85](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/external_memory_builder.py#L30-L85),
  - [jiuwenswarm/agents/harness/common/memory/external_memory_config.py:L53–L73](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/external_memory_config.py#L53-L73),
  - [jiuwenswarm/agents/harness/common/memory/config.py:L57–L76](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/config.py#L57-L76)
- **SDK 后端与引擎的代码默认值** _build_jiuwen_sdk_config_dict 中 sdk 字段缺省为 kv_type=sqlite、vector_type=milvus、db_type=elasticsearch、embedder_dim=1024；_kv_spec 在 kv_type=sqlite 且 kv_url 含 "://"（如遗留 redis:// 值）时回落为文件 agent_memory.db。
  - get_memory_engine 对 memory.engine 的缺省与非法值一律返回 builtin，因此外接记忆需显式 engine 为 external 或 both。
- 来源：[jiuwenswarm/agents/harness/common/memory/external_memory_builder.py:L299–L331](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/external_memory_builder.py#L299-L331),
  - [jiuwenswarm/agents/harness/common/memory/external_memory_builder.py:L391–L402](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/external_memory_builder.py#L391-L402),
  - [jiuwenswarm/agents/harness/common/memory/external_memory_config.py:L31–L40](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/external_memory_config.py#L31-L40)
- **复用 jiuwenswarm 顶层 LLM/embed 配置** _jiuwenswarm_llm_creds 从 full_config（缺省 _load_config()）的 models.defaults 列表取 is_default 条目；无 is_default 条目时回落取第一条，defaults 为 dict 时直接使用。
  - 凭据 api_key/model_name/api_base 齐全才写入 globals 并设置 llm target（dashscope 或 openai，按 api_base+client_provider 是否含 "dashscope" 推断）。embed 凭据来自 get_embed_config()，其 base_url 会去掉尾部 /embeddings 以适配 openai_embedder。
- 来源：[jiuwenswarm/agents/harness/common/memory/external_memory_builder.py:L431–L461](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/external_memory_builder.py#L431-L461),
  - [jiuwenswarm/agents/harness/common/memory/external_memory_builder.py:L299–L388](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/external_memory_builder.py#L299-L388),
  - [jiuwenswarm/agents/harness/common/memory/config.py:L79–L91](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/config.py#L79-L91)
- **现有单测入口** tests/unit_tests/agentserver/memory/test_external_memory_config.py 的 test_engine_gates_truth_table（L123-126）断言 is_external_memory_allowed 在 builtin/external/both/none 下的真假表；
  - test_external_config_defaults_when_missing（L133-141）断言 memory.external 缺省时 provider 为空串、user_id/scope_id 为 __default__。test_external_memory_builder.py 通过 _install_agent_core_stubs（L106-133）向 sys.modules 注入 _FakeRail/_FakeProvider 桩以便导入被测模块。此处仅记录断言内容，不宣称测试当前已运行通过。
- 来源：[tests/unit_tests/agentserver/memory/test_external_memory_config.py:L117–L141](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/memory/test_external_memory_config.py#L117-L141),
  - [tests/unit_tests/agentserver/memory/test_external_memory_builder.py:L106–L133](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/memory/test_external_memory_builder.py#L106-L133)
- **SDK 后端 search/add：同步 recall/write 须经 asyncio.to_thread 调用** search(query, top_k) 以 Scope(org=tenant_id, user=user_id)+Context(scope) 经 asyncio.to_thread 调 api.recall(..., top_k=k, disclosure=L2)——recall 同步且内部 asyncio.run()，故须丢到工作线程；
  - add(content, infer, tags) 仅 infer 时附 metadata={"infer": "true"}，以 Modality.TEXT 经 asyncio.to_thread 调 api.write。
- 来源：[docs/zh/JiuwenMemory-SDK接入.md:L494–L503](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/JiuwenMemory-SDK%E6%8E%A5%E5%85%A5.md#L494-L503)
- **jiuwenmemory provider 构建异常被 except Exception 兜住，函数局部返回 None** 触发：jiuwenmemory 分支 _build_jiuwen_provider 抛异常（文档：SDK assemble 失败抛 RuntimeError，agent-memory 未安装亦然）；守卫：except Exception 记 warning；恢复：return None，异常不外抛，记忆轨缺席、对话照常进行。
- 来源：[jiuwenswarm/agents/harness/common/memory/external_memory_builder.py:L47–L66](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/external_memory_builder.py#L47-L66),
  - [docs/zh/JiuwenMemory-SDK接入.md:L488–L512](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/JiuwenMemory-SDK%E6%8E%A5%E5%85%A5.md#L488-L512)
- **mode=="sdk" 进程内直调内核免 HTTP 跳数，代价是须已安装 agent-memory** `_build_jiuwen_provider` 文档串写明：模式由 `memory.external.jiuwen.mode` 选择、默认 `server`；`mode=="sdk"` 经 `from api import assemble` 在进程内构建并直调 agent-memory 内核，无 HTTP 跳数（收益），代价是必须已安装 `agent-memory`（`pip install JiuwenMemory`）。
- 来源：[jiuwenswarm/agents/harness/common/memory/external_memory_builder.py:L197–L208](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/external_memory_builder.py#L197-L208),
  - [docs/zh/JiuwenMemory-SDK接入.md:L469–L480](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/JiuwenMemory-SDK%E6%8E%A5%E5%85%A5.md#L469-L480)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-depth-jiuwen-memory-sdk.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/memory/external_memory_builder.py:L30-L85
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/memory/external_memory_config.py:L53-L73；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/memory/config.py:L57-L76
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/memory/external_memory_builder.py:L299-L331
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/memory/external_memory_builder.py:L391-L402
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/memory/external_memory_config.py:L31-L40
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/memory/external_memory_builder.py:L431-L461
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/memory/external_memory_builder.py:L299-L388；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/memory/config.py:L79-L91
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/memory/test_external_memory_config.py:L117-L141
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/memory/test_external_memory_builder.py:L106-L133；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/JiuwenMemory-SDK接入.md:L494-L503
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/memory/external_memory_builder.py:L47-L66；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/JiuwenMemory-SDK接入.md:L488-L512
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/memory/external_memory_builder.py:L197-L208；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/JiuwenMemory-SDK接入.md:L469-L480
- 源页字段（feature）：jiuwen-memory-sdk
- 入口（entry_points）：jiuwenswarm/agents/harness/common/memory/external_memory_builder.py；jiuwenswarm/agents/harness/common/memory/external_memory_config.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/memory/external_memory_builder.py；jiuwenswarm/agents/harness/common/memory/external_memory_config.py
