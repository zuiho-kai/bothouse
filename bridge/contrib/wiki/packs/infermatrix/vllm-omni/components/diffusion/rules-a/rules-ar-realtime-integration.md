---
name: rules-ar-realtime-integration
description: 规则 VLLM-OMNI-PR6392-ABOT-REALTIME：ABot-World 实时集成的质量证据脚本 abot_compare_quality.py 与 abot_review_evidence.py 必须先实际编码（FFV1、8-bit RGB）再做 PSNR/SSIM，编码不进 latency 计时，记录 input control 与 reference 声明；taew2_2 分支的 full_wan 对比因未编码按现状无法运行
metadata:
  scope: "只收 PR #6392 的 ABot-World/AR-Diffusion 实时集成证据一条规则；AR-Diffusion 分页几何归 rules-ar-paging-geometry"
---
# AR-Diffusion 实时模型集成规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/diffusion/rules-ar-realtime-integration.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, diffusion；created: 2026-10-13；updated: 2026-10-13
- 来源（sources）：PR #6392
- [VLLM-OMNI-PR6392-ABOT-REALTIME] ABot 实时集成证据必须先编码后比较，并显式声明参考、计时与证据边界
  - 触发：修改 `benchmarks/diffusion/abot_compare_quality.py`、`benchmarks/diffusion/abot_review_evidence.py`，或为 ABot-World/AR-Diffusion 实时集成（`vllm_omni/diffusion/models/abot_world/`、`tests/diffusion/models/abot_world/`）新增/修改质量、状态或延迟证据。
  - 强制：质量比较是 CPU-only 的保存 tensor 对比；lossless 编码（FFV1、8-bit RGB）只在推理之后进行，绝不进入 latency 计时；PSNR/SSIM 复用仓库既有 ffmpeg similarity helpers，交给 similarity 的每个视频路径都必须在本次运行中先实际编码产生。
    - 报告必须固定并记录 input control（同 image/prompt/seed=42、无 motion actions、512x832、前 117 帧）、reference 声明（native cache offline 生成、同一 per-frame VAE decode 路径、非 upstream 原始数值）与编码格式，每行同时保留 float PSNR、ffmpeg PSNR/SSIM、`max_abs_error` 与 `torch.equal`；
    - 所有对比以 typed 输出为基准，对每个被编码模式的逐 tick tensor 断言 `(9|12, 3, 512, 832)`（首 tick 9 帧、其后各 12 帧）。review evidence 每阶段在独立进程中运行，baseline 不启用 torch profiler 或 stage 同步，RPC snapshot 位于被测 `next_chunk` 调用之外；
    - snapshot 以 `_wan_decode_cache_bytes`/`persistent_state_bytes` 计算的 per-session VAE 预算核对每个 decode state 并记录 model-owned state 字节。证据输出目录用 `exist_ok=False` 创建、ffmpeg 使用 `-n`，绝不覆盖既有证据。
  - 验收：对 `wan` 与 `taew2_2` 两种 backend 的保存 tensor（typed/stepwise 逐 tick、offline clip）运行质量脚本，断言被比较的每一对路径都在当次运行中实际编码、JSON 行含双路指标与 `exact`，summary 仅汇总 `typed_vs_offline` 与 `typed_vs_stepwise` 的 SSIM 最小值与 float PSNR；逐 tick 断言 shape 与 9/12 帧序列；snapshot 断言全部 decode state 满足 per-session VAE 预算。
    - 本规则的证据只完整覆盖两个 benchmark 脚本；其余改动文件（如 `abot_world_transformer.py`）在随附 diffs 中仅有标明截断的部分 diff，native `ti2v` 发现、decoder 结构、KV/VAE 清理与测试覆盖等主张须以完整 diff 另行评审，不得把截断片段或 PR 描述当作已验证行为。^[PR #6392]

## 决策与踩坑

- [VLLM-OMNI-PR6392-ABOT-REALTIME] 禁止：把只赋值了路径、从未编码的文件传给 similarity helpers——当前 `taew2_2` 分支的 `full_wan` 对比正是如此（加载 tensor、赋值 `wan-typed-###.mkv` 路径却没有调用编码），该 ffmpeg 对比按现状无法运行，在补上编码之前不得把“近似 decoder 对完整 decoder 的差异”当作已产出证据引用；把 identical 视频产生的 `average:inf` PSNR 输出交给只接受有限数值的 parser 或静默丢弃；
  - 在 latency 计时内做编码；用该报告宣称与 upstream 数值一致或近似 decoder 质量等价；覆盖或复用既有证据目录。
