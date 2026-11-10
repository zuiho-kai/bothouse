---
name: jiuwenswarm-symphony-service
description: Symphony 服务、规划与经验候选安装：SwarmSymphonyService 构建互斥与取消、runtime 缓存键、plan 契约、候选请求 id 与 install_candidate 守卫顺序、evolution.flow.enabled 门禁、SkillTaxonomyRuntime 适配
metadata:
  scope: 只收进程内服务、规划、经验候选安装与 skill_retrieval 适配；图谱构建与版本产物归 jiuwenswarm-symphony，演化存储归 jiuwenswarm-symphony-evolution
---
# Symphony 服务、规划与经验候选安装

## 现状

### 职责和边界

- 说明进程内服务的构建互斥、规划 runtime、经验候选审批安装和 Skill taxonomy 适配；图谱构建与版本产物由 Symphony 主页面说明。

### 进程内服务（SwarmSymphonyService）

- 单例由 `get_swarm_symphony_service()` 提供；`set_swarm_symphony_service` 仅供测试/受控嵌入（[service.py:1131-1145](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/service.py#L1131-L1145)）。
- `_build_guard`（asyncio.Lock）保证进程内只有一个活跃构建；并发触发返回 `{"reason": "graph_preparing", "retryable": False, "build_status": "running"}`（[service.py:516-532](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/service.py#L516-L532)）。
  - `start_refresh_graph` 复用仍在运行的后台任务（task 名 `symphony-graph-build`）；
  - `cancel_build` 先记录 `update.cancel_requested` 再 `task.cancel("skills.graph.cancel")` 并等待退出，无活跃任务时返回 `build_status: "idle"`（[service.py:323-360](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/service.py#L323-L360)）。
- 构建前先 `probe_model_connection` 探活主模型，失败返回业务 payload「主模型连接测试未通过」并带 `failure_stage=model.probe`，不进入构建（[service.py:551-576](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/service.py#L551-L576)）。
- 存在已发布图谱时，取消后的刷新不会被下一个普通任务隐式重建：`_graph_needs_build` 看到 `build_progress.status == "cancelled"` 返回 False，继续用最后一次原子发布的图谱；若图谱根本不存在仍需构建（[service.py:1148-1165](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/service.py#L1148-L1165)）；
  - 测试 `test_cancelled_graph_build_keeps_the_last_published_graph_for_planning`（test_direct_service.py:2265）。
- `graph_status()` 故意传 `llm_config=None`：新鲜度跟随构建图谱时的模型身份，当前默认模型变化只影响在线规划、不应让已发布图谱变 stale（[service.py:239-243](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/service.py#L239-L243)）。
- 孤儿日志修复：无活跃任务但 `build_log.jsonl` 末态是 running 时，补写 `update.cancelled` 且 `reason="process_interrupted"`（[service.py:1481-1492](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/service.py#L1481-L1492)）。
- 运行时缓存键为 `(graph_dir, mode, top_k, max_depth, min_edge_confidence, evolution_flow_enabled, llm签名)`；
  - 已持有 Flow store 的运行时即使配置变化也不替换（Flow 存储单进程独占），带 `llm_config` 的 plan 使用临时运行时并在结束后关闭（[service.py:636-702](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/service.py#L636-L702)）；
  - 测试 `test_runtime_cache_rebuilds_when_default_llm_changes`（test_direct_service.py:1542）。
- `plan()` 契约：空 query 直接失败；mode 只接受 `fast`/`beam`（config `_orchestration_mode`，[config.py:301-307](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/config.py#L301-L307)）；语言 `zh→cn`；返回 payload 必须含 dict 型 `planned_graph`；
  - 规划前经 `load_execution_disabled_skills()` 过滤禁用技能（[service.py:390-501](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/service.py#L390-L501)）。
- Web 图谱载荷 `_web_graph_payload` 把节点 id 改写为 `skill:<id>`/`capability:<id>` 前缀，过滤执行禁用技能及其边，
  - 并从工作区 skills 目录扫描 SkillPack 附加 `pack:<id>` 节点和 `contains` 边（[service.py:1168-1324](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/service.py#L1168-L1324)）。

### 经验候选与安装

- 候选请求 id 稳定：`symphony_experience_ + sha256("recipe_id:version")[:20]`（[service.py:80-84](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/service.py#L80-L84)）。
  - 候选推送是 `chat.ask_user_question` 事件，`evolution_meta` 标注 `approval_kind=install`；
  - 常规非 force 调用对同一 (recipe_id, version) 在进程内成功推送后去重，defer 后由 `release_candidate` 释放、可在后续成功任务再次出现（[service.py:821-874](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/service.py#L821-L874)）。
- 启动恢复出的候选不在取消/部分成功的运行里弹出，要等一次成功任务提供会话上下文（[service.py:769-780](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/service.py#L769-L780)）。
- `install_candidate` 的守卫顺序：request_id 校验 → evolution 开关门 → 安装锁 → 内存/磁盘 install receipt 重放（`flow_root/install_receipts/<request_id>.json`，已安装则幂等重放并 acknowledge，不重复拷贝）→ `review_and_prepare_install` verdict 必须 approved → 客户端提供的非空 package_id/integrity 必须与服务端一致（两者可省略，服务端仍校验实际包） →
  - `CapabilityPackager.verify_package_integrity` → artifact 目录必须解析为 `flow_root/packages/<package_id>/skill` 且不是符号链接 → 优先 `recover_symphony_skill_install`（崩溃恢复），否则 `install_symphony_skill_artifact`；
  - receipt 仅在安装成功后用 mkstemp+fsync+os.replace 原子写入（[service.py:937-1062](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/service.py#L937-L1062)）。
  - 关键测试：`test_install_requires_approved_server_artifact`、`test_receipt_write_crash_recovers_installed_skill_after_restart`（tests/unit_tests/symphony/test_experience_flow.py:1274、1340）。
- 演化激活判定 `evolution_flow_enabled`：优先 `evolution.flow.enabled`，缺省回退旧键 `evolution.enabled`（[config.py:84-91](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/config.py#L84-L91)、
  - [136-138](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/config.py#L136-L138)）；
  - flow 关闭时 list 返回 `enabled: False`，request/install 返回 `flow_disabled`（测试 `test_evolution_disabled_gates_flow_service_operations`，test_experience_flow.py:1751）。

### Skill 检索索引（skill_retrieval/runtime.py）

- `SkillTaxonomyRuntime` 是 `openjiuwen.symphony.agent.AgenticSkillRetrievalToolkit` 的薄适配（[runtime.py:30-88](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/skill_retrieval/runtime.py#L30-L88)）：
  - `start_build` 在空库存时直接拒绝（error code `empty_inventory`），不启动 worker，避免破坏既有可用索引；构建配置按 `SkillIndexBuildConfig` 字段白名单过滤并强制 `preserve_previous_index_on_failure=True`（失败的刷新不得毁掉上一个可用 taxonomy）。
  - LLM 配置取 `symphony.skill_retrieval.llm`，缺项回退默认模型；读取默认模型抛 RuntimeError/ValueError 时退回空 `SwarmLLMConfig()`，再转换为核心 LLM 配置；
    - 此适配层本身不实现 taxonomy 兜底算法（[runtime.py:127-154](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/skill_retrieval/runtime.py#L127-L154)）。

### 怎样验证

- 源码链接固定在 f0a69728c96b5961d993449f1a901cbd2f4dac5b。聚焦单测选择器和验证范围见[[jiuwenswarm-symphony]]（原模块页面；源锚点 #怎样验证）；单元契约不能替代真实服务、模型端点或跨平台集成验证。

### 相关文档

- [[jiuwenswarm-symphony]]（原模块架构与入口）
- [[jiuwenswarm-symphony-evolution]]（相邻模块）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/symphony-orchestration/jiuwenswarm-symphony-service.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/symphony/config.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/symphony/service.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/symphony/skill_retrieval/runtime.py
