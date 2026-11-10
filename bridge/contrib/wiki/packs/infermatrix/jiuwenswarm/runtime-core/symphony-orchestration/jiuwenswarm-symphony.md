---
name: jiuwenswarm-symphony
description: jiuwenswarm/symphony 集成源码级细节：入口与关键文件、SymphonyGraphBuilder.build 七步顺序与 checkpoint/取消语义、current.json 版本化存储、graph_state.json 增量状态、指纹适配与失效策略、验证测试与改动路由
metadata:
  scope: 只收图谱构建、版本存储、增量状态与指纹适配；服务、规划与经验候选安装归 jiuwenswarm-symphony-service，动态演化归 jiuwenswarm-symphony-evolution，共享工具归 jiuwenswarm-symphony-shared
---
# Symphony 编排集成（jiuwenswarm/symphony）

## 现状

- 把公开的 openjiuwen.symphony 编排 API 接入 JiuwenSwarm。模块负责进程内的 Symphony 服务、能力图谱的构建与版本化存储、能力指纹、执行经验的演进和候选安装，以及基于 Skill 分类体系（taxonomy）的索引构建。
- 相关页面：[[jiuwenswarm-symphony-evolution]]（动态图谱演化 evolution）、[[jiuwenswarm-symphony-shared]]（共享工具 shared）、[[jiuwenswarm-runtime]]（Agent 运行时）（消费演化 rail）、[[jiuwenswarm-architecture]]（JiuwenSwarm 总体架构）。以下细节全部核对自上游 checkout（commit `f0a69728c96b5961d993449f1a901cbd2f4dac5b`）；标注的测试是源码内已有用例，本页未实际运行。
- **入口**
- `jiuwenswarm/symphony/service.py` — SwarmSymphonyService 和 get_swarm_symphony_service：进程内唯一的服务对象。负责图谱状态、刷新、取消构建，也负责 plan、经验候选的列出、请求和安装
- `jiuwenswarm/symphony/build.py` — SymphonyGraphBuilder、build_graph 和 graph_status：图谱构建流程，包括扫描、指纹、checkpoint 和产物发布
- `jiuwenswarm/symphony/config.py` — load_symphony_config 和 SymphonyConfig：Symphony 运行时配置的入口，含路径、指纹、构建、演进和编排模式
- `jiuwenswarm/symphony/skill_retrieval/runtime.py` — SkillTaxonomyRuntime：Skill 分类索引的 build/status/cancel 接口，是公开 taxonomy SDK 的一层薄适配
- **关键文件**
- `jiuwenswarm/symphony/adapter.py` — 把 Swarm 配置转换成公开 Symphony API 需要的能力提供者、指纹 LLM 适配器和 orchestration/graph 配置
- `jiuwenswarm/symphony/graph_state.py` — GraphState 和 GraphStateBuilder：持久化能力哈希，用来做增量构建
- `jiuwenswarm/symphony/graph_storage.py` — 图谱产物的版本化目录、manifest 指针、发布逻辑，以及查找未完成的构建
- `jiuwenswarm/symphony/experience.py` — 执行轨迹的截断兼容处理、图谱演进 rail、submit_evolution，以及已发布能力的快照
- `jiuwenswarm/symphony/llm.py` — LLMConfig、按请求绑定模型、token 用量统计，以及 JiuwenSwarmChatClient 的 JSON 补全
- `jiuwenswarm/symphony/config.py` — 各子配置的解析和取值约束，以及 symphony/evolution 开关的判定

### 图谱构建的顺序与检查点

- [`SymphonyGraphBuilder.build`](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/build.py#L263-L535) 的实际顺序：
  1. `reset_llm_token_usage()` 清零 token 统计，生成 run_id（UTC 时间戳 `YYYYmmddHHMMSS` + `-` + uuid4 hex 前 12 位，[build.py:707-709](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/build.py#L707-L709)）。
  2. 在 `graph_dir/.build_runs/<run_id>/checkpoint.json` 写 checkpoint：schema `Symphony-build-checkpoint-v1`，先写 `.json.tmp` 再 `os.replace` 原子落盘，
     - 跨记录保留 `started_at`（[build.py:675-704](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/build.py#L675-L704)）。阶段序列为 `update.start → fingerprint.start → fingerprint.done → graph.start → graph.done → publish.start → publish.done`。
  3. `resume=True` 时用 `latest_incomplete_build` 先按 `updated_at` 找最新 checkpoint，仅当该条状态为 `running` 或 `failed` 时才作为恢复入口；
     - 不会跳过最新终态而回退到更旧失败记录（[graph_storage.py:124-149](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/graph_storage.py#L124-L149)）；**已取消（cancelled）的构建不可恢复**。
  4. 扫描 Skill 目录 → `GraphStateBuilder.capability_hashes` → 与旧 `graph_state.json` 的 active 条目 diff 出 added/changed/removed。
  5. `FingerprintService.build(force, progress_callback)` 产出指纹 artifact，先写入 `.build_runs/<run_id>/artifacts/` 作为未发布快照。
  6. `prepare_artifact` 回调在版本目录已完成、`current.json` 尚未切换之前执行：把指纹 artifact 复制进版本目录、写 `llm_token_usage.json`、写新 `graph_state.json`（[build.py:419-475](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/build.py#L419-L475)）。
  7. 发布成功后 best-effort 删除 `.build_runs/<run_id>/artifacts/`（OSError 只打 warning，[build.py:660-672](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/build.py#L660-L672)）。
- 取消语义：模块级 `build_graph` 捕获 `asyncio.CancelledError` 后调用 `cancel_active_checkpoint()`（仅把 status 为 `running` 的 checkpoint 改为 `cancelled`）再重新抛出（[build.py:537-608](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/build.py#L537-L608)）。
  - 取消把 checkpoint 阶段标记为 `update.cancelled`；当它是最新 checkpoint 时，`latest_incomplete_build` 返回 None，但已发布版本与指纹缓存保留（测试 `test_cancelled_build_marks_checkpoint_and_is_not_resumable`，tests/unit_tests/symphony/test_direct_service.py:2202）。
- `GraphStatus` 字段：exists/stale/skill_count/added_count/changed_count/removed_count/resume_available/checkpoint_dir/detail，detail 取值 `graph is fresh` / `Symphony graph is missing` / `Symphony graph is stale`；
  - `GraphBuildResult` 额外带 reused/extracted/removed/edge/diagnostics/relation_reused/relation_resolved 计数和 `version`（[build.py:62-121](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/build.py#L62-L121)）。

### 版本化存储布局

- 目录约定（[graph_storage.py:11-13](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/graph_storage.py#L11-L13)）：`current.json` 指针（schema `1.0`）、`versions/<version>/` 产物、`.build_runs/<run_id>/` 检查点。
  - `publish_artifact_dir` 用 `os.replace` 把构建产物移入 `versions/<version>`（版本已存在抛 `FileExistsError`），再原子写指针（[graph_storage.py:94-121](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/graph_storage.py#L94-L121)）。
  - 指针解析 `resolve_graph_artifact_dir` 拒绝逃逸出 graph_dir 的路径（`ValueError`），没有 `current.json` 时回退读 graph_dir 本身以兼容旧布局（[graph_storage.py:41-60](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/graph_storage.py#L41-L60)）；
  - 但 `graph_exists` 要求指针存在、schema 以 `1.` 开头且 `graph.json` 存在，旧布局不算"已存在"（[graph_storage.py:69-79](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/graph_storage.py#L69-L79)）。

### 增量状态 graph_state.json

- 条目按 capability `metadata["entrypoint"]` 的父目录作为 relative_path 主键；entrypoint 缺失直接 `ValueError`（[graph_state.py:160-167](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/graph_state.py#L160-L167)）。
- `content_hash` 是核心扫描器的完整资产哈希（不是只哈 SKILL.md）；读取旧文件时兼容 v1 的 `skill_md_sha256` 键做一次性迁移（[graph_state.py:44-51](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/graph_state.py#L44-L51)）。
- `fingerprint_hash = sha256(fingerprint.graph_identity_dict())`；`graph_identity_dict` 排除 documentation 等非图谱质量扩展，仅改变这些指纹扩展不改变 fingerprint_hash；Skill 资产变更仍可改变 content_hash 与构建新鲜度（测试 `test_graph_identity_hash_excludes_non_graph_quality_extensions`，tests/unit_tests/symphony/test_graph_state.py:70）。
- 移除的 Skill 保留 tombstone：`status="removed"` 并沿用旧 content/fingerprint hash；只有 `status=="active"` 的条目参与增量 diff（[graph_state.py:61-66](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/graph_state.py#L61-L66)、
  - [137-148](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/graph_state.py#L137-L148)）。
- 新状态写在版本目录里（`prepare_artifact` 内），作为版本产物准备完成后，由核心发布流程切换 current 指针。

### 指纹适配与失效策略

- `FingerprintLLMAdapter.invoke` 在调用模型前删掉 `max_tokens` kwarg：思考模型可能先输出推理 token，删除此固定输出上限以避免推理 token 占用预算后截断结构化输出；模型本身的输出限制仍由模型配置负责（[adapter.py:70-81](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/adapter.py#L70-L81)）。
  - 旧上限策略用策略版本 `no-symphony-output-cap-v1` 混入 `configuration_signature`，
  - 使旧指纹缓存整体失效（[adapter.py:23](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/adapter.py#L23)、[84-88](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/adapter.py#L84-L88)）。
- `fingerprint_settings_from_swarm`：`enable_llm_extraction` 当且仅当传入 llm_config；`enable_llm_evaluation` 恒为 False；`extraction.workers → max_concurrency`、`batch_size → batch_size`、`body_limit` 缺省回退核心默认；
  - `cache_enabled=True`（[adapter.py:91-122](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/adapter.py#L91-L122)）。
- 构建期与规划期使用不同关系阈值：`graph_build_orchestration_config_from_swarm` 用 `build.min_edge_confidence`，规划用 `orchestration.min_edge_confidence`（[adapter.py:155-167](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/adapter.py#L155-L167)）。
- 图谱身份快照 schema `JiuwenSwarm-symphony-graph-source-v2`，含 capabilities_sha256、排序后的 current_hashes、fingerprint_schema_version、fingerprint_source_snapshot（去掉 captured_at）、fingerprint_sha256、fingerprint_config_sha256、graph_config、
  - llm_sha256（[build.py:712-736](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/build.py#L712-L736)）；stale 判定最终委托核心 `orchestration.status(expected_snapshot).fresh`。
- 复用计数是源级推断：仅当未 force 且已发布指纹签名与当前一致时才计 reused（[build.py:789-810](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/build.py#L789-L810)）。

### Symphony 服务、规划与经验候选安装

- 该工作流的职责、顺序、错误边界与源码入口见[[jiuwenswarm-symphony-service]]（Symphony 服务、规划与经验候选安装）。

### 怎样验证

- 本页未运行任何测试；以下选择器来自源码内既有用例（需在真实 checkout 中执行）：
  - `tests/unit_tests/symphony/test_graph_state.py` — 增量状态、legacy 哈希迁移、graph_identity 排除文档扩展、removed tombstone。
  - `tests/unit_tests/symphony/test_fingerprint_adapter.py` — 指纹 artifact 消费、settings 映射、max_tokens 删除、二次构建复用（`test_swarm_graph_build_consumes_canonical_core_artifact`）。
  - `tests/unit_tests/symphony/test_direct_service.py` — 服务层取消/守卫/缓存/孤儿日志修复（`test_cancel_build_aborts_blocked_progress_and_releases_guard`、`test_graph_status_repairs_interrupted_build_log` 等）。
  - `tests/unit_tests/symphony/test_experience_flow.py` — 候选推送幂等、安装 receipt 重放、演化开关门禁。
- **改动路由**
- `jiuwenswarm/symphony/adapter.py`
- `jiuwenswarm/symphony/build.py`
- `jiuwenswarm/symphony/config.py`
- `jiuwenswarm/symphony/experience.py`
- `jiuwenswarm/symphony/graph_state.py`
- `jiuwenswarm/symphony/graph_storage.py`
- `jiuwenswarm/symphony/llm.py`
- `jiuwenswarm/symphony/service.py`
- `jiuwenswarm/symphony/skill_retrieval/`

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/symphony-orchestration/jiuwenswarm-symphony.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-09-30；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/symphony/build.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/symphony/adapter.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/symphony/graph_state.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/symphony/graph_storage.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/symphony/service.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/symphony/config.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/symphony/skill_retrieval/runtime.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/symphony/test_graph_state.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/symphony/test_fingerprint_adapter.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/symphony/test_direct_service.py
