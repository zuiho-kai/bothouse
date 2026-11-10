---
name: 2026-04-27-profiling-and-model-loading-04
description: 2026-04-27 错题：DeployConfig.async_chunk 默认 True 且 HunyuanImage3 无 deploy YAML，hunyuan_image_3_moe 单阶段 pipeline 启动报 ValueError
metadata:
  scope: 只收 2026-04-27 async_chunk 默认值导致 HunyuanImage3 DIT_ONLY 启动失败这一起事故及 deploy YAML / --no-async-chunk 解法；错题总表见 benchmark-incidents-overview
---
# 2026-04-27 — async_chunk=True 默认值导致 HunyuanImage3 启动 ValueError

## 关键事实

- 源页：`knowledge/repos/vllm-omni/benchmark/incidents/2026-04-27-profiling-and-model-loading-04.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-04-27-profiling-and-model-loading-04`
- 归属：`repos/vllm-omni/benchmark`
- 状态：已验证
- 搜索词：async_chunk=True 默认值导致 HunyuanImage3 启动 ValueError
- 影响范围：repos/vllm-omni/benchmark
- **症状**：`ValueError: Pipeline 'hunyuan_image_3_moe' has async_chunk=True in deploy but no stage declares a next-stage input processor`
- **根因**：`DeployConfig.async_chunk` 默认 `True`；HunyuanImage3 没有 deploy YAML；DIT_ONLY 单阶段 pipeline 没有 next-stage processor
- **解法**：创建 `vllm_omni/deploy/hunyuan_image_3_moe.yaml`（`async_chunk: false`），或加 `--no-async-chunk`
- **提醒**：单阶段 diffusion 模型没有 deploy YAML 时必须加 `--no-async-chunk`
