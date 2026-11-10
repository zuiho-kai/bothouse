---
name: lingbot-video-overview
description: "LingBot-Video 目录入口（PR #5311）：LingBotVideoPipeline 同时服务 dense 1.3B 与 MoE 30B-A3B checkpoint，已有 T2V 并加 T2I 与单图 TI2V、在线走 /v1/images/generations 与 /v1/videos、当前仅单 request / 单 output / 至多一张参考图，SP、offload、FP8 experts、Cache-DiT 等均未暴露"
metadata:
  scope: 只收架构键、模式、当前公开范围、owner 边界与何时查；LBV-1a 至 LBV-2b 规则正文归 lingbot-video-rules
---
# LingBot-Video

## 现状

- registry architecture：`LingBotVideoPipeline`；dense 1.3B 与 MoE 30B-A3B checkpoint 共用 pipeline，transformer 的 dense/MoE 实现不因 T2I/TI2V 接入而分叉。
- 模式：已有 T2V，加 T2I 与单图 TI2V；离线走共享 text-to-image/image-to-video prompt builder，在线分别走 `/v1/images/generations` 与 `/v1/videos`。
- 当前公开范围仅单 request、单 output、最多一张 reference image；Refiner、生产 serving 的 SP/USP/HSDP/CFG parallel/VAE patch parallel、component/layerwise offload、EP/FusedMoE、FP8 experts 与 Cache-DiT 均未暴露或缺少已落地证据（内部 `_generate` 已有 CFG-parallel 参数，不能据此宣称 serving 可用）。
- owner 边界：共享入口传播/4xx 合同先查 [[serving-rules-1]]、[[serving-rules-2]]、[[serving-rules-3]]（Serving rules），通用 diffusion lifecycle 查 [[diffusion-rules-1]]、[[diffusion-rules-2]]、[[diffusion-rules-3]]（Diffusion rules），本模型的 mode、帧数、图像条件和输出 key 查 [[lingbot-video-rules]]（rules）。

### 什么时候查这里

- PR 涉及 `lingbot_video`、`LingBotVideoPipeline`、T2I/T2V/TI2V 选择、LingBot 分辨率预设、causal-VAE 帧网格或首帧条件。
- 性能数字只能回到可复现 benchmark；本页不把 PR 的单机耗时/显存结果升级为 gate。
- decoded keyed media 的 zero-to-one range：LBV-2b；沿本目录 rules 审查入口核对。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/lingbot-video/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, models, diffusion；created: 2026-08-10；updated: 2026-10-06
- 来源（sources）：vllm_omni/diffusion/models/lingbot_video/；vllm_omni/model_extras/lingbot_video.py；vllm_omni/diffusion/registry.py；PR #5311
