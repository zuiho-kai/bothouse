---
name: rules-engine-lifecycle-2
description: Serving engine 生命周期规则第 2 部分：SERV-5n remote replica attach/detach 按 membership generation、SERV-5o wake 设备同步留在 worker、SERV-5p streaming raw terminal 闭合、SERV-5q VLLM_OMNI_EVENT_DRIVEN_ORCH 双路径，SERV-6a–6f full-duplex prewarm / CFG companion / capability gate / native speed，SERV-8a runtime.env 临时作用域，SERV-9a max_num_seqs 是唯一 diffusion admission width
metadata:
  scope: 只收 SERV-5n–5q、SERV-6a–6f、SERV-8a 与 SERV-9a；SERV-5r 至 SERV-5l 归 rules-engine-lifecycle-1，SERV-6g、6k 归 rules-duplex-orchestration，SERV-6h、6i 归 rules-session-lifecycle，请求到 engine 的边界归 serving-architecture
---
# Serving engine 生命周期规则（2/2）

## 关键事实

- 拆分说明：本页是源页 `rules-engine-lifecycle.md` 的第 2/2 部分；第 1 部分 [[rules-engine-lifecycle-1]]
- 源页：`knowledge/repos/vllm-omni/components/serving/rules-engine-lifecycle.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, serving；created: 2026-09-03；updated: 2026-09-05

### Full-duplex 与 CFG companion 生命周期

- [SERV-5n] remote replica attach/detach 必须按本次 membership generation 判定
  - 触发：修改 `MembershipController` 的 register、watcher snapshot、unregister、shutdown 或 remote client factory。
  - 强制：以 `(stage_id, replica_id)` 分别记录 attaching/attached，重复 register 在 attach 完成前后都只保留一个 client。每次 watcher snapshot 单调递增 generation；controller 创建的地址只有在本次 attach 开始后真实观察到 `UP`，才可因后续消失触发 detach；未跟踪的 static client 继续按相邻 snapshot 的 `UP -> absent` 清理。
    - factory 返回后若 shutdown 已开始，或地址校验/`StagePool.add_client` 失败，必须关闭尚未接管的 client；正常 detach 同步清理 membership bookkeeping、pool client、受影响请求和 client 资源。
  - 已知边界：`asyncio.to_thread` 中正在执行的 factory 不能随外层 task cancellation 一起停止；若 membership task 被直接取消，thread 后来返回的 client 仍可能失去 cleanup owner。该低严重度泄漏在 PR 中明确延期，现有 shutdown/late-result 回归不能证明 cancellation 路径已关闭。
  - 验收：覆盖 register storm、register 前后 stale/fresh `UP`、attach 中 watcher churn、untracked disappearance、invalid stage/address、`add_client` 异常、shutdown-before/during/after factory、detach 后重新注册和受影响 request error；另以专门用例保留或修复上述 cancellation leak。^[PR #5277]
- [SERV-5o] wake 的设备同步只在 device-owning worker 执行
  - 触发：修改 `AsyncOmni` 的 wake RPC、worker `handle_wake_task()`，或为 sleep/wake 增加 platform/CUDA 同步。
  - 强制：`AsyncOmni` 只 dispatch wake RPC、等待 ACK 并更新 frontend 状态；实际 device 同步留在执行 wake 的 worker 路径。这样 proxy 或 HTTP-server-only 的 `AsyncOmni` 不会因 wake bookkeeping 初始化 CUDA context。
  - 验收：用不拥有 CUDA device 的 proxy/frontend 实例经过 diffusion wake RPC，断言 frontend 不创建 CUDA context；另断言 worker `handle_wake_task()` 在返回成功 ACK 前仍完成同步。PR #4092 只声称既有测试通过，未提供可复现命令或该 proxy 回归；其要求 inline guard/comment 的 review thread 在合并时仍未 resolve，故这条验收尚未被该 PR 证明。^[PR #4092]
- [SERV-5p] streaming final stage 的 raw terminal 必须闭合一次 output lifecycle
  - 触发：`async_chunk` streaming/realtime 的 final output stage 收到 raw `finish_reason`，或修改 orchestrator raw/processed poll、terminal routing、request cleanup。
  - 强制：只把非 segment 的 session-level raw terminal 计入 final-output-stage completion；同一 poll 必须先路由 processed outputs。
    - 若所有 final output stages 已完成、仍存在 request state、且没有 processed terminal 完成 cleanup，则使用既有 terminal-empty output helper 发出一个 `finished=True` 的最终 `OutputMessage`，然后走普通 request/CFG-parent cleanup。full-duplex session 不适用这个 fallback。
  - 验收：CPU 覆盖 raw-terminal-only、data-then-raw-terminal、processed-terminal-plus-raw-terminal 三种同 poll 形状，分别断言完成、数据先于 terminal、exactly once 和 request state 清理；Qwen3-Omni Realtime async-chunk 长音频 E2E 断言 `response.audio.done` 到达且音频有效。^[PR #6564]
- [SERV-5q] 事件驱动编排只能改变唤醒机制并保持双路径合同
  - 触发：修改 `VLLM_OMNI_EVENT_DRIVEN_ORCH`、orchestrator output loop、stage reader/poller、或 `AsyncOmni` final-output drain。
  - 强制：默认关闭时保留 legacy 1 ms poll loop；开启时每个 live LLM replica 的 reader 直接 await `get_output_async()`，再进入单一串行 dispatch，使 routing、output ordering、terminal cleanup、scheduler stats 与 per-replica `EngineDeadError` isolation 同 legacy path。
    - reader 必须每 0.5 s 按 live membership 与 client object reconcile，client swap、eviction 或新注册不得遗失输出或留下 task。diffusion 维持 `get_diffusion_output_nowait()` poller，metrics-only sentinel 在 route 前吸收。final-output drain 使用同一 flag 的 queue blocking read，engine 缺少该方法时回退 legacy drain；
    - 1 s timeout 只用于 orchestrator liveness check，shutdown 必须关闭其 executor/queue 资源。
  - 验收：以 flag guard 重跑 legacy LLM/diffusion, async-chunk, abort, shutdown, multi-replica, scheduler-stat 和 dead-replica parity scenarios；
    - 另测 accepted/unrecognized flag values、default legacy selection、client swap 后 reader reconcile、blocking drain 的 queued/late message、timeout/liveness 与 executor shutdown。性能测试另绑定同一 current-head build、硬件、workload、warmup 与多次 A/B；
    - PR #5221 的 H20 数字在 fault-isolation rebuild 前测得，不能作为 current-head performance proof。两条文档 review 要求已进入最终代码，但对应 thread 合并时仍为 unresolved。^[PR #5221] ^[Issue #4855]
- [SERV-6a] full-duplex 首次 stage submit 必须预热 async-chunk topology
  - 触发：full-duplex stage port、双工会话、async-chunk 或 stage fence 发生变化。
  - 强制：stage-0 的首次 `submit_initial` 在 async-chunk 开启时预热后续 stage 的 runtime/pool；每个 stage 保留自己的 fence、submit timestamp 和 request state。
  - 验收：覆盖首次 stage-0 submit、后续 stage submit、重复 update 和 prewarm failure；CPU/mock 测试必须证明 request state 与 stage pool 生命周期一致。
- [SERV-6b] CFG companion 输出要非破坏性聚合并在所有 teardown 路径清理
  - 触发：CFG companion、deferred parent、streaming terminal update、abort、stage error 或 replica loss。
  - 强制：parent re-submit 前 companion outputs 可重复读取；parent 只在全部 companion 完成后释放；companion error/abort 必须给 deferred parent 发送结构化错误，并由统一 cleanup 路径清理 parent、companion、tracker 和 stage-pool binding。
  - 验收：覆盖正常全量完成、重复读取、companion error、parent abort、companion abort 和 replica loss，断言没有遗留 tracker state 或未完成的 deferred parent。
- [SERV-6c] duplex capability gate 必须区分未启用与配置失败
  - 触发：`session_mode=duplex`、`/v1/realtime?duplex=true`、runtime extension 或 duplex deploy configuration 发生变化。
  - 强制：入口只在明确的 duplex opt-in 下建立 handler；能力检查必须保留结构化配置错误与“不支持该模式”的区别，session、request、stage fence、lease 和 ordered mailbox 的生命周期必须在 disconnect、abort、expiry 与 replica loss 时一起终止。
  - 验收：覆盖未 opt-in、有效 opt-in、malformed config、stale fence、lease expiry、disconnect 和 terminal response ordering；控制消息中的 dataclass/enum/tensor 必须在发送前变成 JSON-safe 值。
- 请求到 engine 的边界见 [[serving-architecture]]（Serving architecture）；公开协议通用检查见 review contracts（源链接 `../../../../general/review/guides/reviewer-lens-contracts.md`）。
- [SERV-6d] tokenizer-free 与 native speed 由 adapter capability 闭环
  - 触发：stage 0 跳过 tokenizer，或 TTS adapter 声明 native speed control。
  - 强制：token-only renderer 仅接受 token IDs/prompt embeddings，chat messages 明确失败。HTTP raw、SSE 与 non-streaming 由 adapter 校验 native speed，encoder speed 固定 1；generic model 拒绝 `speed != 1`，WebSocket 在 parity 完成前固定 speed=1。
  - 验收：覆盖 token/chat/embed、native/generic、三种 HTTP 输出与 WebSocket。落后后端只用显式 capability/version shim 并保留 eager fallback，不能让 CUDA 新参数成为全平台前提。^[PR #5957]
- [SERV-6e] async-chunk prewarm 失败必须保持 request-scoped 并停止 duplex bookkeeping
  - 触发：async-chunk duplex 的 stage-0 首次提交需要 downstream prewarm，尤其是缺少 `prompt_token_ids` 或某个 downstream prewarm 提交失败时。
  - 强制：prewarm 失败必须发送 request-scoped、non-fatal 的 `ErrorMessage`（400、`BadRequestError`），完成 abort cleanup 并关闭 duplex session；调用方收到失败结果后立即停止，不得继续写 fence、submit timestamp 或重新注册 running counter。
  - 验收：覆盖缺失 `prompt_token_ids`、downstream submit 失败和 duplex submit fall-through，断言错误只归属目标 request、engine/thread 仍存活、下游未被错误预热，且无 fence、时间戳、counter 或 session 残留。^[PR #6033]
- [SERV-6f] 必需 CFG companion 的构造与 admission 必须原子完成
  - 触发：engine 为 CFG 请求展开 companion，且 guidance 是模型必需能力，或 companion 需要经过 input processor 才能获得完整 Omni request metadata。
  - 强制：先构造并处理全部 companions，再把 parent 和 companions 一起入队；处理后用 `upgrade_to_omni_request` 恢复 `additional_information`/`global_request_id` 等 Omni 字段；任一构造或处理失败都向调用方传播并保持队列无变化，非 CFG expansion 返回空列表并保留普通 admission。
  - 验收：分别模拟 prompt expansion、input processing 和 tokenizer 失败，断言 parent/companion 均未入队；成功路径断言两者 metadata、ID suffix、sampling params 和 pair identity 完整；无 companion 的普通请求仍正常 admission。 ^[PR #6186]
- [SERV-8a] 本地 stage launch 必须临时应用 runtime.env
  - 触发：修改 `StageRuntime` 的本地 LLM/diffusion replica launch、`runtime_cfg.env`、stage device scope 或 launch lock。
  - 强制：本地 LLM launch 必须在现有串行 launch lock 内进入 `stage_runtime_env(stage_id, runtime_cfg)`；diffusion launch 必须将其与 device scope 组合，并保持 `runtime.devices` 作为有效设备选择。scope 只覆盖子进程构造/launch，退出时恢复父进程原值，并删除此前不存在的 key。
  - 验收：CPU/mock 回归分别覆盖 LLM 和 diffusion launch 看到 stage 值、父环境已有值恢复、原先未设置的 key 在异常后被清理，以及 diffusion launch 同时看到 stage device 值；确认 LLM launch lock 仍覆盖进程创建。^[PR #6214]
- [SERV-9a] `max_num_seqs` 是唯一 diffusion admission width
  - 触发：diffusion stage startup、scheduler admission width 或 legacy `diffusion_batch_size` caller。
  - 强制：`max_num_seqs` 是 CLI/YAML 到所有 startup paths 的唯一 admission width；legacy public `diffusion_batch_size` kwarg 必须抛 actionable `TypeError`，不得 alias、drop 或做 precedence merge。
  - 验收：覆盖 inline/multiproc/single-stage 保留 configured width、legacy kwarg loud failure、serial pipeline width>1 init reject，及真正 request-batch pipeline 的 DIFF-6a admission control。^[PR #6484]

## 决策与踩坑

- [SERV-5n] 禁止：让 attach 前的 stale `UP` snapshot 立即删除刚注册 client；并发重复创建同一 replica；shutdown 后继续接受 register 或挂入 late client；把“曾在任意 generation 出现”当作当前 attachment 已确认。
- [SERV-5o] 禁止：在 `AsyncOmni` 的 wake completion 路径重新导入 platform 或调用全局 `synchronize()`；不能以收到 ACK 代替 worker 已完成其设备同步的合同。
- [SERV-5p] 禁止：仅记录 raw completion 而让 Realtime generator 永远等不到 terminal message；在 processed data 前发送 fallback；为普通 segment stop 或非-final stage 合成 terminal；用超时伪造完成，或在已 cleanup 后再发第二个 terminal。
- [SERV-5q] 禁止：把 "event-driven" 外推为所有 stage 均无 polling；从一个 loop 删除 metrics、raw-terminal 或 fault-isolation handling；在 busy queue 下只在 timeout reconcile，或让 reader failure 重启为重复 eviction；把两种 loop 的 orch-monitor iteration counts/`loop_active_pct` 直接比较。
- [SERV-6a] 禁止：等到 duplex audio/control 事件真正抵达才首次启动下游 stage；用一个全局 fence 表示多 stage readiness；prewarm 失败后仍发布 generation-ready。
- [SERV-6b] 禁止：用 destructive `pop` 让第二次 terminal update 丢 companion；只清 parent 不清 companion；companion 永久等待时静默挂起 parent。
- [SERV-6c] 禁止：把所有 config-load exception 折叠成 `duplex unavailable`；用普通 streaming handler 冒充持久 session；用全局 fence 或无界 pending input 替代 per-session bound。
- [SERV-6d] 禁止：模型 duration scaling 后再次 resample，或以 HTTP 支持外推 WebSocket parity。
- [SERV-6e] 禁止：用 `fatal=True` 将单请求输入错误升级为 engine-wide failure；cleanup 已移除 request state 后仍返回成功或继续 duplex bookkeeping；让一个 request 的 prewarm 失败拖垮同批其他请求。
- [SERV-6f] 禁止：先 enqueue parent 再吞掉 companion 异常；只入队一侧、让 companion 丢失 external/global request identity，或在 Scheduler 建立后才安装 CFG pairing gate。
- [SERV-8a] 禁止：只解析或记录 `runtime.env` 却不应用到本地 launch；把 stage 环境永久污染到父进程；用 runtime env scope 替代 diffusion device scope；将该本地 scope 推广到 remote replica 或 headless worker launcher。
- [SERV-9a] 禁止：把 width 当作 pipeline fusion/request-batch support；serial pipeline 在 width>1 时必须 init fail，实际 request batching 仍由 `DIFF-6a` structural compatibility/isolation 证明。删除 YAML comment 不是行为文档。
