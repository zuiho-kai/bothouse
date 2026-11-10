---
name: rules-orchestration-loop
description: "Orchestration loop 规则 VLLM-OMNI-PR8675-ORCH-LOOP-DEFAULT（PR #8675）：VLLM_OMNI_EVENT_DRIVEN_ORCH 未设置即默认启用 event-driven stage-output loop（其余值选 legacy 1 ms poll），两条 loop 的读取收敛到 StagePool.read_llm_raw_output，pool 成员变更（add_client、remove_client、mark_replica_unavailable、evict_replica）唤醒 dispatcher 做 reader reconcile、0.5 s tick 作 backstop；证据边界是空闲 CPU 下降"
metadata:
  scope: 只收 vllm_omni/engine/orchestrator.py 的 stage-output loop 默认值、StagePool 读路径与成员变更唤醒一条规则 VLLM-OMNI-PR8675-ORCH-LOOP-DEFAULT；serving-side final-output loop 的唤醒不在本页约束内，stage 并行度与设备容量归 model-executor-rules-3
---
# Model Executor — Orchestration Loop Rules

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/model-executor/rules-orchestration-loop.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, model-executor；created: 2026-10-13；updated: 2026-10-13
- 来源（sources）：PR #8675
- [VLLM-OMNI-PR8675-ORCH-LOOP-DEFAULT] 双 orchestration loop 必须共用同一 StagePool 读路径，成员变更唤醒 dispatcher
  - 触发：修改 `vllm_omni/engine/orchestrator.py` 的 stage-output loop（event-driven 或 legacy 1 ms poll）、`vllm_omni/engine/stage_pool.py` 的读取/成员接口（`add_client`、`remove_client`、`mark_replica_unavailable`、`evict_replica`），或 `VLLM_OMNI_EVENT_DRIVEN_ORCH` 的默认值与解析。
  - 强制：env 未设置即对所有 pipeline 启用 event-driven loop；`1`/`true`/`yes`/`on` 保持启用，其余值（含 `0`/`false`/`no`/`off` 及任何未识别值）选择 legacy poll；值做 strip 与大小写归一化，在 `Orchestrator` 构造时解析，不再有 per-pipeline 默认。
    - 两条 loop 的 stage 输出读取必须收敛到同一 `StagePool.read_llm_raw_output`（原 `_poll_stage_raw`），保证 dict pooling 的 `pooling_output_payload` 等在两条路径上一致 rehydrate。pool 成员变更必须唤醒 dispatcher 以触发 reader reconcile，使运行时新挂载的 replica 无需等 0.5 s tick 才被首次 drain；
    - reconcile 在 dispatcher 内执行，可能排在于途 output-routing await 之后——唤醒是及时的，但不保证即时完成，0.5 s tick 保留作 backstop。serving-side final-output loop 的唤醒独立于该 flag（#8703 之后），本规则只约束 orchestrator stage-output loop。
  - 验收：单测在 env 未设置与 `VLLM_OMNI_EVENT_DRIVEN_ORCH=0` 两种条件下运行；`tests/engine/test_orchestrator.py` 与 `test_orchestrator_error_handling.py` 通过参数化 fixture 覆盖两条 loop；新增读取或成员路径时断言 pooling payload rehydration 在两条 loop 行为一致，且成员变更后 reader 集合最终与 pool 成员一致（允许等待在途 output-routing 完成，不要求瞬时）；
    - 启动日志仍记录所选 loop 模式与 reader/poller 计数。^[PR #8675]

## 决策与踩坑

- [VLLM-OMNI-PR8675-ORCH-LOOP-DEFAULT] 禁止：重新引入 per-pipeline 默认管道（`_event_driven_orch_default_for_pipeline` 或 `event_driven_orch_default` ctor 参数）；在任一 loop 里绕过 pool 读 helper 直接 `client.get_output_async()`；用手工挑选的 parity 清单替代把 orchestrator scenario 测试在两条 loop 上参数化；把成员变更唤醒表述为保证即时 reconcile 的同步语义；
  - 把默认切换表述为吞吐/延迟改善——其证据边界是空闲 CPU 下降，吞吐与延迟预期不变。
