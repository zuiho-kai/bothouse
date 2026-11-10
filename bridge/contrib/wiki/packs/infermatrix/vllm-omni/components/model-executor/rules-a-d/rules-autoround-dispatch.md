---
name: rules-autoround-dispatch
description: "AutoRound NVFP4 method dispatch 合同 EXEC-AUTOROUND-NVFP4-1a（PR #7721）：OmniINCConfig 的 SUPPORTED_DTYPES 接纳 nv_fp，config_parser.resolve(layer,prefix) 判定 runtime layer，量化 LinearBase 复用 upstream CompressedTensorsW4A4Fp4 scheme 与 CompressedTensorsLinearMethod，excluded Linear 返回 UnquantizedLinearMethod，保留 MXFP4/MXFP8 与 stage-prefix 映射边界"
metadata:
  scope: 只收共享 OmniINCConfig 的 nv_fp 支持与 quant method selection 一条规则 EXEC-AUTOROUND-NVFP4-1a；INC/AutoRound 配置解析规则 VLLM-OMNI-PR8870-INC-PARSER 归 rules-inc-autoround，Drama 3 hybrid INT4 归 rules-drama3-quant
---
# AutoRound NVFP4 method dispatch 合同

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/model-executor/rules-autoround-dispatch.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components；created: 2026-10-09；updated: 2026-10-09
- 来源（sources）：PR #7721
- 置信度（confidence）：high
- [EXEC-AUTOROUND-NVFP4-1a] Omni INC 复用 upstream FP4 scheme 并保留 exclusion
  - 触发：修改共享 OmniINCConfig 的 nv_fp 支持或 quant method selection。
  - 强制：SUPPORTED_DTYPES 接纳 nv_fp；由 config_parser.resolve(layer,prefix) 判定 runtime layer，量化 LinearBase 使用 upstream CompressedTensorsW4A4Fp4 scheme 与 CompressedTensorsLinearMethod；excluded Linear 返回 UnquantizedLinearMethod，非 Linear 返回 None。保留 MXFP4/MXFP8 与 stage-prefix 映射的既有边界。
  - 验收：真实 config/method selection 覆盖 int4/mxfp4/nvfp4 与 excluded/nonlinear，mock 仅隔离 kernel initialization；检查 scheme/method/packing 字段，GPU 数值与 checkpoint加载另走实测。 ^[PR #7721]

## 决策与踩坑

- [EXEC-AUTOROUND-NVFP4-1a] 禁止：为同一 NVFP4 ABI 新写重复 linear/scheme；忽略 per-layer exclusion；在 CPU config 测试初始化真实 GPU kernel。
