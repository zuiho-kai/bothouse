---
name: 2026-04-28-profiling-and-model-loading-18
description: 2026-04-28 错题：patch 了 /mnt/models/modules/transformers_modules 但模型实际从 /root/.cache/huggingface/modules 加载，cache 路径取决于 HF_HOME / TRANSFORMERS_CACHE
metadata:
  scope: 只收 2026-04-28 patch 到错误 transformers modules cache 路径这一起事故及按 traceback 实际路径 patch 的解法；patch 被 snapshot 覆盖归 2026-04-28-profiling-and-model-loading-07
---
# 2026-04-28 — patch 了错误的 cache 路径

## 关键事实

- 源页：`knowledge/repos/vllm-omni/benchmark/incidents/2026-04-28-profiling-and-model-loading-18.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-04-28-profiling-and-model-loading-18`
- 归属：`repos/vllm-omni/benchmark`
- 状态：已验证
- 搜索词：patch 了错误的 cache 路径
- 影响范围：repos/vllm-omni/benchmark
- **症状**：patch 了 `/mnt/models/modules/transformers_modules/...` 但模型实际加载的是 `/root/.cache/huggingface/modules/transformers_modules/...`
- **根因**：不同环境下 transformers modules cache 路径不同，取决于 `HF_HOME` / `TRANSFORMERS_CACHE` / 默认值
- **解法**：看 traceback 里的实际文件路径，patch 那个路径。同时 patch snapshot 源文件防止被覆盖
- **对未来的提醒**：先跑一次看 traceback 确认实际加载路径，再 patch
