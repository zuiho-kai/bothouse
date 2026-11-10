---
name: 2026-04-23-profiling-and-model-loading-01
description: 2026-04-23 错题：accuracy test 没做侦察跑了 4 小时，HF_HUB_OFFLINE=1 下 judge 模型未预下载报 LocalEntryNotFoundError
metadata:
  scope: 只收 2026-04-23 accuracy test 漏下载 judge 模型这一起事故的症状、根因和提醒；同日连续多配置 OOM 归 2026-04-23-profiling-and-model-loading-02
---
# 2026-04-23 — 没做侦察 + judge 模型未预下载

## 关键事实

- 源页：`knowledge/repos/vllm-omni/benchmark/incidents/2026-04-23-profiling-and-model-loading-01.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-04-23-profiling-and-model-loading-01`
- 归属：`repos/vllm-omni/benchmark`
- 状态：已验证
- 搜索词：没做侦察 + judge 模型未预下载
- 影响范围：repos/vllm-omni/benchmark

### 原文件说明

### Error Book: Profiling & 模型加载

- **症状**：跑了 4 小时才跑通；judge 报 `LocalEntryNotFoundError`
- **根因**：没做侦察 + `HF_HUB_OFFLINE=1` 下 judge 模型遗漏
- **提醒**：accuracy test 涉及 generate + judge 两个模型，都要预下载
