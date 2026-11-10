---
name: rules-ipc-errors
description: "Diffusion 规则 DIFF-IPC-1a、DIFF-ERROR-1a：StageDiffusionClient 的 shutdown/abort 用 nonblocking send、add-request/RPC 在 NOBLOCK+POLLOUT 重试中查 subprocess liveness 并抛 EngineDeadError（PR #7812）；UniProcDiffusionExecutor 与 non-step fallback 经 DiffusionOutput.from_exception 保留 OmniClientError 的 4xx status（PR #8474）"
metadata:
  scope: 只收 diffusion stage client 的 ZMQ PUSH 发送/死副本处理与 single-GPU、non-step 路径的 client status 保留两条规则；单 GPU uni executor 的故障 latch（DIFF-11a）与 worker shutdown 升级（DIFF-1aj）归 rules-output-lifecycle-2，request-mode shutdown（DIFF-1h）归 rules-output-lifecycle-1
---
# Diffusion IPC 与客户端错误规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/diffusion/rules-ipc-errors.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, diffusion；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #7812；PR #8474
- 置信度（confidence）：high
- [DIFF-IPC-1a] 无 peer 的 PUSH 发送不得阻塞 orchestrator，abort 必须保持 no-op 语义
  - 触发：修改 StageDiffusionClient 的 shutdown/abort/add-request/collective-RPC 发送与死副本清理。
  - 强制：shutdown 与 abort 使用 nonblocking send；无 peer/已 engine_dead 的 abort 返回，让 poll 路径观察死亡并驱逐副本，不能因 cleanup raise 而杀死整个 orchestrator。add-request/RPC 在 NOBLOCK+POLLOUT 重试中检查实际 subprocess liveness，进程死亡时 raise EngineDeadError；只有成功发送后登记 pending RPC。
  - 验收：dead flag 尚 false 但 subprocess 已退出时，shutdown/abort 有界返回且无异常，add-request/RPC 明确失败；live peer 保持发送；测试实际 return/error 并完整关闭 ZMQ context，避免只断言线程退出而漏掉错误。^[PR #7812]
- [DIFF-ERROR-1a] single-GPU 与 non-step fallback 必须保留 pipeline 的 client status
  - 触发：修改 UniProcDiffusionExecutor.execute_request、non-step runner fallback 或异常输出。
  - 强制：pipeline 异常通过 DiffusionOutput.from_exception 构造，保留 OmniClientError 的 4xx metadata；普通 RuntimeError 保持无 client status 并由上层作为 server error。与 multiprocess direct / stepwise / engine error path 使用同一分类。
  - 验收：single-GPU direct 的 422、non-step fallback 的 400 与 RuntimeError control，断言 status 到达输出/API，executor 仍可接下一请求；CPU/mock 不外推全部模型 GPU admission 路径的正确性。^[PR #8474]
- 共享 teardown 见 [[rules-output-lifecycle-1]]、[[rules-output-lifecycle-2]]（输出生命周期）；公共 HTTP 错误与请求合同见 [[serving-rules-1]]、[[serving-rules-2]]、[[serving-rules-3]]（Serving 规则）。

## 决策与踩坑

- [DIFF-IPC-1a] 禁止：只读 monitor 的 `_engine_dead` flag 后继续 blocking send（进程可在两者之间死亡）；将 abort no-op 改成 raise；把 live-peer backpressure 说成无等待的成功；无 peer 测试只预置 dead flag，或忘了 close socket/context 让 pytest exit 挂住。
- [DIFF-ERROR-1a] 禁止：只保存 str(exc) 使单 GPU 的 400/422 变成 500；因为请求失败就把 executor 标为永久死亡；只检查 error message 而不检查传至 API 的 status。
