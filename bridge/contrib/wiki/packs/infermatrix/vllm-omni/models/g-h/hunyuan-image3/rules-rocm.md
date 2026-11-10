---
name: rules-rocm
description: "HunyuanImage3 ROCm 规则 HUNYUAN3-ROCM-1a、HUNYUAN3-ROCM-1b：HunyuanImage3ForCausalMM 的 VAE 不替换为 AITER GroupNorm；accuracy PSNR floor 按平台分支（NPU 26、ROCm 29），mean / p99 error gate 保持 3e-2 / 3e-1（PR #7934）"
metadata:
  scope: 只收 HunyuanImage3 在 ROCm 上的 VAE GroupNorm 豁免与 accuracy 阈值两条规则；HunyuanImage3 的通用开发规则归 hunyuan-image3-rules-1、hunyuan-image3-rules-2
---
# HunyuanImage3 ROCm VAE 与 accuracy 合同

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/rules-rocm.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models；created: 2026-10-09；updated: 2026-10-09
- 来源（sources）：PR #7934
- 置信度（confidence）：high
- [HUNYUAN3-ROCM-1a] HunyuanImage3 VAE 不替换为 AITER GroupNorm
  - 触发：修改 ROCm patch_groupnorm 或 HunyuanImage3 VAE 初始化。
  - 强制：具备 VAE 且模型类为 HunyuanImage3ForCausalMM 时保留原 model/GroupNorm；其他符合现有资格的模型继续走 AITER 替换。
  - 验收：检查 Hunyuan 原实例与 GroupNorm 不变，非 Hunyuan 的 eligible 模型仍替换；真实 VAE accuracy 另走硬件 gate。 ^[PR #7934]
- [HUNYUAN3-ROCM-1b] accuracy floor 按平台分支且保留其余误差 gate
  - 触发：修改 HunyuanImage3 similarity test、ROCm stage config 或平台选择。
  - 强制：先处理 NPU/ROCm，再进入 CUDA SKU 阈值表；对应 PSNR floor 为 NPU 26、ROCm 29，mean/p99 error gate 仍为 3e-2/3e-1。ROCm stage 的 moe_backend 保留 auto。
  - 验收：覆盖平台分支与 CUDA 设备表，核对 retained metric gates 和 ROCm args；结果绑定实际设备/拓扑，不添加无证据的首次支持版本。 ^[PR #7934]

## 决策与踩坑

- [HUNYUAN3-ROCM-1a] 禁止：把本模型豁免扩成所有 ROCm 模型禁用 AITER，或改动 VAE 数值路径却只检验类型。
- [HUNYUAN3-ROCM-1b] 禁止：由 CUDA capability 给 ROCm 选阈值；放宽其他误差 gate，或把非阻塞 nightly 配置说成已通过所有硬件验证。
