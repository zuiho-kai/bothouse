---
name: async-chunk
description: "Async chunk 跨 stage 分块流式指南：按 chunk 就绪即转发的语义、prefill 段 chunk_size = num_scheduled_tokens 与 decode 段 1、Talker→Code2Wav 的 codec_chunk_frames（默认 25）与 initial_codec_chunk_frames、Qwen3-TTS codec_chunk_adaptive（PR #6001）、deploy 顶层 async_chunk 开关（单 stage diffusion 须 false）"
metadata:
  scope: 只收 async_chunk 的语义、chunk 大小定义、配置开关与性能数字出处；async-chunk sender/receiver 的规则（DIST-1b 至 1j）归 distributed-rules-1，调度侧等待状态机归 scheduler-architecture，单 stage diffusion 事故归 ci-gotchas，阈值 0.65 案例归 accuracy-attribution
---
# Async chunk（跨 stage 分块流式）

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/distributed/async-chunk.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, components, distributed；created: 2026-07-16；updated: 2026-09-05
- 来源（sources）：docs/design/feature/async_chunk.md；vllm_omni/distributed/omni_connectors/transfer_adapter/chunk_transfer_adapter.py
- 官方 spec：`docs/design/feature/async_chunk.md`（`main @ 5c390096` 复核）；传输适配层 `omni_connectors/transfer_adapter/chunk_transfer_adapter.py`，调度侧等待状态机在 [[scheduler-architecture]]（Scheduler） 的 `OmniSchedulingCoordinator`。
- 语义：多 stage pipeline（如 Qwen3-Omni Thinker→Talker→Code2Wav）不等上游 stage 完整输出，按 chunk 就绪即处理即转发——降低延迟、跨 stage 重叠执行、支持流式音频输出；chunk IO（get/put）在后台线程与计算重叠，调度器不因等 chunk 阻塞。
- chunk 大小定义：prefill 段 `chunk_size = num_scheduled_tokens`（chunked prefill）；decode 段 `chunk_size = 1`（逐 token 流式）。qwen3-omni 实例：Thinker→Talker 逐 decode step（通常 1）；Talker→Code2Wav 积累到 `codec_chunk_frames`（默认 25）再发——初始阶段按服务负载动态选初始 chunk（IC）以降 TTFP，可用逐请求 API 字段 `initial_codec_chunk_frames` 覆盖；
  - Code2Wav 流式解码（支持批推理）。Qwen3-TTS 可 opt-in `codec_chunk_adaptive`：chunk 0 仍使用 dynamic IC，chunk 1+ 由 host-side、每 request/segment 的 EWMA buffer-feedback 控制；fixed `codec_chunk_ramp` 在此模式不生效。segment finish 与 request cleanup 都必须丢弃 controller state，不能把上一段的 buffer/telemetry 继承到下一段。^[PR #6001]
- 配置：deploy 顶层 `async_chunk`（默认 true）；端到端跑完的 pipeline 应 pin `false`——单 stage diffusion 必须 `async_chunk: false` 的事故见 [[ci-gotchas]]（ci-gotchas） 第 2 条。
- 性能：spec 附 E2E/TTFT/TPOT/TTFP/RTF/ITL 实测表（并发 1/4/10 × code2wav batch 1/64 等组合）——引用数字前以当前版本原文为准。

### 相关

- 阈值变差对精度断言的影响（async_chunk 模式阈值 0.65 案例）见 [[accuracy-attribution]]（accuracy-attribution）。
