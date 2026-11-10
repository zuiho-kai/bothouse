---
name: painterly-overview
description: HunyuanImage3 Painterly 历史错题索引：18 篇 2026-05-05 至 05-08 的错题表，含 conditioning 路径排除链、调查方法踩坑、PSNR 对比踩坑、BF16/FP32 gate 根因与被推翻的解释（process_weights_after_loading 双调用）、静默 bug 与 IT2I 输出尺寸误判
metadata:
  scope: 只收 Painterly 系列 18 篇错题的标题与指向；各篇正文归表中各页，上一级错题目录归 hunyuan-image3-incidents-overview
---
# HunyuanImage3 Painterly 历史错题

## 现状

| 错题 | 查看哪里 |
|---|---|
| 2026-05-05 — Rebase cr/pr3107-fix → vllm-omni main (45 commits) 不修 painterly | [[2026-05-05-painterly-conditioning-ablation-01]]（2026-05-05-painterly-conditioning-ablation-01） |
| 2026-05-05 — VAE encode + instantiate_vae_image_tokens + UNetDown 全链路数值审计 → 数值层完全清白 | [[2026-05-05-painterly-conditioning-ablation-02]]（2026-05-05-painterly-conditioning-ablation-02） |
| 2026-05-05 — Cond_vae / cond_vit 双消融 → painterly 与 conditioning 路径完全无关 | [[2026-05-05-painterly-conditioning-ablation-03]]（2026-05-05-painterly-conditioning-ablation-03） |
| 2026-05-05 — 主观对图先于 grep 日志，导致 "FA3 是 bug" 误判 | [[2026-05-05-painterly-debug-methodology-misses-01]]（2026-05-05-painterly-debug-methodology-misses-01） |
| 2026-05-05 — SigLIP2 输出 std=0.06 看起来"坍缩"，没核对 HF 参考就跳到 root cause | [[2026-05-05-painterly-debug-methodology-misses-02]]（2026-05-05-painterly-debug-methodology-misses-02） |
| 2026-05-05 — 尝试 swap SigLIP2 实现时连续踩 3 个接口错 | [[2026-05-05-painterly-debug-methodology-misses-03]]（2026-05-05-painterly-debug-methodology-misses-03） |
| 2026-05-05 — 远端代码累积多个改变行为的 patch 没回退，影响后续诊断 | [[2026-05-05-painterly-debug-methodology-misses-04]]（2026-05-05-painterly-debug-methodology-misses-04） |
| 2026-05-05 — 一次翻 5 个 cuDNN/CUBLAS 旋钮 + CUBLAS_WORKSPACE_CONFIG，把容器跑崩 | [[2026-05-05-painterly-debug-methodology-misses-05]]（2026-05-05-painterly-debug-methodology-misses-05） |
| 2026-05-06 — HF 自己跟自己重跑 PSNR 也只有 10-12 dB | [[2026-05-06-painterly-psnr-pitfalls-01]]（2026-05-06-painterly-psnr-pitfalls-01） |
| 2026-05-06 — 凭空想象 "KV cache transfer" 这个不存在的机制，拍头给方案 | [[2026-05-06-painterly-psnr-pitfalls-02]]（2026-05-06-painterly-psnr-pitfalls-02） |
| 2026-05-06 — 跨实现 PSNR 对比没做 fair-comparison 设置就跑，浪费一轮 GPU 时间 | [[2026-05-06-painterly-psnr-pitfalls-03]]（2026-05-06-painterly-psnr-pitfalls-03） |
| 2026-05-06 — ROOT CAUSE FOUND: BF16 vs FP32 gate routing in DiT MoE | [[2026-05-06-painterly-root-cause-01]]（2026-05-06-painterly-root-cause-01） |
| 2026-05-06 — META REFLECTION: 5h 走错工具栈，同事一个 hint 30 分钟定位 | [[2026-05-06-painterly-root-cause-02]]（2026-05-06-painterly-root-cause-02） |
| 2026-05-06 — 我的 FP32 routing 根因解释**也是错的**：真正的 bug 是 `process_weights_after_loading` 双调用 | [[2026-05-06-painterly-root-cause-03]]（2026-05-06-painterly-root-cause-03） |
| 2026-05-06 — `user_prompt` vs `prompt` 离线 bug 我跑了 5 次都没踩到，被同事一句话点出 | [[2026-05-06-painterly-silent-bugs-01]]（2026-05-06-painterly-silent-bugs-01） |
| 2026-05-07 — HunyuanImage3 AR 带图 greedy 输出每次跑不一致 | [[2026-05-07-painterly-silent-bugs-02]]（2026-05-07-painterly-silent-bugs-02） |
| 2026-05-08 — Plan 阶段把 IT2I 输出尺寸逻辑整反了，靠用户截图被打脸 | [[2026-05-08-painterly-plan-size-misjudge-01]]（2026-05-08-painterly-plan-size-misjudge-01） |
| 2026-05-08 — 同会话第二次踩"input1 驱动下游"，shared-bucket 又来一次 | [[2026-05-08-painterly-plan-size-misjudge-02]]（2026-05-08-painterly-plan-size-misjudge-02） |

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/incidents/painterly/_index.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter
