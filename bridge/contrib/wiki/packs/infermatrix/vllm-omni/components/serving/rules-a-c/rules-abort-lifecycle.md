---
name: rules-abort-lifecycle
description: "规则 SERV-5t：AsyncOmniEngine.abort() / abort_async() 的 acknowledged abort 在 shutdown 边界只忽略已识别的 transport closure（Janus 2.x SyncQueueShutDown、Janus 1.x closed-queue RuntimeError、RPC-result-router-closed），live engine 仍须 rpc_id + ACK，generate() 取消后 request_states 清空（PR #6327）"
metadata:
  scope: 只收 SERV-5t 这一条 acknowledged abort 规则；一般 engine lifecycle、stage shutdown 与 admission 合同归 rules-engine-lifecycle-1、rules-engine-lifecycle-2
---
# Serving acknowledged abort 生命周期规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/serving/rules-abort-lifecycle.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, serving；created: 2026-09-05；updated: 2026-09-05
- 来源（sources）：PR #6327；vllm_omni/engine/async_engine_utils.py；vllm_omni/engine/async_omni_engine.py；vllm_omni/entrypoints/async_omni.py；tests/engine/test_async_omni_engine_abort_ack.py；tests/engine/test_async_omni_engine_input.py；tests/entrypoints/test_async_omni.py
- 置信度（confidence）：high
- 本页收纳 `SERV-5t`；一般 engine lifecycle、stage shutdown 与 admission 合同见 [[rules-engine-lifecycle-1]]、[[rules-engine-lifecycle-2]]（engine 生命周期规则）。
- [SERV-5t] acknowledged abort 在 shutdown 边界只忽略已识别的 transport closure
  - 触发：修改 `AsyncOmniEngine.abort()` / `abort_async()`、`CorrelatedRpcClient`、Janus request queue，或 `AsyncOmni.generate()` 的 cancellation cleanup。
  - 强制：空 request-ID batch 与已经观察到 `_shutdown_called` 的 late abort 是 no-op。live engine 的 `abort_async()` 仍须以 correlated `rpc_id`、blocking request-queue submission 和 orchestrator ACK 完成；不得削弱 queue backpressure 或 caller timeout。
    - 在 initial guard 后发生 race 时，只有再次确认 shutdown 已开始，才可忽略 Janus 2.x `SyncQueueShutDown`、Janus 1.x 精确 closed-queue `RuntimeError`，以及 ACK wait 的精确 RPC-result-router-closed error。成功 ACK 以前 frontend request state 仍保留；shutdown 下 cancellation 仍沿既有 cleanup 收敛并清空 local request state。
  - 验收：覆盖 empty/late no-op、submit-time queue closure 和 ACK-wait router closure 的 shutdown race；分别用 live-engine controls 断言同类 failure 继续 raise，并覆盖 Janus 2.x symbol 缺失时的 legacy exact-message fallback。
    - 取消 `generate()` 后断言 original `CancelledError`、一次 submission、无额外 abort enqueue 与 `request_states == {}`；另保留 ACK success、orchestrator error、timeout 和 request-queue backpressure 的既有回归。PR 的 CPU tests 只证明这些 contract，不证明 hardware reliability 或任意 shutdown transport error 都安全忽略。^[PR #6327]

## 决策与踩坑

- [SERV-5t] 禁止：将所有 `RuntimeError`、live-engine queue/router closure、timeout、unexpected result type 或 orchestrator abort failure 当作 shutdown 成功；以 plain `abort()` 取代 ACK path；在 ACK 前 pop state，或为 cancellation 新增会 orphan live engine request 的无条件 cleanup。
