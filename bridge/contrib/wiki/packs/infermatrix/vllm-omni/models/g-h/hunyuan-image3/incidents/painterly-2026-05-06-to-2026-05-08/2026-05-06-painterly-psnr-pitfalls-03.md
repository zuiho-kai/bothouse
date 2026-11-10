---
name: 2026-05-06-painterly-psnr-pitfalls-03
description: 2026-05-06 painterly fix 验证时跨实现 PSNR=8.96 dB 的 false alarm：vllm-omni 用 guidance-scale 5.0 与 stage_config 采样参数（temperature=0.6、top_p=0.95、top_k=1024），HF 用默认 guidance 2.5，两边都在 sampling mode；跨实现对比须 greedy 并显式对齐 prompt / image / seed / guidance_scale / bot_task / steps / output_size 等参数（CLAUDE.md B17）
metadata:
  scope: 只收没对齐 fair-comparison 参数就跑 PSNR 的这一条与对齐清单；HF 自重跑 PSNR 方差归 2026-05-06-painterly-psnr-pitfalls-01，KV 复用机制的凭空想象归 2026-05-06-painterly-psnr-pitfalls-02
---
# 2026-05-06 — 跨实现 PSNR 对比没做 fair-comparison 设置就跑，浪费一轮 GPU 时间

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/incidents/painterly/2026-05-06-painterly-psnr-pitfalls-03.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 历史

- 编号：`inc-2026-05-06-painterly-psnr-pitfalls-03`
- 归属：`repos/vllm-omni/models/hunyuan-image3`
- 状态：仅历史
- 搜索词：跨实现 PSNR 对比没做 fair-comparison 设置就跑，浪费一轮 GPU 时间
- 影响范围：repos/vllm-omni/models/hunyuan-image3
- **症状**：painterly fix 验证后想跟 HF reference 算 PSNR，跑了 doggy + 新年宠物海报 setup。vllm-omni 出图（粉红海报 + 多面板文字）vs HF 出图（红幕背景 + 单标题 + 狗狗中央），**视觉布局完全不同**，PSNR=8.96 dB。看起来"差很大"但其实是我**没对齐参数就跑**：
  - vllm-omni 跑：`--guidance-scale 5.0`（CLI 我手填的）+ stage_config `temperature=0.6, top_p=0.95, top_k=1024`（sampling mode）
  - HF 跑：`generate_image(...)` **没传 guidance_scale**（HF default=2.5）+ AR 默认 sampling
- **两套都在 sampling mode + guidance_scale 差 2x**，相同 seed=42 在两套 RNG 实现里 sample 出**不同 cot token sequence** → DiT 输入不同 → 出图布局不同。这是**纯采样随机性**，不是模型 bug。
- 更糟的是：lastwords 早就写过：

> "Force greedy decoding on both sides (do_sample=False, temperature=0) -- per the runbook this is the only mode where the comparison is reproducible; **sampling-mode RNG primitives between vLLM and HF are fundamentally different so byte-equality is unachievable**."

- 我有这个 memory，但**跑实验前没回头看**，直接拿默认 sampling 参数开跑。结果浪费 ~5 分钟 GPU 时间 + 用户时间审误差 + 一次写"看起来 PSNR 很差"的 false alarm 报告。
- **根因**：跨实现 PSNR 测试前没列 fair-comparison checklist。两边的"默认值"（guidance_scale / temperature / top_p / top_k / bot_task / output_size / decoding mode）都不约而同**没对齐**。
- **对未来的提醒**（已加 CLAUDE.md B17 + style_bias_debug_methodology.md fair-comparison checklist 章节）：
  - **跨实现 PSNR 对比必须 greedy mode**（temperature=0, do_sample=False, top_k=1）—— 消除 sampling RNG 差异，让 AR 输出 byte-deterministic
  - **跑前必须显式对齐**这 8 项参数：prompt / 输入 image bytes / seed / temperature / top_p / top_k / **guidance_scale** / bot_task / steps / output_size。**默认值跨实现几乎从来不一样**（HF model defaults 跟 vllm-omni stage_config defaults 各管各的）
  - 8-15 dB PSNR 在 sampling mode 是 **expected floor**（lastwords 已记录），看到这个数字别声称"DiT 有问题"——sampling mode 跨实现就这水平
