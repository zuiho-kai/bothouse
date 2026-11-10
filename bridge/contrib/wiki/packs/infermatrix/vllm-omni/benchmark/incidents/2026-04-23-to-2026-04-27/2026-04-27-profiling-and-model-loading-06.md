---
name: 2026-04-27-profiling-and-model-loading-06
description: 2026-04-27 错题：HF 官方 HunyuanImage3 pipeline 在 L20X 云实例上 generate_image() 报 HunyuanStaticCache 无 layers 属性，transformers 4.50.0 与 5.6.2 都不兼容
metadata:
  scope: 只收 2026-04-27 HF 官方 baseline 因 trust_remote_code 代码与 transformers 版本夹缝跑不通这一起事故的症状、根因、尝试和结论；Siglip2VisionModel 的 5.x 属性变化归 2026-04-27-profiling-and-model-loading-05
---
# 2026-04-27 — HF 官方 pipeline 无法在 L20X 云实例上跑通

## 关键事实

- 源页：`knowledge/repos/vllm-omni/benchmark/incidents/2026-04-27-profiling-and-model-loading-06.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-04-27-profiling-and-model-loading-06`
- 归属：`repos/vllm-omni/benchmark`
- 状态：已验证
- 搜索词：HF 官方 pipeline 无法在 L20X 云实例上跑通
- 影响范围：repos/vllm-omni/benchmark
- **症状**：`AutoModelForCausalLM.from_pretrained` 加载成功，但 `generate_image()` 时 `HunyuanStaticCache` 报 `AttributeError: 'HunyuanStaticCache' object has no attribute 'layers'`
- **根因**：模型仓库的 `trust_remote_code` Python 文件引用了 transformers 新版 `StaticCache` API（有 `layers` 属性），但 transformers 4.50 的 `StaticCache` 没有该属性；升级 transformers 则 `lazy_initialization()` 签名不匹配
- **尝试**：
  - transformers 5.6.2 → `StaticLayer.lazy_initialization() missing 1 required positional argument`
  - transformers 4.50.0 → `HunyuanStaticCache has no attribute 'layers'`
  - 清除 `~/.cache/huggingface/modules/` + `HF_HUB_OFFLINE=1` → 同样报错
- **结论**：模型仓库代码处于版本夹缝中，需要找到精确匹配的 transformers 版本（可能 ~4.52-5.0）或 pin 模型仓库 commit revision
- **对未来的提醒**：跑 HF 官方 baseline 前先确认 transformers 版本兼容范围，用 `--revision` pin 到已知可用的 commit
