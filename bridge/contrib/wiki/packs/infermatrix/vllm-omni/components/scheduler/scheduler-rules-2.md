---
name: scheduler-rules-2
description: Scheduler 规则第 2 部分：SCHED-4a/4b side-stream 复制与 pinned 分配，SCHED-5a logprobs 校验，SCHED-5b–5i async-chunk 容量、stage-0 KV transfer 标记、CFG companion、pooling decoder、KV extraction wait、VLLM_OMNI_INPUT_WAIT_TIMEOUT_S、consumed chunk 失败，SCHED-6a–6f stale drain、full-payload admission、prompt replacement、segment watermark
metadata:
  scope: 只收 SCHED-4a 至 SCHED-6f（不含 SCHED-5g）；快速入口表与 SCHED-1a、1b、2a、3a 归 scheduler-rules-1，SCHED-5g 归 rules-release-queues，机制说明归 scheduler-architecture
---
# Scheduler 规则（2/2）

## 关键事实

- 拆分说明：本页是源页 `rules.md` 的第 2/2 部分；第 1 部分 [[scheduler-rules-1]]
- 源页：`knowledge/repos/vllm-omni/components/scheduler/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, scheduler；created: 2026-07-16；updated: 2026-10-06
- [SCHED-4a] side-stream 复制必须拥有源 buffer 的完成期
  - 触发：prefix-cache 异步写、side-stream D2H、persistent GPU buffer 或下一 step 会重写的 `slot_mapping`/hidden/mm tensor。
  - 强制：源 tensor 在 copy event 完成前保持有效且不可被重写；使用显式 stream ordering、retain/`record_stream` 或消费屏障。drain/early-return 也必须完成或转移生命周期责任。单 pending-write 流水线中 event 未 ready 时 drain 必须不触碰 cache；ready 后恰好消费一次；调度第 N+1 次 write 前必须先消费第 N 次，不能覆盖 pending state。
  - 验收：连续两 step 写入不同 sentinel，在人为延迟 side stream 下证明第一轮 CPU 结果不被第二轮覆盖；强制 event query false→true，断言 0→1→0 次 drain，并验证未显式 drain 时下一次 schedule 仍先落盘上一轮。 ^[PR #4106] ^[PR #5310]
- [SCHED-4b] pinned CPU 分配必须先判断 CUDA 能力
  - 触发：CPU-only 测试、CUDA 不可用环境或异步 copy 可降级路径。
  - 强制：根据 CUDA availability 选择 pinned/non-pinned allocation，再决定是否启用异步。
  - 验收：CPU-only 环境能构造并走同步 fallback；CUDA 环境仍使用 pinned + async，两个分支产生相同内容。 ^[PR #4106]
- [SCHED-5a] sampled-token logprobs 先校验再修改 request
  - 触发：AR scheduler 消费 model-runner sampled tokens 和 `num_logprobs`，尤其是 spec-decode 或 batched output slicing。
  - 强制：按 request 切出 logprob rows，校验二维 shape、行数、第一 token 对齐和有限值；失败只将当前 request 置为 `FINISHED_ERROR`，不能先 append token 或污染同批 request。stop/EOS 截断后再按最终 emitted token 数重新 slice。
  - 验收：覆盖 missing、wrong shape/count、token misalignment、NaN、spec-decode trim 和同批健康 request 继续完成。
- [SCHED-5b] stateful async-chunk request 必须占用调度容量
  - 触发：模型在等待下一 chunk 时保留 runner state，或 full-payload connector 负责把下一段重新送入 generation stage。
  - 强制：`retains_state_across_chunks` 为真时，把 connector 中等待 chunk 的 request 计入 `max_num_seqs`；full-payload consumer 在 chunk 到达时重新进入 waiting queue，不要被 base scheduler 提前停放。
  - 验收：mixed batch 覆盖等待 chunk 的容量上限、full-payload requeue、normal finish 的 receiver cleanup 和 abort/replica-loss cleanup。
- [SCHED-5c] stage-0 final request 的 KV transfer 例外必须显式标记
  - 触发：stage-0 的 text/final 输出通常不需要下游 KV，但 CFG companion 或其他终端 payload 仍需要复用该 cache。
  - 强制：用 `omni_force_kv_transfer` 等 request metadata 明确覆盖“final stage=0”的 shortcut；scheduler、engine 和 companion tracker 使用同一个标记语义。
  - 验收：普通 stage-0-final request 不传 KV，标记 request 传 KV，且 metadata 在 `OmniARScheduler._request_omits_kv_transfer_to_next_stage` 中可读回。
- [SCHED-5d] CFG companion 必须成对推进，缺失时有限降级并终止等待
  - 触发：Audex/扩散 CFG companion、双 waiting queue、不同 chunk 进度或 companion abort/split。
  - 强制：不完整 pair 暂存并按 parent/companion 对齐进度；完成时一起收敛，缺失或拆分的 companion 只能走显式、有界的 fallback，并清理两侧状态。
  - 验收：覆盖完整 pair、不同进度、missing/split、parent abort 和 companion abort，断言请求不会挂死、错误归属保持 request-local、队列和 connector state 都释放。
- [SCHED-5e] pooling output decoder 必须覆盖两个 scheduler 且失败即为 request error
  - 触发：pooling stage 配置 per-stage output decoder，或修改 `OmniARScheduler`、`OmniGenerationScheduler` 的 pooling output 完成路径。
  - 强制：两个 scheduler 都经共享 mixin 在 terminal status 处理前调用 decoder；成功时把解码 payload 写入 `EngineCoreOutput`，失败时只将当前 request 置为 `FINISHED_ERROR`、保留错误原因并停止继续调度。
  - 验收：分别覆盖 AR/generation scheduler 的成功、decoder 抛异常、无 decoder 和同批健康 request；断言成功 payload、`FinishReason.ERROR`、request-local 错误归属及无跨请求污染。^[PR #4795]
- [SCHED-5h] KV extraction wait 只能观测完整区间
  - 触发：AR scheduler 进入/离开 `waiting_for_transfer_free`，或传递 KV transfer acknowledgement、connector type、abort/error cleanup metric。
  - 强制：在 `_free_request()` 进入 KV-transfer-free wait 时以 monotonic clock 记录 start；仅在 extraction acknowledgement 到达时 emit completed duration，并携带实际 connector type。任何 finish、abort、error 或 request removal 都清除未完成 start，不能输出 partial wait。
  - 验收：覆盖 complete acknowledgement、无 start、abort/error/normal finish 清理和 iterator request-id 输入；断言只有完整 wait 有一个样本，connector label 有界且没有 stale start。^[PR #6150]
- [SCHED-5f] async-chunk 等待必须有可配置的截止时间
  - 触发：async-chunk 请求进入 `WAITING_FOR_CHUNK`，或配置/测试设置 `VLLM_OMNI_INPUT_WAIT_TIMEOUT_S`。
  - 强制：统一校验超时值，拒绝负数和非有限值，`0` 仅作为显式禁用并记录 warning；chunk adapter 在请求停等时开始计时、每次收到 chunk 后重置，并由 scheduler 及时结束超时且仍在 `self.requests` 中的请求。
  - 强制：stall diagnostic 在 scheduler import 前设置 `0 < server wait < client wait`。
  - 验收：覆盖解析、stall/reset、完成/abort 与健康同批请求；超时为 `FINISHED_ERROR`。Nemotron 固定 `240 < 300`，server request-ID/error 先于 client timeout，健康 control 两者皆不触达。^[PR #6033] ^[PR #6831]
- [SCHED-5i] consumed connector contract failure 必须在 scheduler thread 终止 live request
  - 触发：receiver 已消费 async-chunk，但 prompt/window validation 失败，后台线程不能安全修改 request status 或释放 scheduler ownership。
  - 强制：receiver 只按 internal request ID 记录首次失败原因；scheduler 每轮原子 drain ledger，仅对仍在 `self.requests` 的 ID 调 `finish_requests(..., FINISHED_ERROR)`。已离开或被同 ID 新 generation 替换的 request 不得由 stale failure 终止；错误日志保留 request 与原因。
  - 验收：覆盖 live、已完成/abort、同 ID replacement、重复 failure 与同批健康 request，断言只终止当前 owner 且 ledger 只消费一次。^[PR #6626]
- [SCHED-6a] async discard 的计数单位必须与 stale drain 一致
  - 触发：上游 scheduler 改动异步占位、stale output 或 streaming segment replacement。
  - 强制：每个 discard site 用 `num_in_flight_tokens`（scheduled-token 单位）建立 `num_stale_output_tokens`；同一 in-flight decode 若已由 queued streaming update fence，stop/replacement site 必须赋值而非累加，避免残留吞掉下一 duplex unit。每个迟到 frame 先按本次 `num_tokens_scheduled` 结算 in-flight 与 stale 两个同单位 counter，再在 append/emit 前丢弃。
    - placeholder rollback 与 stale drain 分开记账。
  - 验收：AR 与 generation 路径覆盖多 token frame、prefill 无 placeholder、连续旧/新 segment 和 queued update 后的 async stop，断言 stale counter 恰好归零且首个新 segment 输出不被吞；真实质量指标必须另行验证。^[PR #5976] ^[PR #6619]

### 相关

### [SCHED-6b] full-payload admission 是解析后的 downstream capability

- 触发：新增或修改只在 request end 消费完整上游 sequence 的 stage，或修改 full-payload waiting coordinator。
- 强制：以 pipeline 解析的 `requires_full_payload_input` 驱动 stage_id > 0 的 non-async coordinator；async-chunk stage 走 streamed connector，不创建 full-payload wait。完成前零传输，完成时只 enqueue 一次完整 sequence。
- 验收：覆盖 stage 0、async-chunk consumer、未声明 consumer 和声明的 sync consumer 四个 gates；另覆盖 stage-0 async sender 与 stage-1 receiver 都保有 adapter、完成时一次传输和 abort 无残留。^[PR #5957] ^[PR #6149]
- 机制与边界见 [[scheduler-architecture]]（architecture）；跨 stage 数据面见 [[distributed-overview]]（Distributed 组件）。

### [SCHED-6c] payload transport 的发送与接收能力必须分开验证

- 触发：新增 async-chunk processor、full-payload consumer，或变更 runner connector 初始化。
- 强制：`requires_full_payload_input` 只声明同步 downstream receive/wait；`async_chunk` 独立保留 producer 与 receiver 的 chunk adapter。connector 需求还可来自 downstream processor hook 或 explicit connector role，且每个选择的 GPU/NPU/XPU worker 的 `model_runner_cls` 必须实现 `OmniConnectorModelRunnerMixin`，在 worker 启动前 fail fast。
- 验收：对一个支持和一个不支持 connector 的显式 worker、以及 platform-resolved worker 断言启动前成功/`ValueError`；验证 GPU、NPU 和 XPU worker 公开正确 runner class，并覆盖 sync request-end payload、streaming 累计/terminal chunk、requeue 和 abort cleanup。^[PR #5842] ^[PR #6149]

### [SCHED-6d] 显式 prompt replacement 必须一次性释放旧状态并回到 admission

- 触发：running 或 computed 的 async prompt 显式携带 `replace_streaming_prompt`，或 ready 的 replacement 进入 scheduler。
- 强制：替换先释放旧 KV/encoder state 一次，清除 in-flight prefill 所有权和 connector watermark；stale fence 先设 `drop_stale_output=True`，以当前 `num_in_flight_tokens` 赋值，再将请求回到 `WAITING` 并走正常 admission。
- 验收：覆盖 running replacement、ready async replacement 的重复 reset 和正常重新调度；断言 KV/encoder 释放各一次、watermark 清零、stale counter 恰好可排空且首个新 segment frame 不被丢弃。 ^[PR #6406] ^[PR #8259]

### [SCHED-6e] 流式 segment 边界必须在 request mutation 前冻结发送 watermark

- 触发：`OmniARScheduler.update_from_output` 停止 resumable async-chunk request，且同一处理周期可能由 streaming update 替换或重置该 mutable `Request`。
- 强制：在 `_handle_stopped_request` 及任何会重置 computed-token 状态的 transition 前，从 chunk adapter 取得 confirmed computed-token watermark；将该冻结值显式传给 `save_async`。后续 segment 只能建立自己的 watermark，不能让旧边界任务读取已重置 request。
- 验收：模拟 stop handler 将同一 request 重置为新 segment，断言 queued old boundary 使用 transition 前的 confirmed token 数；并验证 generation scheduler 没有新增 MiniCPM/Code2Wav-specific coalescing state。^[PR #6021]

### [SCHED-6f] stale output 必须同时耗尽 scheduled 与 async 两类计数

- 触发：streaming segment replacement 后收到 late model frame，或修改 abort queue cleanup、streaming-input admission counter 与 segment-boundary handoff。
- 强制：同一迟到 frame 必须联合结算 scheduled-token stale window 与 `async_tokens_to_discard`；前者按 scheduled-token accounting，后者按该 frame 的 generated-token 数递减，任一 fence 命中就不得 append/emit。
  - 处理 pending input 前后都从 `waiting`、`kv_holding_waiting` 与 `running` 清除 `FINISHED_ABORTED`，随后按 live queue ownership 清理相应 `deferred_waiting` 集合成员，重算 `num_waiting_for_streaming_input`。
- 验收：覆盖一个 frame 同时命中两种 fence、仅命中任一 fence、三类 queue 的 abort sweep、pending-input 前后 abort，以及 live-owner counter drift 修复；断言旧 frame 不进入 output，两个 counter 恰好归零且新 segment 首帧保留。^[PR #6529]

## 决策与踩坑

- [SCHED-4a] 禁止：仅同步目标 CPU tensor，却允许下一 step 复用源 GPU buffer；这会得到合法 shape 但错误行内容。
- [SCHED-4b] 禁止：先无条件构造 pinned tensor，失败后才关闭 async path。
- [SCHED-5a] 禁止：`logprobs` 缺失时静默跳过；用 truthiness 判断合法空输出；把 runner 的错位 row 当作用户请求成功。
- [SCHED-5b] 禁止：只按 `running` list 计数导致超额 admission；把 connector-fed chunk 当成 API streaming update；仅在 abort 路径释放 receiver。
- [SCHED-5c] 禁止：按 final stage id 静默跳过所有 stage-0 KV；只在 companion 的 producer 设置标记而不测试 scheduler 的 transfer decision。
- [SCHED-5d] 禁止：只推进 parent 让 companion 永久停在 waiting；把缺 companion 当普通 batch 请求静默放行；用无限等待掩盖 replica loss 或 abort。
- [SCHED-5e] 禁止：只在 AR scheduler 接 hook；decoder 异常 fail-open 为空成功；先完成请求再解码；把原始 pooler tensor 或错误 request 的 payload 发送给下游。
- [SCHED-5h] 禁止：以 request wall-clock、enqueue time 或 cleanup time 补造 KV wait；把没有 start 的 acknowledgement 当零秒样本；因 telemetry 给 terminal request 保留 scheduler state。
- [SCHED-5f] 禁止：只保护 full-payload 的 `WAITING_FOR_INPUT`；让负数、`nan` 或 `inf` 静默关闭 deadline；按 stream 总生命周期计时；对已离开 scheduler 的请求调用 `finish_requests`；把 server error 当 client delivery/生产预算。
- [SCHED-5i] 禁止：在 recv thread 直接结束 request；重试已消费 chunk；将 stale ID 当作 live request；因单个 malformed duplex condition 阻断同批健康请求。
- [SCHED-6a] 禁止：用 `num_output_placeholders` 初始化 stale counter；对已由同次 streaming update fenced 的 in-flight token 再累加；清零 placeholder 后仍让迟到输出进入 placeholder/computed-token 的正常结果更新；把 scheduler 修复宣称为音频 WER 修复。
- [SCHED-6b] 禁止：按模型名、architecture/stage key 或旧 allowlist 猜测能力；扩大到整个模型家族；把 stage-0 async sender 因没有 full-payload input 而不初始化 chunk adapter；逐 token 重复搬运完整 payload。
- [SCHED-6c] 禁止：从 consumer capability 倒推出 sender；把 Nemotron token-only thinker→talker 设为 full-payload；让没有 connector mixin 的平台 worker 在运行时才挂起；让非 async deploy 逐 token 搬完整 code stack，或让 async terminal chunk 缺少 finished/empty-terminal 语义。
- [SCHED-6d] 禁止：只更新 prompt 而继承旧 cache/watermark；把同一 in-flight frame 在更新和 replacement 路径重复计入 stale；绕过 scheduler admission 直接恢复运行。
- [SCHED-6e] 禁止：在 request replacement 后重新计算旧 segment 的 send watermark；以当前 `num_computed_tokens` 推断已确认旧边界；把模型专用 Code2Wav batching/wait policy 塞进通用 generation scheduler。
- [SCHED-6f] 禁止：两个 stale domain 只消费一个；只清普通 waiting/running 而遗留 KV-holding queue 或 deferred set；用增减猜 streaming counter；把 unacknowledged response snapshot 当作有界 lifetime，或把 sliding-recompute/后续 playback ACK 修复归因于本提交。
