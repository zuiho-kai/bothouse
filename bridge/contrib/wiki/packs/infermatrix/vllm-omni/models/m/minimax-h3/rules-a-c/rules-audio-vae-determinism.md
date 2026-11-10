---
name: rules-audio-vae-determinism
description: "MiniMax-H3 audio VAE 确定性：VLLM-OMNI-PR8802-AUDIO-JIT-DETERMINISM，decode_latent 须在 torch.jit.optimized_execution(False) 下调用远端 decode、_AudioVAEDeterminismContext 进出恢复 executor 状态，避免首个请求与后续请求音频因 TorchScript fused/unfused 舍入不同（PR #8802）"
metadata:
  scope: 只收 audio VAE 的 TorchScript executor 确定性规则；conditioned image/video VAE 的 eager ops 与 keyframe 确定性归 rules-vae-ops，Qwen3-VL text encoder 的 cuDNN SDPA 状态归 rules-encoder-state
---
# MiniMax-H3 audio VAE 确定性规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/minimax-h3/rules-audio-vae-determinism.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, diffusion；created: 2026-10-23；updated: 2026-10-23
- 来源（sources）：PR #8802
- [VLLM-OMNI-PR8802-AUDIO-JIT-DETERMINISM] audio VAE 必须固定 TorchScript executor 路径，输出不得依赖请求顺序
  - 触发：修改 MiniMax-H3 audio VAE 的 `decode_latent`/encode 调用、`_AudioVAEDeterminismContext`，或任何调用远端 checkpoint `@torch.jit.script` 代码（本例为远端 `dac_activations.py` 的 `snakebeta`/SnakeBeta activation）的执行路径。
  - 强制：TorchScript profiling executor 首次调用按 unfused 运行、后续调用按 fused 运行，两条路径的 FP32 舍入不同，会使同一 server 进程内首个请求与后续相同请求的音频输出不同。`MiniMaxH3AudioVAE.decode_latent` 必须在 `torch.jit.optimized_execution(False)` 上下文中调用 `self.remote.decode(...)`；
    - encode 路径已复用的 `_AudioVAEDeterminismContext` 必须在 `__enter__` 进入同一设置、`__exit__` 恢复进入前的 executor optimize 状态，不得把全局设置泄漏给进程其余部分。
  - 验收：CPU 单测以 recording decoder 断言 `decode_latent` 的每次远端调用期间 `torch._C._get_graph_executor_optimize()` 为 False、调用结束后恢复原值，`_AudioVAEDeterminismContext` 同样禁用并恢复（PR 中两个测试在 `main` 上失败）；
    - E2E 在真实 recipe profile（PR：2×Radeon AI PRO R9700、ROCm 7.2、TP2）下对同一 server 进程连发 3 个相同 T2VA 请求（PR：1344×768、4 s、1 step、seed 42），断言解码音频流 md5（`ffmpeg -map 0:a -f md5`）三次全部一致且视频 md5 不变；可用 hook 比对 `decode_latent` 的输入/输出定位差异层，并测量 audio decode 耗时无可测回归（PR：812-819 ms 不变）。^[PR #8802]

## 决策与踩坑

- [VLLM-OMNI-PR8802-AUDIO-JIT-DETERMINISM] 禁止：把“第二次请求起输出稳定”当作 fixed-seed 确定性合格；仅凭 audio latent 逐位相同或视频 bitwise 一致断言音频输出确定（本例两者均相同，差异来自 decoder 舍入）；在 decode/encode 作用域之外关闭 executor 优化且不恢复；
  - 隐瞒修复后音频 md5 相对 `main` 稳态输出改变的事实而不按舍入幅度论证（PR 实测：unfused/fused 两条 executor 路径的 waveform 最大绝对差为 2.4e-7、AAC 编码后可见；修复后 waveform 与 `main` 输出的最大绝对差 ≤7.3e-7，属 FP32 舍入幅度，不是解码音频流的端到端差值）。
