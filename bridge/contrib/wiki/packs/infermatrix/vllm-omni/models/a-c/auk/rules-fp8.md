---
name: rules-fp8
description: "AuK 规则 AUK-2d：online FP8 只替换合格的 DiT token/block Linear（先拒 HIP，CUDA capability >=8.9 且 <10，E4M3 权重，尺寸 16 对齐），先验证全部 ignored module names 再替换，且在 compile/capture 之前完成（PR #8442、PR #8643）"
metadata:
  scope: 只收 AuK online FP8 量化的资格、替换顺序和验收；AuK 的请求、DiT graph 与 codec 规则 AUK-1a 至 AUK-3d 归 auk-rules
---
# AuK online FP8 量化资格与验证

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/auk/rules-fp8.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models；created: 2026-10-09；updated: 2026-10-09
- 来源（sources）：PR #8442；PR #8643
- 置信度（confidence）：high
- [AUK-2d] FP8 只替换合格 DiT Linear 并在 compile/capture 前完成
  - 触发：修改 AuK fp8_linear、quantization 选择或忽略模块配置。
  - 强制：先拒绝 HIP，再查询 NVIDIA capability；仅 CUDA capability >=8.9 且 <10 的支持路径启用；token/block Linear 使用 E4M3 权重及对应 scale，activation scale 为 FP32 unit 并按实现 saturate，尺寸满足 16 对齐。先验证全部 ignored module names 再替换任何层，替换在 compile/capture 之前；未知 quantization method 明确报错。
  - 验收：覆盖 eligibility、ignore validation 原子性、尺寸、scale 与方法拒绝；数值 oracle 及真实音频质量按相同 head/seed/workload 比较，latency 与质量分开报告，不沿用单次毫秒数字。 ^[PR #8442] ^[PR #8643]

## 决策与踩坑

- [AUK-2d] 禁止：量化未声明的 encoder/codec；半替换后才因无效 ignore 名失败；把 FP8 较近的输出说成 BF16 完全等价。
