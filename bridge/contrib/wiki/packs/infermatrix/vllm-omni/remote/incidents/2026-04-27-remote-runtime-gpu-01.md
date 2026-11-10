---
name: 2026-04-27-remote-runtime-gpu-01
description: 2026-04-27 错题：transformers 5.x 下 Siglip2VisionModel 自身即 vision model，pipeline_hunyuan_image3.py:114 的 .vision_model 访问报 AttributeError，去掉后缀修复
metadata:
  scope: 只收 2026-04-27 这一起 Siglip2VisionModel 版本不兼容事故；vLLM 0.21 依赖不齐归 2026-05-18-remote-runtime-gpu-02
---
# 2026-04-27 — Siglip2VisionModel 版本不兼容 (transformers 5.6.2)

## 关键事实

- 源页：`knowledge/repos/vllm-omni/remote/incidents/2026-04-27-remote-runtime-gpu-01.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-04-27-remote-runtime-gpu-01`
- 归属：`repos/vllm-omni/remote`
- 状态：已验证
- 搜索词：Siglip2VisionModel 版本不兼容 (transformers 5.6.2)
- 影响范围：repos/vllm-omni/remote

### 原文件说明

### Error Book: 远端运行时 / GPU / 依赖

- **症状**：`AttributeError: 'Siglip2VisionModel' object has no attribute 'vision_model'`
- **根因**：transformers 5.x 中 `Siglip2VisionModel` 自身就是 vision model，不再有嵌套 `.vision_model`
- **解法**：`pipeline_hunyuan_image3.py:114` 去掉 `.vision_model` 后缀
- **对未来的提醒**：transformers API 变化频繁，跑新环境先 `python -c "from transformers import X; print(dir(X(...)))"`
