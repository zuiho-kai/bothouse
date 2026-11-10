---
name: rules-local-mrv2
description: "MOSS-TTS Local MRv2：MOSSTTS-5a 自动 profile 选择（140 GiB 与 MPS 门限）、5b MPS 验证的 daemon 归属与 quota、5c native EOS 保留终止步并排空在途资源、5d 空音频先于成功 metrics 失败、5e prefix 命中与逐行采样的绝对 token 位置（PR #8438）"
metadata:
  scope: 只收 MOSSTTS-5a 至 5e；逐行 seed、slot 状态、ramp 与 first-chunk、reference worker 归 rules-local-streaming，Local talker 异步输出与 sampler 归 moss-tts-rules-1
---
# MOSS-TTS Local MRv2 profile 与输出合同

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/moss-tts/rules-local-mrv2.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models；created: 2026-10-09；updated: 2026-10-09
- 来源（sources）：PR #8438
- 置信度（confidence）：high
- [MOSSTTS-5a] 自动 profile 选择保留显式覆盖与容量门限
  - 触发：修改 MOSS-TTS Local pipeline 自动选择、CUDA memory/MPS probe。
  - 强制：显式 profile 优先；自动 CUDA 仅在 MPS 可用且显存至少 140 GiB 时选 optimized MRv2，低显存或查询失败走 C64 MPS profile，无 MPS 选 C64 no-MPS，非 CUDA 走 v1。profile 的 KV、prefix cache、batch-prefill、direct-token 与 audio sampler compile 配置一同核对。
  - 验收：结构化与 legacy 路径覆盖 139/140/141 GiB、查询失败、MPS 有无、非 CUDA 和显式覆盖，核对最终容量与各优化开关。 ^[PR #8438]
- [MOSSTTS-5b] MPS 验证只使用可证明归属且满足 quota 的服务
  - 触发：修改 Local MPS recipe 或报告 MPS 性能/质量。
  - 强制：使用 operator 明确提供的 MPS socket，或本次启动并拥有的私有 control daemon；验证实际 SM quota 满足 workload，清理只停止本次拥有的 daemon。记录 GPU、quota、profile、head 与 workload。
  - 验收：核对 socket/daemon 归属和有效 quota；recipe 的启动、失败与清理路径可执行。历史环境观察保留为证据边界而非永久硬件保证。 ^[PR #8438]
- [MOSSTTS-5c] native Local EOS 保留终止步并排空在途资源
  - 触发：修改 native transport、EOS handoff 或 scheduler reservation。
  - 强制：保留产生 EOS 的终止步结果，抑制终止后的在途 payload；取消/结束排空 reservations，并清理 scheduler/request 状态。
  - 验收：固定历史/seed 对照 terminal payload 与音频顺序，覆盖 EOS 后在途消息和 slot 回收；质量比较使用相同语料与协议。 ^[PR #8438]
- [MOSSTTS-5d] 空音频必须在成功 metrics 与 artifact 之前失败
  - 触发：修改 Local codec empty PCM、Speech streaming 或 artifact publication。
  - 强制：无有效 PCM 时 adapter 抛错；SSE 发 error 而不发成功 done，raw stream 中止；零 chunk 不输出伪 WAV header，不落成功 artifact/metrics。
  - 验收：覆盖 nonstream、SSE、raw、零 chunk 与 codec empty PCM，确认错误路径和成功计数/文件均未发布。 ^[PR #8438]
- [MOSSTTS-5e] prefix 命中与逐行采样保留绝对 token 位置
  - 触发：修改 prefix cache、aligned reference grid 或 Local MTP sampling。
  - 强制：cache hit 使用绝对 computed-token offset，保留部分已对齐的 reference grid；batch 各行使用自身 seeded generator 和 token 历史。
  - 验收：命中/未命中及 partial grid 对照，混合不等长请求，逐行检查相同 seed 与 reference 的输出/RNG state。 ^[PR #8438]

## 决策与踩坑

- [MOSSTTS-5a] 禁止：把一次显存查询失败当成高容量；对非 CUDA 执行 CUDA probe；以 profile 名称代替最终 stage args。
- [MOSSTTS-5b] 禁止：停止共享 MPS daemon；把一次 partial-quota BF16 GEMM 失败外推成所有设备限制，或把缺 quota 的运行用于证明 full-quota profile。
- [MOSSTTS-5c] 禁止：丢失最后有效音频步，或把迟到 payload 当作新的有效输出；从单次 WER 推出所有配置等价。
- [MOSSTTS-5d] 禁止：用可解码的空容器或成功结束掩盖模型未产出音频。
- [MOSSTTS-5e] 禁止：把 cache 命中后的局部 offset 当作全局位置，或跨请求共享 RNG 进度。
