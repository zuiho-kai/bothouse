---
name: distributed-rules-1
description: Distributed 传输规则（1/2）DIST-1a、1b、1b1、1c、1d、1e、1f、1g、1h、1i、1j：TP KV receive 全 rank 一致放弃、chunk transfer 区分 upstream exhaustion 与 stage 完成、adaptive controller 生命周期、payload connector 按 edge 所有权创建、async-chunk 发送失败 ledger、隐藏队列状态恢复、Code2Wav 快照替换、save_async 入队冻结、sender generation token、receiver registration identity、dedup watermark 按 segment generation
metadata:
  scope: 只收本页 sources 清单与 DIST-1a 至 DIST-1j（TP KV receive 与 async-chunk sender/receiver 状态合同）；DIST-2a、3a、1k、1l 系列、1m 与 VLLM-OMNI-PR9406-ASYNC-POLL-SLEEP 见 distributed-rules-2，connector backend 选择归 distributed-architecture，端口分配坑归 connector-pitfalls
---
# Distributed 传输规则（1/2）

## 关键事实

- 拆分说明：本页是源页 `rules.md` 的第 1/2 部分；第 2 部分 [[distributed-rules-2]]
- 源页：`knowledge/repos/vllm-omni/components/distributed/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, distributed；created: 2026-08-05；updated: 2026-10-26
- 来源（sources）：PR #5744；PR #5976；PR #6001；PR #6089；PR #6834；vllm_omni/diffusion/distributed/parallel_state.py；tests/diffusion/distributed/test_expert_parallel_layout.py；vllm_omni/distributed/omni_connectors/adapter.py；vllm_omni/distributed/omni_connectors/kv_transfer_manager.py
  - vllm_omni/distributed/omni_connectors/transfer_adapter/chunk_transfer_adapter.py；vllm_omni/distributed/omni_connectors/transfer_adapter/base.py；vllm_omni/worker/omni_connector_model_runner_mixin.py；tests/distributed/omni_connectors/test_kv_recv_tp_consensus.py
  - tests/distributed/omni_connectors/test_chunk_transfer_adapter.py；tests/worker/test_omni_connector_mixin.py；PR #5146；PR #6021；PR #6033；PR #6360；PR #6406；PR #6626；PR #6529；PR #7136；PR #6889；PR #6093；PR #7870；PR #7166；PR #8082；PR #7733；PR #9406
- 置信度（confidence）：high
- 只有 `DIST-数字字母` 是本页可审计规则 ID。connector backend 的选择和端口分配见 [[distributed-architecture]]（Distributed architecture） 与 [[connector-pitfalls]]（connector pitfalls）。
- [DIST-1a] TP KV receive 必须做全 rank 一致的成功/放弃决定
  - 触发：纯 TP stage 接收 KV、CFG companion 参与 KV transfer，或 connector receive 只在部分 rank 得到 state。
  - 强制：只在 TP process group 内交换 receive state；任一 rank 发现 metadata、shape 或 payload 不一致时，所有 rank 都走同一个 no-KV fallback，不能让部分 rank 继续 collective。
  - 验收：模拟单 rank divergence，断言所有 TP rank 都放弃本次 KV 并保持后续 collective 可继续；覆盖普通和 CFG companion 角色。
- [DIST-1b] chunk transfer 要区分 upstream exhaustion 与本 stage 完成
  - 触发：async-chunk/full-payload connector 传递空 segment、最后一个 chunk 或 `WAITING_FOR_CHUNK`/active-window 状态。
  - 强制：保留空 segment 的边界语义，区分 upstream 已耗尽和当前 stage 已生成完成；收到后续 chunk 时刷新 prefill/request state，并让 active-window admission 继续推进。
  - 验收：覆盖非空→空→非空、upstream exhaustion、stage completion、重复 terminal update 和窗口恢复；首批测试看 `test_chunk_transfer_adapter.py`。
- [DIST-1b1] per-segment adaptive controller 不得越过 connector lifecycle
  - 触发：Qwen3-TTS adaptive chunk、resumable segment finish，或 transfer adapter/local runner cleanup 修改。
  - 强制：controller 可按 request 持有，但 `is_segment_finished` 与 request cleanup 均必须清除；下一段从 chunk 0 重新建立 EWMA、emitted ledger、playback cursor 与 telemetry。request-global connector continuity key 不能延长 controller 生命周期。
  - 验收：normal finish、segment finish、abort cleanup 与 empty terminal payload 都断言 state 不残留；覆盖 `OmniChunkTransferAdapter` 和 `OmniConnectorModelRunnerMixin`。^[PR #6001]
- [DIST-1c] payload connector 按 edge 所有权创建且不与 KV manager 捆绑
  - 触发：修改 AR/DiT 解耦、stage connector role、`custom_process_next_stage_input_func`、runner connector 初始化或 KV-only edge。
  - 强制：receiver/非 sender 即使无 downstream hook 也创建 payload connector；sender 只在 `custom_process_next_stage_input_func` 是非空字符串时创建，空值或非字符串都表示 KV manager 独自拥有该 edge。KV manager 与 payload connector 必须独立初始化和关闭。
  - 验收：参数化锁定 sender+空/非字符串→不创建、sender+非空字符串→创建、receiver/非 sender+无 hook→创建，并覆盖安全 shutdown。Bagel/Hunyuan KV-only 和 Qwen3-Omni/MiniCPM-o payload 路径各做真实拓扑 smoke。该矩阵不证明 issue #5595 中独立的 shutdown/orphan 问题已解决。 ^[PR #5744]
- [DIST-1d] async-chunk 发送失败必须保留内部请求身份并可观测
  - 触发：async-chunk sender 的队列任务被 `popleft()` 后发送抛异常，或 connector 返回失败但不抛异常。
  - 强制：从 task 内的 `request.request_id` 取得 scheduler 使用的内部请求 ID，在发送线程以锁保护的 ledger 中按请求记录首次失败原因；scheduler sweep 时原子 drain 并分别记录仍存活与已离开 scheduler 的请求。
  - 验收：覆盖发送抛异常、`connector.put` 返回 `False`、内部/外部 ID 不同、同一请求多次失败、并发 record/drain，以及请求在 sweep 前后离开 scheduler；日志必须包含正确 request ID 和失败原因，且 ledger 只被消费一次。^[PR #6033]
- [DIST-1e] chunk connector 仅按隐藏队列所有权恢复状态并幂等回收 receiver
  - 触发：`OmniChunkTransferAdapter.finish_requests` 处理 resumable 请求的 `FINISHED_STOPPED` segment，且请求可能停在 `waiting_for_chunk_waiting_requests`、`waiting_for_chunk_running_requests` 或 `_held_non_active` 中。
  - 强制：只在 connector 隐藏队列实际持有请求时恢复 `requests_origin_status`；对每个目标统一调用幂等的 `cleanup_receiver`，清理 active stream、ready/exhausted/finished/cancelled/waiting 状态，并移除 chunk 等待队列中的已完成请求；请求已回到 scheduler 可见队列后不得再使用过期 origin status 覆盖当前状态。
  - 验收：覆盖 connector 隐藏持有、scheduler `running`/`waiting`/`skipped_waiting` 持有、无 connector 所有权及 stale origin；断言隐藏队列、origin ledger、active streams 和 receiver 状态在重复 finish 后仍为空且 active-window 可被新请求重新占用。^[PR #6360]
- [DIST-1f] Code2Wav 快照替换必须显式标记并保持终端就绪
  - 触发：async-chunk connector 收到 generation runtime payload、终端 chunk 或重复 terminal boundary。
  - 强制：只有 producer 显式设置 `replace_runtime_additional_information=True` 才全量替换；Code2Wav 的空 replacement 必须同时带 `is_segment_finished=True` 以标记就绪；替换时删除旧 `codes.audio`，但保留当前 snapshot 的 `codes.ref` 等 sibling 字段。
  - 验收：覆盖标记/未标记、audio+ref、空 replacement 和重复 terminal；断言新 prompt、finished/ready 状态正确，旧 audio 不会进入下一次 Code2Wav。 ^[PR #6406]
- [DIST-1g] 异步 processor 任务必须在入队时冻结边界状态
  - 触发：`OmniChunkTransferAdapter.save_async` 向 custom next-stage processor 入队，且 producer request 会在 worker 发送前继续被 streaming update 原地修改。
  - 强制：只为 custom processor shallow-copy request，并递归复制其可变容器输入（additional information、prompt/token lists）；tensor leaves 保持共享。每个 queued segment boundary 在入队时移除 `requests_num_chunks_sent` chunk-progress watermark，使下一个 segment 能从 chunk 0 建立自己的 watermark；
    - 这不重置 `_segment_generation` gate，后台发送旧 task 也不得清除新 segment 的 watermark。^[PR #6834]
  - 验收：old/new segment 在 background flush 前交错时，新 watermark 保持；连续入队后各 processor 观察各自 admission-time request snapshot；无 custom processor 时 task 仍引用原 request。^[PR #6021]
- [DIST-1h] abort 不能让旧 sender generation 复活
  - 触发：async-chunk sender 在 background save/connector put 期间 abort，且 external request ID 可复用。
  - 强制：queued task 与其 sender generation token 绑定；abort 取消 token，旧 task 在 put 前后均须拒绝更新 state，in-flight task 在 finally 中回收。sender-state lock 只保护 token/state transition，不能包住 payload construction 或 connector I/O。
  - 验收：覆盖 pending/in-flight abort、stale put completion、ID reuse 和普通 async-chunk transport。^[PR #6089]
- [DIST-1i] receiver registration 必须隔离旧 poll 与新 request generation
  - 触发：async-chunk receiver 注册/清理与 `connector.get()` 并发、同一 internal request ID 恢复或复用，或已消费 payload 需在 scheduler thread 才能安全修改 prompt。
  - 强制：每次 receiver registration 持有独立 identity entry；`connector.get()` 可在锁外阻塞，但结果 commit 必须在 receiver-state lock 下确认当前 map 仍指向同一 entry。cleanup 是 commit barrier：旧 queued/in-flight poll 的迟到结果只能丢弃，不能重建已删除或新 generation 的 prompt/window state。
    - AR payload 先冻结为 pending update，再由 scheduler thread 用当前 live request 应用；contract error 进入一次性 receive-failure ledger，不得重取已消费 chunk。
  - 验收：覆盖 cleanup-during-get、same-ID re-registration、late success/error、重复 register/cleanup、scheduler live-ID replacement 与 invalid payload ledger drain；证明旧 entry 不影响新 request。^[PR #6626]
- [DIST-1j] sender dedup watermark 必须按 generation/segment 限定
  - 触发：async-chunk sender dedup、segment terminal task、background cleanup 或同 request ID 的 streaming segment replacement。
  - 强制：`save_async` 将 request 的 segment generation 冻结进 queued task；小于当前 generation 的 late save 必须拒绝。terminal 必须清除 chunk-progress counter；仅当 request `._omni_segment_generation is not None` 才把 expected generation 推进 `+1`，否则保持 current generation，使 counter-less follow-up 仍以 current/0 enqueue。
    - chunk watermark 只负责同段 progress dedup，generation gate 负责跨段 stale fencing；request 最终 cleanup 同时回收 generation 和 chunk state。
  - 验收：覆盖 counter-bearing terminal `+1` fencing 与 counter-less terminal hold/current-0 follow-up、counter clear、late old save 和普通 dedup/preemption。该变更不修复已有 stuck ID 或 abort 行为。^[PR #6529] ^[PR #6834]

## 决策与踩坑

- [DIST-1a] 禁止：用本地 `if` 丢掉 KV 后仍让其他 rank进入 receive；使用 global world group 代替 stage 的 TP group；把 companion 当成普通 stage-0-final request 静默跳过。
- [DIST-1b] 禁止：把空 segment 当作完成信号；用本 stage 的 generation completion 终止上游；在 connector 没有新数据时无限占用 active window 或静默丢掉 terminal update。
- [DIST-1c] 禁止：不得只因已配 connector/role 就创建 payload transport；不得从“无 outgoing hook”推导 receiver 也不需要 connector；不得用 consumer-side hook 反推 sender 所有权。
- [DIST-1d] 禁止：读取不存在的 `task["request_id"]`；用 `external_req_id` 代替 `self.requests` 的内部 key；发送失败后静默丢弃，或把已完成/已 abort 请求误当作仍可调度请求。
- [DIST-1e] 禁止：仅凭 `requests_origin_status` 存在就恢复状态；把 resumable `FINISHED_STOPPED` 当作普通 finished 请求而跳过 connector 回收；分散复制部分 receiver 清理逻辑导致重复释放或残留 active-stream 占用；用无关请求的队列状态扩大清理范围。
- [DIST-1f] 禁止：把未标记的 generation/diffusion payload 改成替换语义；把 control-only boundary 写成未就绪的空更新；跨 segment merge/replay 旧 terminal audio。
- [DIST-1g] 禁止：给无 hook 的直通路径增加 request snapshot/copy；让 queued task 读取后来 mutation 的 token、metadata 或 output history；在后台 terminal cleanup 无条件删除可能已属于下一 segment 的 watermark。
- [DIST-1h] 禁止：`cleanup_sender` 清空 map 后让 pending save 用默认 chunk counter 写回旧 chunk 0；让 scheduler thread 等待 connector I/O；把同一 external ID 的新 generation 误当作旧 task 的 cleanup target。
- [DIST-1i] 禁止：只按可复用 request-id 判断 poll 仍有效；在 I/O 期间持有 scheduler-facing lock；让旧 terminal cleanup 清掉新 registration；使用被移出 scheduler 的 fallback request 应用 pending mutation。
- [DIST-1j] 禁止：只按裸 request ID 判断 late task 有效；让旧 terminal boundary 因旧 chunk count 被误拒；background completion 无条件删除下一段 watermark；把未 ACK 的 serving response snapshot描述成此 sender generation 已给出有界 retention。
