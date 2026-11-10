---
name: 2026-04-28-profiling-and-model-loading-07
description: 2026-04-28 错题：trust_remote_code 加载时 transformers 把 snapshot 的 .py 重新复制到 transformers_modules，modeling_hunyuan_image_3.py 的 patch 被反复覆盖
metadata:
  scope: 只收 2026-04-28 patch 被 snapshot 到 modules 缓存复制覆盖这一起事故及同时 patch 两个位置加 HF_HUB_OFFLINE=1 的解法；patch 到错误 cache 路径归 2026-04-28-profiling-and-model-loading-18，monkey-patch 不生效归 2026-04-28-profiling-and-model-loading-17
---
# 2026-04-28 — trust_remote_code 模型的 patch 被反复覆盖

## 关键事实

- 源页：`knowledge/repos/vllm-omni/benchmark/incidents/2026-04-28-profiling-and-model-loading-07.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-04-28-profiling-and-model-loading-07`
- 归属：`repos/vllm-omni/benchmark`
- 状态：已验证
- 搜索词：trust_remote_code 模型的 patch 被反复覆盖
- 影响范围：repos/vllm-omni/benchmark
- **症状**：patch 了 `modeling_hunyuan_image_3.py` 的 SDPA attn_mask dtype，重跑后 patch 消失，报同样的错
- **根因**：`trust_remote_code=True` 加载时，transformers 从 snapshot 目录重新复制 `.py` 文件到 `~/.cache/huggingface/modules/transformers_modules/`，覆盖之前的 patch
- **解法**：必须**同时 patch 两个位置**的文件：
  - `/mnt/models/hub/models--xxx/snapshots/<hash>/modeling_hunyuan_image_3.py`（源）
  - `/mnt/models/modules/transformers_modules/<hash>/modeling_hunyuan_image_3.py`（缓存）
  - 并且设 `HF_HUB_OFFLINE=1` 防止从 HF Hub 重新下载
- **对未来的提醒**：trust_remote_code 模型的代码有三层缓存（HF Hub → snapshot → modules），patch 必须覆盖源头
