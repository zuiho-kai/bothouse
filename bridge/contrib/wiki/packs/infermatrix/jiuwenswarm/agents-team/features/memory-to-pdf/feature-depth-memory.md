---
name: feature-depth-memory
description: 长期记忆实现深读：记忆开关的模式默认值、build_external_memory_rail 返回契约与依赖降级、run_sweep 扫描、向量检索 vec0 降级与 top-k 取舍、外接记忆配置单测
metadata:
  scope: 只收长期记忆的开关、外接记忆构造、sweeper 与向量检索的实现细节；功能概览归 feature-memory
---
# 长期记忆：实现深读

## 现状

- [[feature-memory]]（功能概览） · [[agents-team-overview-1]]、[[agents-team-overview-2]]（owner 入口）
- **记忆开关的模式相关默认值** is_memory_enabled(mode) 经 _resolve_mode_memory 归一 mode 后读 modes.agent.memory.enabled 或 modes.code.memory.enabled：code 族（含 code.*、agent.code.*、team.code.*，判定复用 mode_matrix.is_code_profile_mode）缺省 enabled=True，agent 族缺省 False；配置读取抛异常时记 warning 并返回 False。
  - 另 DreamingConfig.load 中，环境变量 DREAMING_{MODE}_ENABLED 优先于 config.yaml 的 memory.dreaming.{mode}.enabled（默认 false），间隔默认 14400.0 秒且可被 DREAMING_INTERVAL 覆盖。
- 来源：[jiuwenswarm/agents/harness/common/memory/config.py:L250–L281](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/config.py#L250-L281),
  - [jiuwenswarm/agents/harness/common/memory/config.py:L207–L247](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/config.py#L207-L247),
  - [jiuwenswarm/agents/harness/common/memory/dreaming/sweeper.py:L51–L71](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/dreaming/sweeper.py#L51-L71)
- **build_external_memory_rail 的返回契约与调用方门控义务** 契约：输入 config 字典（第 42 行 get_external_memory_config(config)），返回 ExternalMemoryRail 或 None——rail 导入失败记 warning 返回 None（37-40），provider 名为空返回 None（44-45），
  - 按 provider 名分发到 _build_openjiuwen/_build_mem0/_build_openviking/_build_lakebase/_build_jiuwen_provider（49-58），rail 构造异常同样返回 None（83-85）。调用方义务：本函数不检查 memory.engine，test_engine_builtin_still_builds_caller_must_gate 断言 engine=builtin 且 provider=mem0 时仍建成 rail，引擎门控须由调用方另行完成。
- 来源：[jiuwenswarm/agents/harness/common/memory/external_memory_builder.py:L37–L47](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/external_memory_builder.py#L37-L47),
  - [jiuwenswarm/agents/harness/common/memory/external_memory_builder.py:L49–L58](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/external_memory_builder.py#L49-L58),
  - [jiuwenswarm/agents/harness/common/memory/external_memory_builder.py:L82–L85](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/external_memory_builder.py#L82-L85),
  - [tests/unit_tests/agentserver/memory/test_external_memory_builder.py:L285–L290](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/memory/test_external_memory_builder.py#L285-L290)
- **外接记忆配置与构造的单元测试入口** 入口一：tests/unit_tests/agentserver/memory/test_external_memory_config.py::test_engine_gates_truth_table（117-126）参数化 memory.engine 取 builtin/external/both/none，断言 is_builtin_memory_allowed 与 is_external_memory_allowed 的真值表（builtin→仅内置，none→双双为假）。
  - 入口二：test_external_memory_builder.py::test_provider_raises_returns_none（519-524）令 provider __init__ 抛 RuntimeError，断言 build_external_memory_rail 返回 None，覆盖构造失败的降级分支。所提供测试切片集中于 external 配置与 builder，此处仅陈述断言，不宣称测试现已运行通过。
- 来源：[tests/unit_tests/agentserver/memory/test_external_memory_config.py:L117–L126](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/memory/test_external_memory_config.py#L117-L126),
  - [tests/unit_tests/agentserver/memory/test_external_memory_builder.py:L519–L524](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/memory/test_external_memory_builder.py#L519-L524)
- **run_sweep：executor 扫描，扫描异常或结果为空即 return；仅 succeeded_ids 非空时写 scanned_sessions checkpoint** run_sweep 经 run_in_executor 执行 scan_new_sessions：该阶段抛异常记 '[Sweeper] Scan stage failed' 后 return，sessions 为空也 return。逐 session 抽取成功时给 items 标 source_session_id 并计入 succeeded_ids，异常计入 failed_ids；
  - 仅当 succeeded_ids 非空才把 history_mtime 与 round_count 写入 scanned_sessions。
- 来源：[jiuwenswarm/agents/harness/common/memory/dreaming/sweeper.py:L133–L155](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/dreaming/sweeper.py#L133-L155),
  - [jiuwenswarm/agents/harness/common/memory/dreaming/sweeper.py:L160–L179](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/dreaming/sweeper.py#L160-L179),
  - [jiuwenswarm/agents/harness/common/memory/dreaming/sweeper.py:L206–L219](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/dreaming/sweeper.py#L206-L219)
- **build_external_memory_rail 依赖 openjiuwen 的 ExternalMemoryRail 可导入；导入异常或 provider 为空时返回 None** 该工厂先 `from openjiuwen.harness.rails import ExternalMemoryRail`，导入抛任意异常仅 logger.warning '[ExternalMemoryBuilder] ExternalMemoryRail import failed' 后返回 None；随后 ext_cfg 的 provider 为空同样返回 None，rail 静默不构建。
- 来源：[jiuwenswarm/agents/harness/common/memory/external_memory_builder.py:L30–L49](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/external_memory_builder.py#L30-L49)
- **_search_vector 仅 SQL try 块内异常降级到 _search_vector_fallback；前置 embed_query/建表在 try 之外，异常向上传播** 触发：try 块内（chunks/vec0 SQL）任意异常；守护分支 logger.debug 'Vector search with sqlite-vec failed' 后返回 _search_vector_fallback(query_vec, limit) 的结果。embed_query/_ensure_vector_table 位于 try 之前，异常不降级、向上传播；
  - fallback 中 query_norm<1e-10 返回 []。
- 来源：[jiuwenswarm/agents/harness/common/memory/manager.py:L878–L889](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/manager.py#L878-L889),
  - [jiuwenswarm/agents/harness/common/memory/manager.py:L890–L942](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/manager.py#L890-L942),
  - [jiuwenswarm/agents/harness/common/memory/manager.py:L944–L954](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/manager.py#L944-L954)
- **向量检索把 top-k 排序下推 vec0 SQL，但先全量载入通过 source_filter 的 chunks 行** 设计推断（非作者历史意图）：
- 收益（推断）：距离排序与 LIMIT 由 vec_distance_cosine 的 vec0 SQL 完成，top-k 在扩展内选出；代价（推断）：先用 chunks SELECT 把通过 source_filter 的全部行（含截断 snippet）载入 chunk_map，成本随命中 chunk 数而非 limit 增长。
- 来源：[jiuwenswarm/agents/harness/common/memory/manager.py:L895–L925](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/manager.py#L895-L925)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-depth-memory.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/memory/config.py:L250-L281；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/memory/config.py:L207-L247
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/memory/dreaming/sweeper.py:L51-L71；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/memory/external_memory_builder.py:L37-L47
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/memory/external_memory_builder.py:L49-L58
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/memory/external_memory_builder.py:L82-L85
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/memory/test_external_memory_builder.py:L285-L290
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/memory/test_external_memory_config.py:L117-L126
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/memory/test_external_memory_builder.py:L519-L524；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/memory/dreaming/sweeper.py:L133-L155
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/memory/dreaming/sweeper.py:L160-L179；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/memory/dreaming/sweeper.py:L206-L219
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/memory/external_memory_builder.py:L30-L49；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/memory/manager.py:L878-L889
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/memory/manager.py:L890-L942；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/memory/manager.py:L944-L954
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/memory/manager.py:L895-L925
- 源页字段（feature）：memory
- 入口（entry_points）：jiuwenswarm/agents/harness/common/memory/manager.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/memory/manager.py；jiuwenswarm/agents/harness/common/memory/*
