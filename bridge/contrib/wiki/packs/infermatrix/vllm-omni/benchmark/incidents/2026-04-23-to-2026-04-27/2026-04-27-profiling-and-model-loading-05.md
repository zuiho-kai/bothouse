---
name: 2026-04-27-profiling-and-model-loading-05
description: 2026-04-27 错题：transformers 5.6.2 的 Siglip2VisionModel 不再有嵌套 .vision_model 属性，pipeline_hunyuan_image3.py 第 114 行报 AttributeError
metadata:
  scope: 只收 2026-04-27 Siglip2VisionModel 在 transformers 5.x 的属性变化这一起事故的症状、根因、解法和提醒；HF 官方 pipeline 的 StaticCache 版本夹缝归 2026-04-27-profiling-and-model-loading-06
---
# 2026-04-27 — Siglip2VisionModel 版本不兼容 (transformers 5.6.2)

## 关键事实

- 源页：`knowledge/repos/vllm-omni/benchmark/incidents/2026-04-27-profiling-and-model-loading-05.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-04-27-profiling-and-model-loading-05`
- 归属：`repos/vllm-omni/benchmark`
- 状态：已验证
- 搜索词：Siglip2VisionModel 版本不兼容 (transformers 5.6.2)
- 影响范围：repos/vllm-omni/benchmark
- **症状**：`AttributeError: 'Siglip2VisionModel' object has no attribute 'vision_model'`
- **根因**：transformers 5.x 中 `Siglip2VisionModel` 不再有嵌套 `.vision_model` 属性
- **解法**：远端 `pipeline_hunyuan_image3.py:114` 去掉 `.vision_model` 后缀
- **提醒**：新环境先验证核心模块 API：`python -c "from X import Y; print(dir(Y(...)))"`
