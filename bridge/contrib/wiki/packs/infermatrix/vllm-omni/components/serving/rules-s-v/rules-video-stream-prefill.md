---
name: rules-video-stream-prefill
description: "Realtime video 增量 prefill 三条规则（PR #5894）：VSP-PREFILL-1a 仅 stage-0 prefix caching 开启且 text-only 输出时走增量 vision warmup；VSP-FRAME-1a context signature 含完整有序 frame identity、共享 cache entry 的 pin 与 consumed metadata 同一 snapshot；VSP-ABORT-1a 取消 warmup / query 先跨过 stage-0 提交屏障"
metadata:
  scope: 只收 video-stream session 的增量 prefill、frame cache lifetime 与取消屏障三条规则；视频预热缓存逐出竞态（SERV-6j）归 rules-session-lifecycle
---
# Realtime video 增量 prefill 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/serving/rules-video-stream-prefill.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, serving；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #5894
- 置信度（confidence）：high
- [VSP-PREFILL-1a] 增量 vision warmup 由 stage-0 APC 与 text-only 输出共同决定
  - 触发：修改 video-stream session 的增量 prefill 选择、warmup prompt、frame window 或 query processor kwargs。
  - 强制：只有 stage-0 prefix caching 开启且本 session 不输出 audio 时使用增量路径；audio-output 保留 legacy query prompt。增量 warmup 只预填当前已解码 frame prefix，不混入本次问题/音频；query 使用同一帧序列，不能再按 `num_frames` 子采样。`use_audio_in_video=True` 时，warmup 与增量 query 都传相同 processor kwarg；legacy query 仍仅在确有 input audio 时传递。
  - 验收：覆盖 APC/text-only 与 audio-output 路径、warmup/query kwargs 一致性、cap 前相同窗口及 cap 后 half-window eviction；增量等待完整窗口 decode，legacy 仅等待所选 frames。^[PR #5894]
- [VSP-FRAME-1a] warmup 身份、cache lifetime 与 consumed metadata 绑定同一帧 snapshot
  - 触发：修改 video frame FIFO、重复帧 cache、延迟/失败 decode、warmup 去重或 `video.frames.consumed`。
  - 强制：context signature 包含完整有序 frame identity，不能仅用长度和末帧。重复 buffered frame 共享 cache entry，任一副本仍在 buffer 或被 in-flight query/warmup pin 住时不得回收；failed-decode marker/readiness 也遵守该 lifetime。一次选择成功解码的 frame indices，同时用于 prompt image parts 与 consumed metadata，释放最后 pin 后补做 deferred eviction。
  - 验收：覆盖 `[A,B]`→`[C,B]` 的 delayed warmup、重复帧 eviction、query snapshot 后发生 decode failure 与全部 pin 释放；consumed frame IDs/latest timestamp 只反映实际进入 prompt 的图片。^[PR #5894]
- [VSP-ABORT-1a] 取消 warmup/query 必须先跨过 stage-0 提交屏障
  - 触发：在 multimodal preprocessing、warmup generate 或 query submission 尚未完成时取消/中断 video request。
  - 强制：新 query 先结束旧 warmup；preprocess 已更新 sender MM cache 时用 shield 等待它完成，将对应 request 提交 stage 0 后再传播取消并 abort。session-owned JPEG decode readiness 与 request task 分离，取消模型请求不得级联取消共享 decode。
  - 验收：在 preprocess 与 submit 的确定性屏障分别注入取消，断言 stage-0 submit 先于 abort、后续 query 无孤立 hash/cache miss，共享 decode 仍可完成且任务/请求最终释放。^[PR #5894]

## 决策与踩坑

- [VSP-PREFILL-1a] 禁止：添加与上述实际能力不一致的 session 开关；把 text-only cache 命中推广为 audio-output 或 duplex conversation-item 的支持；将 cap 处丢弃旧半窗描述为对整条流 resample，或据有界窗口测量声称无限 history 的 TTFT 不增长。
- [VSP-FRAME-1a] 禁止：FIFO 移走一个副本就删除共享 entry；在 query 等待期间撤销 BAD marker；从一份 selection 生成 metadata、另一份 selection 构造图片；以相同末帧误判不同窗口已经 warmed。
- [VSP-ABORT-1a] 禁止：preprocess 记下 hash 后在 stage-0 接收前 abort，留下 receiver 未见过的 cache identity；以取消 warmup 破坏被 query pin 住的 decode；task 退出后遗留模型 request。
