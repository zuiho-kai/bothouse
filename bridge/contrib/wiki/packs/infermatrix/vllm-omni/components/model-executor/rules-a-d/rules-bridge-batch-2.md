---
name: rules-bridge-batch-2
description: "跨 stage bridge 与 batch 合同（2/2）EXEC-1j 至 EXEC-1q：side-channel 停止队列按 batch row 占位（PR #4765）、AR runner 传递逐请求 max_tokens 与 seed（PR #5666）、typed ARDiffusionTickRequest 协议身份（PR #5491）、CFG cond/uncond 成对请求按 cfg_pair_id 步进（PR #6186）、sparse meta.req_id payload ownership 与 generation runner 逐请求 batch 输出（PR #5452）、runtime snapshot 替换 capability（PR #6406）、ragged stateful batch"
metadata:
  scope: 只收 bridge-batch 审查组的 EXEC-1j 至 EXEC-1q；EXEC-1a 至 EXEC-1i 见 rules-bridge-batch-1，显式 seed 与 whole-MTP graph 抽样边界 EXEC-RNG-* 归 rules-request-rng，异步 output slab 所有权归 rules-output-snapshots
---
# 跨 stage bridge 与 batch 合同（2/2）

## 关键事实

- 拆分说明：本页是源页 `rules-bridge-batch.md` 的第 2/2 部分；第 1 部分 [[rules-bridge-batch-1]]
- 源页：`knowledge/repos/vllm-omni/components/model-executor/rules-bridge-batch.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, model-executor；created: 2026-09-04；updated: 2026-09-05
- [EXEC-1j] side-channel 停止队列必须按 batch row 保持占位对齐
  - 触发：有状态 AR 模型在 mixed prefill/decode batch 中通过 side-channel 队列把逐请求停止信号映射为 batch logits。
  - 强制：每个 batch row 每步都向 `_results_queue` 放入一个位置项；prefill 使用 `(req_id, None)` 占位，`compute_logits` 按原 batch position 消费并在无信号或未越过停止阈值时强制 continue，消费后清空队列。
  - 验收：用同批 prefill+decode、停止阈值以下、空队列和多请求输入测试，分别断言每行的 continue/stop 结果、请求归属与队列耗尽；batch 顺序变化不能改变停止对象。^[PR #4765]
- [EXEC-1k] AR runner 必须传递逐请求预算与内部采样 seed
  - 触发：共享 AR runner 把逐请求 metadata 交给 `preprocess`，而模型在 `forward` 内采样或必须在 `max_tokens`/上下文容量的最后一个有效 step 发送 multimodal payload 时。
  - 强制：从每个请求的 `sampling_params` 读取 `max_tokens` 与 `seed`，随 prompt 长度、已计算 token 数和 prefill 状态传入所有 preprocess 路径；模型用 scheduler cursor 与 `max_model_len` 判定最后输出，并将 seed 交给 request-local generator。
  - 验收：通过真实 runner 的 mixed-batch 路径覆盖停止结束、预算结束和最后一个 in-flight request，断言每个请求的 committed frame 全部送达；覆盖同 seed、异 seed 及有无 batch 邻居的结果与 request 归属。 ^[PR #5666]
- [EXEC-1l] typed AR-Diffusion tick 必须隔离协议身份并以完整 metadata 提交
  - 触发：新增或修改实验性 AR-Diffusion tick/session、`extra_args` 传输、跨请求事件队列或 chunk 输出元数据。
  - 强制：以不可变且深拷贝隔离的 `ARDiffusionTickRequest` 作为快照；`session_id` 跨 chunk 稳定，`event_id` 在会话内单调，`chunk_index` 连续，`request_id` 只标识一个 chunk。通过 `sampling_params.extra_args["ar_diffusion_tick"]` 传输，输出在 `multimodal_output["metadata"]["ar_diffusion"]` 返回；
    - 协议 request ID 必须与 `AsyncOmni` 的内部 engine routing ID 分离。只有输出元数据与提交快照完全一致后，才能提交事件、prompt、controls 和 chunk 状态；模型失败、元数据不匹配或 reducer commit 失败都必须转为 FAILED 并关闭 worker，后续只能显式 reset 或 close。
  - 验收：覆盖乱序/重复/过期事件、队列背压、交错 `A0 -> B0 -> A1`、ID 分离、缺失或错误元数据、reducer commit 失败、失败后 reset、cleanup 失败 tombstone 与 close retry；同时验证 consumer 对非单副本 stage fail closed，并断言普通 `AsyncOmni` 输出 ID 合同不变。^[PR #5491]
- [EXEC-1m] CFG 成对请求必须按 identity 保持 batch 行步进一致
  - 触发：模型使用 classifier-free guidance，以 `cond`/`uncond` 两个 engine row 解码，或在 batch compaction、prefill/decode 与 request reorder 下维护成对状态。
  - 强制：通过 `cfg_pair_id` 或注册的 companion suffix 从 external/user request identity 建立 pair；在 Scheduler 构造前安装通用 pairing patch；不完整 pair 必须等待，完整 pair 保持相邻并在每次 schedule 后 equalize progress、一起结束，同时按 pair/request id 保存状态而不是按 batch row 保存。
  - 验收：覆盖 suffix/显式 pair id、companion 缺失与到达、row reorder/compaction、chunked prefill、prefix-cache control、一起 finish、非 CFG no-op 和 patch 安装时序；同批不同 seed 与位置必须保持各自归属。 ^[PR #6186]
- [EXEC-1n] 多请求 payload 与共享调度状态必须保持 request ownership
  - 触发：修改 AR/generation runner 的 multimodal payload 路由、prefix-cache 合并、sparse `meta.req_id`，或模型 KV-transfer metadata 与 downstream payload memoization。
  - 强制：先由共享 resolver 校验 nested/flattened sparse declaration，按 `meta.req_id` 建立 sparse index；payload builder 按 request id/index 取值并过滤协议 metadata，singleton list 只作 request-invariant broadcast；合并模型 KV metadata 必须 copy-on-write，`omni_final_stage_id` 未到达前只能保守返回且不得缓存，获取失败原样抛出。
  - 验收：mixed batch 覆盖 sparse subset、combined prefix-cache/direct path、singleton broadcast、越界丢 key、nested/flat conflict、scheduler 原对象不变、marker 到达后 memoization 更新及异常传播；断言每个 request 只收到自己的 payload。 ^[PR #5452]
- [EXEC-1o] generation runner 必须逐请求构造 batch 输出并保持 zero-token 控制流
  - 触发：generation runner 支持并发请求，或修改 `sample_tokens`、`total_num_scheduled_tokens <= 0`、encoder transfer、DP dummy-run 与 KV no-forward 分支。
  - 强制：tensor 的 leading dimension 与 list 长度必须等于 `input_batch.num_reqs`，逐请求构造 payload 并在 mismatch 时报告两侧长度；EC producer 分支必须先于 zero-token 分支，zero/negative-token step 仍按条件执行 DP `_dummy_run(1)` 或 `kv_connector_no_forward`。
  - 验收：覆盖两个及以上 request 的 tensor/list 输出、两类长度 mismatch、zero/negative-token、external-launcher + DP、KV no-forward 与 EC producer，分别断言 request 对齐、错误信息和分支调用顺序。 ^[PR #5452]
- [EXEC-1p] runtime snapshot 替换必须由 capability 和 producer marker 双重控制
  - 触发：shared GPU/NPU runner 消费跨 async-chunk 请求和 step 的 runtime additional information。
  - 强制：模型 capability `replace_runtime_additional_information` 必须同时控制 scheduled-new 与 scheduled-cached 路径；替换 helper 写入 request-owned CPU mirror，只保留 `num_processed_tokens`、`resumable` 等 runner bookkeeping；未 opt-in 模型继续使用增量 merge。
  - 验收：覆盖 new/cached replacement、未标记增量 merge、request mirror 和 sibling request 隔离，并确认 NPU 继承路径使用同一替换实现。 ^[PR #6406]
- [EXEC-1q] ragged stateful batch 必须维持输入行和 request-owned cache 的一一对应
  - 触发：stateful generation/codec consumer 放宽 batch compatibility key，令同一 batch 可含不同当前 chunk 长度或 final flag。
  - 强制：保留 input-row 顺序，按 row 维护下一状态；短行可在一次 masked/padded compute 中执行，超出既有 encoder window 的行必须回退到已有的 safe sliced path。任何缺失 audio/state row 都 fail closed，不能 filter 后压缩结果；平台 fast path 在不支持 ragged mask/valid-length 时必须回退。
  - 验收：混合长度、final flag、长行和正常行，逐 request 对照 exact path 的 audio/cache；注入中间缺行应报错而非重排。模型专有的 Code2Wav cache/dtype contract 见 MiniCPM-o 4.5 rules。^[PR #6021]

## 决策与踩坑

- [EXEC-1j] 禁止：省略 prefill/new-request 占位、压缩或重排队列、把 `(continue, stop)` 概率直接当 logits，或依赖全 `-inf` 行的偶然 `argmax` 结果维持对齐。
- [EXEC-1k] 禁止：用当前 span 或模型本地计数器猜预算；只让 vLLM 外层 sampler 看到 seed；依赖 `on_requests_finished` 之后再 flush，此时 request 已离开输出 batch，payload 无法路由。
- [EXEC-1l] 禁止：用内部 engine request ID 冒充协议 request ID；在模型输出验证前确认事件已应用；原地重试失败 chunk；让通用 session 层解析 LingBot camera/action schema；在没有 session-affine routing 时启用多副本 AR stage；把内部 tick contract 当作公共 HTTP/WebSocket 协议。
- [EXEC-1m] 禁止：用 row adjacency 或 internal UUID 推断 pair；让 prefix-cache 不对称命中、chunked prefill 或单边 preemption 使两行错位；只结束一方、把 per-request seed/position metadata 广播给整批，或让非 CFG stage 被无条件改写。
- [EXEC-1n] 禁止：用 batch index 代替 sparse index、用 `v[0]` 替代越界多元素值、把请求数据广播给另一 request、原地修改 scheduler-owned dict，或吞掉 transfer metadata 异常。
- [EXEC-1o] 禁止：用同时要求输出维度为 1 和 `num_reqs` 的断言限制 batch；构造只含一个 entry 的 payload；用无条件 zero-token early return 遮蔽同步、DP 或 KV-transfer 分支。
- [EXEC-1p] 禁止：让共享 runner 默认改用全量替换；把旧 terminal payload 合并回新 snapshot；只修 scheduled-new 而遗漏 cached admission；把 runner bookkeeping 当作模型 payload。
- [EXEC-1q] 禁止：按 batch 位置共享或错配 session cache；让 ragged path 绕过 RelPos/encode slicing；用过滤 `None` 的方式掩盖 hole，或把模型特有的 coalescing wait 写进 generic scheduler。
