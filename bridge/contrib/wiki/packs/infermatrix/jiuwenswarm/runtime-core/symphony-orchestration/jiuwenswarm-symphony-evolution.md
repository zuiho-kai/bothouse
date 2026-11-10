---
name: jiuwenswarm-symphony-evolution
description: Symphony 动态图谱演化（symphony/evolution）：事件与 edge_key 规范化、overlay v3 聚合与 skillgraph_linear_v1 运行时权重精确值、追加式 store、record_plan_outcome 与重建条件、已实现与设计意图的边界
metadata:
  scope: 只收 symphony/evolution 的模型、聚合、存储、服务函数与消费边界；图谱构建归 jiuwenswarm-symphony，服务与经验安装归 jiuwenswarm-symphony-service
---
# Symphony 动态图谱演化（evolution）

## 现状

- 本模块把 Symphony 运行时事件（如计划结果、选中的技能、边的成败和失败归因）追加写入图谱目录下的 evolution 存储。它再把这些事件聚合成动态图谱 overlay，按边、节点、路径统计结果并计算运行时权重，供加载和查询状态使用。
- 相关页面：[[jiuwenswarm-symphony]]（Symphony 编排集成）（图谱构建与服务层）、[[jiuwenswarm-symphony-shared]]（共享工具 shared）、[[jiuwenswarm-runtime]]（Agent 运行时）、[[gateway-channels-rules]]（网关通道规则）（evolution 审批消息的网关侧）。以下细节核对自上游 checkout（commit `f0a69728c96b5961d993449f1a901cbd2f4dac5b`）；标注的测试是源码内已有用例，本页未实际运行。
- 注意区分两套"演化"存储：本页的 `symphony/evolution/`（JSONL 事件 + overlay，JiuwenSwarm 自己聚合）与核心 Flow 引擎的 recipe/技能包存储（`graph_dir` 同级的 `flow/` 目录，经验候选安装走它，见 [[jiuwenswarm-symphony]]（Symphony 编排集成））。
- **从这里读起**
- `jiuwenswarm/symphony/evolution/service.py` — 对外的服务函数：record_plan_outcome 记录计划结果，load_dynamic_overlay / rebuild_dynamic_overlay 加载或重建 overlay，evolution_status 返回演化状态。
- **关键文件**
- `jiuwenswarm/symphony/evolution/aggregate.py` — build_overlay_from_events 把事件聚合成 overlay，逐条累计边、节点、路径的结果并计算 _runtime_weight
- `jiuwenswarm/symphony/evolution/store.py` — 只追加的文件存储：events、overlay、skill packs 各自的路径和读写函数，以及 evolution_store_transaction 事务
- `jiuwenswarm/symphony/evolution/models.py` — 共享的 key 和归一化函数：edge_key、skill_id，以及边、结果（outcome）、失败归因的归一化
- `jiuwenswarm/symphony/evolution/service.py` — 判断 overlay 是否需要重建（按图谱版本和事件时间），给失败的边加标注，并提供默认失败归因

### 事件与键的规范化（models.py）

- Schema 版本：overlay 为 `symphony.dynamic_overlay.v3`，事件为 `symphony.evolution_event.v2`（[models.py:7-8](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/evolution/models.py#L7-L8)）。
- 边主键 `edge_key` 格式为 `{source}->{target}:{relation_type}`（relation 缺省 `can_feed`）；
  - `skill_id` 剥掉 `skill:`/`capability:` 前缀并把下划线归一成连字符，使 `general_writing` 与 `general-writing` 命中同一条目（[models.py:33-43](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/evolution/models.py#L33-L43)）。
- 结果词表收敛到 `success/failure/no_plan/needs_input`：`failed/error/exception/invalid→failure`，`ready/ok/done/passed→success`，未知值一律按 failure 处理（[models.py:93-103](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/evolution/models.py#L93-L103)）。
- 失败归因词表 `all_edges/terminal_edge/explicit/success_only`（别名 `terminal/last_edge/last`、`all/plan/plan_level`、`edge/per_edge`），
  - 未识别时默认 `terminal_edge`（[models.py:106-118](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/evolution/models.py#L106-L118)）。

### 聚合与运行时权重（aggregate.py）

- 只有 `plan.outcome` 事件产生统计；`plan.created` 事件只提供 query 和 selected_skill_ids 上下文，让单技能、无边的成功运行也能进入路径统计（[aggregate.py:51-78](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/evolution/aggregate.py#L51-L78)、
  - [158-172](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/evolution/aggregate.py#L158-L172)）。
- 运行时权重策略 `skillgraph_linear_v1`：`weight = 1.0 + 0.05 × (成功数 − 失败数)`，夹在 `[0.2, 2.0]`；`needs_input` 计数但不改变权重（视为中性证据，[aggregate.py:30-33](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/evolution/aggregate.py#L30-L33)、
  - [391-407](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/evolution/aggregate.py#L391-L407)）。
  - 测试 `test_runtime_weight_uses_symmetric_linear_evidence_and_neutral_missing_input` 固定了精确值：1 成功=1.05、1 失败=0.95、100 成功封顶 2.0、100 失败下限 0.2、20 次 needs_input 仍为 1.0（tests/unit_tests/symphony/test_evolution.py:74）。
- 每条边统计 success/failure/needs_input/attempt 计数、最多 8 条 representative_queries、last_attribution/last_outcome/last_failure_type/last_updated_at；
  - 最终化再算 Laplace 平滑的 `success_rate=(s+1)/(n+2)`、`reliability=(s+1)/(s+f+2)`、`runtime_weight` 和 `confidence_delta`（[aggregate.py:335-353](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/evolution/aggregate.py#L335-L353)）。
- 节点统计对每条有结果的边把两端各计一次；共享中间节点可在同一计划里累计多次，不是按计划对节点去重（[aggregate.py:114-119](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/evolution/aggregate.py#L114-L119)）；
  - 路径统计以 `path:<sha256[:24]>` 为 id，签名输入是排序去重后的技能集合 + 规范化排序的边集合，代表 query 和 example_plan_ids 各封顶 8 条（[aggregate.py:202-268](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/evolution/aggregate.py#L202-L268)）。
- 边级结果解析顺序：边自带 `outcome/status` 优先；无显式结果时，成功事件把边记成功，no_plan 事件跳过边。失败事件按归因策略处理：all_edges 全失败，success_only 全成功，explicit 仅将标记失败的边记失败，terminal_edge 仅末边失败；
  - needs_input 事件使用同样的归因分配，但被归因边计 needs_input，未被归因边计 success（[aggregate.py:410-445](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/evolution/aggregate.py#L410-L445)）。
  - 失败事件默认 `terminal_edge` 下上游边记成功、末端边记失败（测试 `test_evolution_failure_attribution_defaults_to_terminal_edge`，test_evolution.py:241）。

### 只追加存储（store.py）

- 布局固定在图谱根目录 `evolution/` 下：`events.jsonl`（append-only JSONL）、`dynamic_graph_overlay.json`、
  - `skill_packs.json`（schema `symphony.skill_pack_marks.v1`）（[store.py:11-14](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/evolution/store.py#L11-L14)、
  - [122-137](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/evolution/store.py#L122-L137)）。
- 进程内用模块级 `threading.RLock` 串行化"追加 + 去重 + 重建 overlay"整个事务（`evolution_store_transaction`）；overlay 和 skill packs 都走 `.json.tmp` + replace 原子写；
  - `read_events` 跳过坏行、正数 limit 只取尾部，None/非正数读取全部有效事件（[store.py:15-73](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/evolution/store.py#L15-L73)）。

### 服务函数（service.py）

- `load_dynamic_overlay` 的重建条件：无事件则保持现状；
  - overlay 缺失或 schema 不是 v3、事件 count/last_event_at 与日志不一致、或 current.json 提供非空 version 且与 base_graph_version 不一致时重建（[service.py:44-83](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/evolution/service.py#L44-L83)）。
  - 因此换图谱版本不丢学习数据，重建后 `base_graph_version` 更新、计数继续累计（测试 `test_evolution_store_migrates_known_files_and_keeps_learning_across_versions`，test_evolution.py:172）。
- `prepare_evolution_store` 做一次性迁移：旧布局把 evolution 放在 `versions/<v>/evolution/`，现在迁到图谱根 `evolution/`；
  - 只拷贝 `events.jsonl` 和 `dynamic_graph_overlay.json`，且不覆盖已存在的目标、不删旧文件（其余文件如 `session_feedback_state.json` 留在原地）（[service.py:86-105](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/evolution/service.py#L86-L105)）。
- `record_plan_outcome`：归一化 outcome 和边，用 `failed_edges` 给选中边打 `failed=True` 标注；未显式指定归因时默认——失败/需输入且边数 >1 取 `terminal_edge`，单边取 `all_edges`，成功为空串；`detail` 截断到 1000 字符；提供非空 `evidence_id` 时先在该 graph_dir 的整个事件日志中查重（不按 plan_id 分区），命中则返回既有事件并加 `deduplicated: True`，不追加；
  - `rebuild_overlay=True`（默认）在同一事务内同步重建 overlay（[service.py:155-231](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/evolution/service.py#L155-L231)、
  - [262-273](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/evolution/service.py#L262-L273)）。
- `evolution_status` 返回 event_count、last_event_at、overlay_exists/mtime/generated_at、overlay_stats、
  - weight_policy 和 top_edges（按 runtime_weight 降序、再按 attempt_count 降序取前 10 条）（[service.py:128-152](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/evolution/service.py#L128-L152)、
  - [317-335](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/evolution/service.py#L317-L335)）。

### 已实现与设计意图的边界

- 存储、聚合、重建与状态查询已实现且有单测覆盖（tests/unit_tests/symphony/test_evolution.py）。
- 消费侧当前是受限的：`SwarmSymphonyService.graph()` 目前传 `dynamic_overlay=None`（[service.py:383](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/symphony/service.py#L383)），`_graph_with_runtime_weights` 已能把 overlay 的 runtime_weight 合入 Web 图谱边，
  - 但规划路径明确不加载这份 overlay——测试 `test_core_graph_plan_does_not_load_legacy_overlay` 把 `load_dynamic_overlay` patch 成失败来锁定该约束（tests/unit_tests/symphony/test_experience_flow.py:1702）。改动若让 plan 读取该 overlay 会直接打破既有契约。
- 这些存储 helper 的存在不能单独证明生产计划器实际消费 legacy overlay；生产接线需沿调用方确认，并与核心 Flow 的 recipe/SkillPack 链路分别核对。

### 怎样验证

- `tests/unit_tests/symphony/test_evolution.py` — 权重精确值、路径聚合、迁移与跨版本学习、terminal_edge 归因、status 读取。
- `tests/unit_tests/symphony/test_experience_flow.py::test_core_graph_plan_does_not_load_legacy_overlay` — plan 不读 legacy overlay 的回归门。
- **路由**
- `jiuwenswarm/symphony/evolution/`

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/symphony-orchestration/jiuwenswarm-symphony-evolution.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-09-30；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/symphony/evolution/models.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/symphony/evolution/aggregate.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/symphony/evolution/store.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/symphony/evolution/service.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/symphony/test_evolution.py
