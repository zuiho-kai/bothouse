---
name: 2026-04-28-profiling-and-model-loading-14
description: 2026-04-28 错题：generate_image(diff_infer_steps=10) 不生效仍跑默认 50 步，diff_infer_steps 是 generation_config 的属性而非 kwarg
metadata:
  scope: 只收 2026-04-28 diff_infer_steps 传参位置错误这一起事故及 model.generation_config.diff_infer_steps 的解法；错题总表见 benchmark-incidents-overview
---
# 2026-04-28 — diff_infer_steps 参数不是 generate_image 的 kwarg

## 关键事实

- 源页：`knowledge/repos/vllm-omni/benchmark/incidents/2026-04-28-profiling-and-model-loading-14.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-04-28-profiling-and-model-loading-14`
- 归属：`repos/vllm-omni/benchmark`
- 状态：已验证
- 搜索词：diff_infer_steps 参数不是 generate_image 的 kwarg
- 影响范围：repos/vllm-omni/benchmark
- **症状**：`generate_image(diff_infer_steps=10)` 传了但模型跑了 50 步（默认值）
- **根因**：`diff_infer_steps` 是 `generation_config` 的属性，不是 `generate_image` 的 kwarg。pipeline 从 `gen_config.diff_infer_steps` 读取
- **解法**：`model.generation_config.diff_infer_steps = 10`
- **对未来的提醒**：HF 模型的 diffusion 参数在 `generation_config` 里，不在 `generate_image` kwargs 里
