---
name: 2026-06-17-profiling-and-model-loading-20
description: 2026-06-17 错题：LTX2.3 T2V mask-sync 优化把 encoder_attention_mask 提前包成 AttentionMetadata，graph accuracy SSIM 0.9338 / 0.9340 低于 0.94 阈值，dtype-only 对照 SSIM 0.9634 通过
metadata:
  scope: "只收 2026-06-17 LTX2.3 PR #4464 mask-sync 实验掉精度这一起事故的症状、根因、已验证的 accuracy run 和禁止重复的做法；同日 eager trace 与 graph benchmark 混用归 2026-06-17-profiling-and-model-loading-19"
---
# 2026-06-17 — LTX2.3 mask-sync 优化看似减同步但会改精度

## 关键事实

- 源页：`knowledge/repos/vllm-omni/benchmark/incidents/2026-06-17-profiling-and-model-loading-20.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-06-17-profiling-and-model-loading-20`
- 归属：`repos/vllm-omni/benchmark`
- 状态：已验证
- 搜索词：LTX2.3 mask-sync 优化看似减同步但会改精度
- 影响范围：repos/vllm-omni/benchmark
- **症状**：为减少 graph mode 下 prompt attention mask 的 `torch.any(~attention_mask)`、`_get_unpad_data()`、`.item()` 等重复同步，尝试在 LTX2.3 T2V 中提前把 `encoder_attention_mask` 包装成 `AttentionMetadata` 并传给 FlashAttention。
  - 单元测试能证明部分 mask 形状和值正确，但真实 LTX2.3 graph accuracy 失败：mask-sync candidate 的 PPM similarity 只有 SSIM `0.9338` / `0.9340`，低于 `0.94` 阈值。dtype-only 对照在同一 head `f19a26dd1448430346c5f31e9973ef6579895bbd` 上通过，SSIM `0.9634`、PSNR `36.67`，所以精度退化来自 mask-sync 实验，不是 dtype 前置 cast。
- **根因**：
  - 第一个实现直接从 pipeline/transformer 顶层构造 `AttentionMetadata`，绕过了 LTX2.3 原来的 `2D mask -> additive bias -> attn.prepare_attention_mask -> head view -> _to_padding_mask` 路径。原始 float `0/1` mask 如果直接走 `_to_padding_mask`，`0 >= 0` 会被当成 valid，padding 语义会错。
  - 第二个实现改成 additive mask 后再构造 metadata，但仍提前绕过每层 processor 的 mask prepare/shape path；真实 accuracy 仍失败，说明 LTX2.3 prompt mask 不能只靠“看起来等价的 2D padding mask”替代原路径。
  - 预计算 `_upad_input` 的 indices/cu_seqlens 不是唯一问题；即使只缓存 dense/has-padding 判断、不复用 unpad data，也会掉精度。
- **已验证证据**：
  - dtype-only PR 分支：`<REMOTE_WORK_ROOT>/wt-ltx23-t2v-graph-opt-pr4464-dtype`，run `<REMOTE_WORK_ROOT>/ltx23_dtype_only_pr4464_accuracy_candidate_20260617_170834`，`passes_thresholds=true`。
  - mask-sync full metadata candidate：`<REMOTE_WORK_ROOT>/ltx23_mask_sync_pr4464_accuracy_candidate_20260617_170042`，SSIM `0.9337558`，失败。
  - mask-sync dense-only candidate：`<REMOTE_WORK_ROOT>/ltx23_mask_sync_pr4464_accuracy_candidate_20260617_171809`，SSIM `0.9337558`，失败。
  - mask-sync after `attn.prepare_attention_mask` candidate：`<REMOTE_WORK_ROOT>/ltx23_mask_sync_pr4464_accuracy_candidate_20260617_172652`，SSIM `0.9340195`，失败。
- **遗留问题 / 禁止重复踩坑**：
  - 不要再从 LTX2.3 pipeline 或 transformer 顶层直接用 prompt mask 构造 `AttentionMetadata` 来替代 processor mask path，除非先做逐层对齐：baseline 与 candidate 的 `attention_mask` shape/value、backend branch、FlashAttention call 输入必须逐项一致。
  - mask 同步优化下一步只能在不改变原 mask path 的地方做，例如 backend 内部只优化 dense no-mask fast path、或在 processor 内缓存完全等价的 prepared mask，并先通过带 padding prompt 的 LTX2.3 graph accuracy。
  - 任何“mask 优化很快”的性能数字，在 accuracy 通过前都只能叫 invalid candidate，不能进入 PR、benchmark 表或对外结论。
