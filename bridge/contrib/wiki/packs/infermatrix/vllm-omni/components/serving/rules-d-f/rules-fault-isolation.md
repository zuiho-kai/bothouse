---
name: rules-fault-isolation
description: "Serving replica fault-isolation 规则：SERV-5f stage death 按 replica 隔离——EngineDeadError 在单 replica 边界驱逐、StageUnavailableError 转 request 级 5xx、带 request_id 的 fatal ErrorMessage 仍是 request-scoped、check_health 全灭时 readiness 503（PR #4583、#6170）；SERV-5u 异步 video job 等 scheduler 准入才标 in_progress，DELETE 先有界 abort engine（VLLM_OMNI_ABORT_TIMEOUT，PR #6759）"
metadata:
  scope: 只收 SERV-5f 与 SERV-5u 两条故障隔离与 cleanup 规则；remote membership attach/detach（SERV-5n）归 rules-engine-lifecycle-2，acknowledged abort 的 shutdown race（SERV-5t）归 rules-abort-lifecycle，故障注入测试的评审规则归 rules-dfx-reliability
---
# Serving replica fault-isolation 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/serving/rules-fault-isolation.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, serving；created: 2026-09-02；updated: 2026-09-22
- 来源（sources）：PR #4583；PR #6170；vllm_omni/engine/orchestrator.py；vllm_omni/engine/stage_pool.py；vllm_omni/entrypoints/async_omni.py；vllm_omni/entrypoints/omni_base.py；tests/dfx/reliability/test_reliability_qwen3_omni.py；tests/engine/test_orchestrator_error_handling.py
  - tests/entrypoints/test_omni_entrypoints.py；PR #6759
- 置信度（confidence）：high
- [SERV-5f] stage death 按 replica 隔离，request fatal 不等于 process fatal
  - 触发：stage poll/submit 抵达 `EngineDeadError`、replica 集合变化、dispatch timeout、`/health`、`errored`/`is_running`、request error queue 或 external restart policy。
  - 强制：LLM 和 diffusion poll 均在单 replica 边界捕获 `EngineDeadError`，先 shutdown client 再将 pool slot 置 `None`，使 live set 不再 poll/dispatch 到它，而 orchestrator loop 继续。若同 stage 仍有非 `None` slot，只失败绑定到死 replica 的 request；若一个也不剩，失败 `stage_submit_ts` 显示曾进入该 stage 的所有 active request。
    - 该标记/绑定只在整请求 cleanup 清除，所以 last-replica 边界是 routed-through history，不是已证明精确的 current in-flight 集合；已完成上游 stage 但仍 active 的请求需单独回归。
  - 强制：所有可达 dispatch 边界（stage-0 add、streaming update、归属 parent 的 CFG companion、按每个真实 downstream stage id 处理的 async-chunk prewarm、inter-stage forward）用 thunk 包起选 replica 和 await，使同步 setup 与异步 submit 都在 guard 内。`StageUnavailableError` 只表示空 live set、被驱逐 slot 或 dispatch timeout，转为该 request 的 5xx；
    - 不相关 `RuntimeError` 继续 fail fast。submit 中遇 `EngineDeadError` 须立即驱逐绑定 replica，不能等 poll。
  - 强制：带 `request_id` 的 `ErrorMessage(fatal=True)` 仍是 request-scoped，AsyncOmni 送到对应 queue 后继续 output loop；只有不带 request id 的 fatal error 才是 engine-wide teardown。失败 request 统一经 `_cleanup_request_ids(..., abort=True)` 释放 running counter、PD/CFG state 和全部 pool bindings，并 abort 存活 stage 上的剩余工作；
    - clients traversal 跳过 `None` hole。
  - 强制：`errored` 和 `is_running` 只反映 orchestrator process/thread。`check_health` 对每个非空 pool 主动调 client health（包括 diffusion `proc.is_alive()`）；至少一个被证明存活时 stage healthy，全灭时 readiness 503 但 API process 仍可应答。`None`、无 callable health 或 health 抛 `EngineDeadError` 都计 dead；
    - `len(pool.clients)==0` 的 zero-slot pool 不计 dead。poll handler 的 survivor 判定只看非 `None` slot，与 readiness 的主动探测不是原子快照；多 replica 近同时死亡会随各 poll 驱逐而逐步收敛。
  - 验收：CPU/mock 覆盖 LLM/diffusion poll death、两 replica 中一个驱逐后另一请求保留、last-replica、每个 dispatch 竞态/归属、统一 cleanup 和不相关异常不被吞；再增加 “已完成上游 stage 后该 stage 最后 replica 死亡”回归。硬件需真正启动多 replica，杀一个后证明 health 200 且 survivor 可服务，再杀最后一个证明 503 但端口可达。
    - target unit 的多 replica/stage 是 fake clients，且未直接用一死一活组合调 `check_health`；review 另报告单一 H20 两 replica stage-1 SIGKILL 后 health 200 与 voice-clone request 成功。提交内新增的 OOM survival assertion 只证明请求得到 5xx，且 `/health` 在 15 秒内持续可达并返回 200 或 503；last-replica 后精确 503 来自 PR 报告的硬件运行，不是该断言的强制条件。^[PR #4583]
  - 边界：驱逐不 respawn，暂态压力消失后不恢复 capacity，recovery test 仍 skip；由外部编排决定 restart。collective RPC 的目标迭代已读 live pools，但 sleep/wake 的 ACK 计数、comprehension/diffusion metadata 查找和 PD bootstrap metadata 仍读 init-time `stage_clients`，动态成员语义需另行收敛。本 pin 没有新增与 readiness 分开的 liveness endpoint 或部署文档。^[PR #4583]
  - duplex inter-stage `process_engine_inputs` 失败同样只能成为目标 request 的结构化 stage error：发送 error 后以 abort/close-duplex-session cleanup 回收该 request；普通非-duplex 路径继续抛出，不能扩大 catch 范围而吞没共享 orchestrator 的编程错误。验收要证明坏 duplex handoff 不终止 orchestrator，且同一 engine 的后续 request 仍可完成。^[PR #6170]
- [SERV-5u] 异步 video job 必须等 scheduler 准入才标 in_progress，DELETE 须先有界 abort engine
  - 触发：修改 `POST /v1/videos` 异步 job 状态机、`DELETE /v1/videos/{id}`，或 diffusion `emit_request_lifecycle` / request-started 控制面事件。
  - 强制：job 保持 `queued`，直到 scheduler 首次准入并经 opt-in lifecycle marker 通知；不得在 background task 启动时就标 `in_progress`。DELETE 先对 engine request 做有界 abort（`VLLM_OMNI_ABORT_TIMEOUT`，默认 2s），再取消 frontend task，并再等一小段 cleanup 以免 orchestrator 卡住；abort 后重读 job，使并发完成的 artifact 仍被删除。
  - 验收：queued-until-admission、in-progress DELETE abort、abort timeout、完成后 DELETE 清 artifact，以及 `generate()` cancel 的有界 cleanup。^[PR #6759]

## 决策与踩坑

- [SERV-5f] 禁止：把 readiness 503 解释为 process 已死；把同一 endpoint 当 liveness restart probe 无条件重启；捕获所有 `RuntimeError`；只 pop request state 而遗留计数器、CFG/PD 或其他 pool binding；用 init-time `engine.stage_clients` snapshot 代替动态 live pool。
- [SERV-5u] 禁止：只取消 asyncio task 而留下 engine 侧扩散；把 task 启动当作已开始推理；让 DELETE 在 abort 上无限挂起。
