---
name: rules-latent-refinement
description: "MiniMax H3 latent upscale 与 refinement：MMH3-LATENT-1a optional upscaler 的 checkpoint、latent normalization 与 residency、MMH3-LATENT-1b 第二 pass 重建 layout 并以 video/audio 各自 sigma 重新加噪、MMH3-LATENT-1c 第二 denoise loop 的 per-rank token 容量门禁与 step execution 拒绝（PR #8322）"
metadata:
  scope: 只收 latent_upscale 与 latent_refine 三条规则；Cache-DiT/TeaCache 的 request 生命周期与 sigma schedule 归 rules-cache-task-1、rules-cache-task-2，step execution 的状态隔离归 rules-cache-task-3
---
# MiniMax H3 latent upscale 与 refinement 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/minimax-h3/rules-latent-refinement.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, diffusion；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #8322
- 置信度（confidence）：high
- [MMH3-LATENT-1a] optional upscaler 必须保持 artifact、latent normalization 与 residency 合同
  - 触发：修改 `latent_upscaler_path` loading、architecture detection、`upscale`、target size 或 temporal chunking。
  - 强制：只有声明 checkpoint path 才建立 optional upscaler；本地目录必须唯一定位 checkpoint，按 released pure-3D convolutional state dict恢复 architecture 并 strict load，拒绝 attention-block artifact。输入保持 H3 `[B,24,T,H,W]` pipeline convention，进入 resizer 前再按 VAE mean/std normalize，出来反变换并恢复 source dtype；spatial resize 保持 T。
    - per-request `latent_upscale` 优先于 additional-config default，false/null可 opt out；scale、dimensions、megapixels 只能选择一种，数值/align须合法，unserviceable target 在 denoise前失败。非 resident 模式通过 `finally` offload。temporal chunking默认关闭，开启时仍保留 symmetric overlap和 blending。
  - 验收：checkpoint namespace/shape错误、normalization round trip、target解析与 opt-out、time/channel/dtype、异常 offload分别覆盖；chunk/full输出分别复核，长视频显存与质量只按固定artifact、输入、chunk配置和seed验证。^[PR #8322]
- [MMH3-LATENT-1b] refinement 必须重建目标 layout 并以各模态自己的 sigma 重新加噪
  - 触发：修改 `latent_refine`、second-pass denoise、FL2VA keyframes、packed layout 或 cache reset。
  - 强制：请求值优先于 deployment default，false/null opt out；strength 为 `(0,1]`，从已有 schedule选择一个共同 start index，video/audio 分别用自己的 sigma 将先验 latent重新加噪并裁剪 schedule。每个 output seed独立完成 first pass→可选 upscale→可选 refine；refine会同时更新 video和audio。目标尺寸改变时清除 first-pass pad-sequence pin，重新 pack；
    - FL2VA在目标分辨率重新encode原keyframes，要求可用 local VAE encoder。每次 diffuse（包含每个 output 与 refine）reset TeaCache hook，并按本 pass实际 schedule length refresh Cache-DiT。
  - 验收：固定 seed核对独立 sigma、start index/step count、目标 shape和condition rows；多 outputs、refine带/不带upscale、FL2VA keyframe reencode和cache reset分别验证，错误localencoder/shape明确失败。^[PR #8322]
- [MMH3-LATENT-1c] 第二 denoise loop 只允许在有容量门禁的 request execution 中运行
  - 触发：修改 refinement admission、per-rank token limit、latent-tail/mask 编辑或 step执行兼容性。
  - 强制：first denoise前按实际 text/audio/video/condition rows、alignment 和 Ulysses degree估算目标 per-rank token count，并检查非负整数 `latent_refine_max_tokens_per_rank`（本提交默认 65536，0显式关闭门禁）；refine后的 spatial latent dimensions须满足patch divisibility。拒绝 latent-tail continuation和latent-mask editing与refine组合。
    - step execution只持有一个 latent/schedule，必须拒绝 refinement；upscale-only可在post_decode运行，不影响这一拒绝边界。
  - 验收：覆盖目标/conditions/SP degree的预算边界、invalid/zero limit、奇数target、tail/mask冲突和step明确拒绝；request refine与step upscale-only各走实际路径。^[PR #8322]

## 决策与踩坑

- [MMH3-LATENT-1a] 禁止：直接将已 normalized pipeline latent 当成 resizer训练输入；因为都是 `.pt` 就接受不同 architecture或任意目录首文件；异常后遗留 device residency；把跨全片 GroupNorm 的 chunked approximation写成 full-clip exact parity 或普遍画质提高。
- [MMH3-LATENT-1b] 禁止：对 video/audio使用同一个 sigma；带旧 shape、pad length或cache residual进入 second pass；只 upscale video却宣称 refinement只改视频、audio未变；复用缩小分辨率的 keyframe conditioning。
- [MMH3-LATENT-1c] 禁止：先跑昂贵 first pass才发现目标超过限额；把默认预算当成所有设备的 OOM 保证；静默把 second loop塞进one-step contract；放宽限额而没有对应部署验证。
