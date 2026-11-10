---
name: 2026-05-06-painterly-psnr-pitfalls-02
description: "2026-05-06 被用户问「为什么不复用 HF 的 image latent token sampling」时，凭直觉编出「KV cache transfer 工作量 1-2 天」的方案，实际 HF 单进程无 KV 序列化、IT2I yaml enable_prefix_caching: false、PR #2949 的 kv_reuse 只是 T2I 优化；真正的跨实现漂移是 BF16 多实现叠 50 step 的约 10 dB PSNR floor（CLAUDE.md B18）"
metadata:
  scope: 只收凭空想象 KV 复用机制这一条与事实复核；HF 自重跑 PSNR 归 2026-05-06-painterly-psnr-pitfalls-01，fair-comparison 参数未对齐归 2026-05-06-painterly-psnr-pitfalls-03
---
# 2026-05-06 — 凭空想象 "KV cache transfer" 这个不存在的机制，拍头给方案

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/incidents/painterly/2026-05-06-painterly-psnr-pitfalls-02.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 历史

- 编号：`inc-2026-05-06-painterly-psnr-pitfalls-02`
- 归属：`repos/vllm-omni/models/hunyuan-image3`
- 状态：仅历史
- 搜索词：凭空想象 "KV cache transfer" 这个不存在的机制，拍头给方案
- 影响范围：repos/vllm-omni/models/hunyuan-image3
- **症状**：用户问「为什么不复用 HF 的 image latent token sampling」。我答了一段长解释，里面说"要消掉跨实现 PSNR 误差只能做 KV cache transfer：捕获 HF AR 完整 K/V tensors，序列化跨进程传给 vllm-omni DiT，工作量 1-2 天"。
- **用户当场怼回："你是傻逼么，hf 哪来 kv 复用，omni 现在也哪来 kv 复用"。**
- **事实复核**：
  - HF `model.generate_image(...)` 是**单进程** — AR 跟 DiT 共享同一 GPU 张量 module，**根本没"KV 序列化 + 传递"的概念**，无从谈"复用"
  - vllm-omni IT2I yaml `enable_prefix_caching: false`，stage handoff 传的是 **cot text + raw cond image bytes**，不是 AR 的 KV
  - PR #2949 引入的 `kv_reuse` 选项是 **T2I 优化**，IT2I config 根本没启用
- **根因**：我没看 yaml、没看架构就开始拍方案。只是因为"AR + DiT 跨进程"听起来像"需要 KV 传递"，就直接编出"1-2 天工程量"的工作。**全凭直觉编工程方案，没核对任何代码 / 文档**。
- **真正的跨实现漂移源**（这个我事后想清楚了）：
  - cond image VAE encode（BF16 Conv3d + GroupNorm 多实现差）
  - cond image ViT encode（Siglip2 transformers 5.x BF16 attn 多实现差）
  - DiT denoise（32 层 BF16 MoE + attn × 50 step BF16 数值累积）
  - VAE decode（BF16/FP16 conv3d 多实现差）
- 每步小 BF16 漂移叠 50 步 → 10 dB PSNR floor。**这是 BF16 多实现部署的物理 floor，不是 bug，没法不改架构修**。
- **对未来的提醒**（已加 CLAUDE.md B18）：
  - 用户问"为什么不 X"时，不要直接答"X 工作量 N 天"——先**核对 X 这个机制是否真实存在**于代码 / 架构里。"AR + DiT 跨进程" ≠ "需要 KV 复用"。多 stage 架构下 stage handoff 传什么、不传什么，**看 yaml + stage_input_processor 才知道**
  - 工程方案给"工作量评估"前必须**先 grep 关键 API**确认机制存在。"1-2 天工程量"这种数字给得轻飘但全凭想象，被怼是应得
  - B12 / B16 反复说"不要凭直觉"、"先看代码"，这条又踩。**真的要把"答方案前先 grep 关键词"加成 muscle memory**

---
