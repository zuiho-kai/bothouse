---
name: 2026-05-05-painterly-debug-methodology-misses-02
description: 2026-05-05 看到 SigLIP2 输出 std=0.06（1119/1152 channel 跨 patch std<0.01）就判定「vision tower 坍缩是 painterly 根因」，没对照 HF bundled Siglip2VisionTransformer（std=0.06015，diff mean=0.00003）：这是 post_layernorm 的设计行为
metadata:
  scope: 只收 SigLIP2 std 异常被误判为根因这一条；FA3 误判归 2026-05-05-painterly-debug-methodology-misses-01，swap SigLIP2 实现时的接口错归 2026-05-05-painterly-debug-methodology-misses-03
---
# 2026-05-05 — SigLIP2 输出 std=0.06 看起来"坍缩"，没核对 HF 参考就跳到 root cause

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/incidents/painterly/2026-05-05-painterly-debug-methodology-misses-02.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 历史

- 编号：`inc-2026-05-05-painterly-debug-methodology-misses-02`
- 归属：`repos/vllm-omni/models/hunyuan-image3`
- 状态：仅历史
- 搜索词：SigLIP2 输出 std=0.06 看起来"坍缩"，没核对 HF 参考就跳到 root cause
- 影响范围：repos/vllm-omni/models/hunyuan-image3
- **症状**：dump 出 `vit_raw` 看到 1119/1152 channel 跨 patches 的 std<0.01、overall std=0.06、token-token diff=0.0036，下意识判定 "SigLIP2 vision tower 坍缩，空间信息全丢，这就是 painterly 根因"。
- **根因**：std=0.06 是 SigLIP2 **post_layernorm 的设计行为**，HF bundled `siglip2.Siglip2VisionTransformer`（HunyuanImage3 训练时用的同一份代码）跑出来 std=0.06015、diff vs transformers 5.x 仅 mean=0.00003。两个实现数值等价，HF 参考也接受 std=0.06 conditioning 然后 DiT 能生成正常卡通——所以这个 std 不是 bug。
- **解法**：在标"SigLIP2 坍缩"为 root cause 之前，必须用同一份输入 + 同一份 weights 跑一次 HF 实现/官方 demo 对照，确认对方不是同样 std。`probe_hf_bundled_siglip.py` 模式：5 分钟独立 python 脚本，2 个实现 forward 一遍，print stats + diff。
- **对未来的提醒**：
  - "看起来不对" 的统计指标（坍缩、爆炸、零值）必须有 baseline 对照才算证据。HF 官方 demo / training-time bundled code 是首选 baseline
  - 模型设计本身可能有反直觉行为（attention sink token、outlier channel、post-LN 把跨 token 信息洗掉……）。"std 异常小" ≠ bug
  - "通过对比验证假设" 这个 step 要在 1 小时内做完，不要先写一堆 dump probe 然后才回头验证 baseline

---
