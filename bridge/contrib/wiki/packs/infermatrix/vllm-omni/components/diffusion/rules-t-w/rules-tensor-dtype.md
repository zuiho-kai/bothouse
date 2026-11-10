---
name: rules-tensor-dtype
description: "Diffusion tensor dtype 规则 DIFF-1c、DIFF-1o、DIFF-NORM-1a：runtime tensor 从 consumer 派生 device/dtype 而 parameter 跟随 loader 的 set_default_torch_dtype 作用域（shared RMSNorm）；LTX latent 的 token-major layout、FP32 noising 与 `seed + 10000` ancestral 噪声流；shared RMSNorm 对 empty stream 走 native fallback（MammothModa2，PR #7489）"
metadata:
  scope: 只收混合精度下 runtime tensor/parameter dtype、LTX latent 精度边界与 shared RMSNorm empty-stream fallback 三条规则；Triton RMSNorm 融合 kernel 的设备门禁（DIFF-1w）归 rules-platform-kernels
---
# Diffusion tensor dtype 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/diffusion/rules-tensor-dtype.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, diffusion；created: 2026-09-03；updated: 2026-10-06
- 来源（sources）：PR #5067；PR #5068；PR #5174；PR #5981；Issue #5880；vllm_omni/diffusion/layers/norm.py；tests/diffusion/layers/test_norm.py；PR #6070；vllm_omni/diffusion/models/ltx2/ltx2_latents.py；PR #7489
- 置信度（confidence）：high
- [DIFF-1c] runtime tensor 派生 consumer dtype，parameter 跟随 loader 构造上下文
  - 触发：mixed precision pipeline 中新建 runtime mask/index/constant/buffer/precomputed tensor，或构造 shared layer parameter。
  - 强制：runtime tensor 从输入或目标权重派生 device/dtype，整数 index 显式使用 consumer 类型；graph/eager 与 batch reorder 后保持 shape、alias 和数值语义。parameter constructor 的 `dtype=None` 则读取 `torch.get_default_dtype()`，但只依赖 loader 的 `set_default_torch_dtype(od_config.dtype)` 构造作用域；显式 dtype 始终优先。
    - RMSNorm parameter storage dtype 与 `forward_native` FP32 accumulation 是两个独立合同。
  - 验收：runtime 路径覆盖 BF16、错长、batch reorder 和 graph/eager；constructor 覆盖 loader-scoped BF16、FP32 与显式 override。shared RMSNorm 被 HunyuanImage3、Cosmos3、MiniMax-H3、Wan2.2、Z-Image 等消费，修复不能只跑一个模型。
  - 证据边界：相同输入的 online/offline 与 retry 重复得到相同失败值，只支持“确定性数值漂移”；未绑定软件 commit、硬件与可复核 artifact 的截图不能建立跨硬件或 bit-exact parity。^[PR #5067] ^[PR #5068] ^[PR #5174] ^[PR #5981]
- [DIFF-1o] LTX latent layout 与混合精度边界必须保持官方顺序
  - 触发：修改 LTX-2/2.3/2.5 的 latent、guidance、sigma 或 ancestral sampler，并涉及 BF16/FP32 混合计算和请求级 generator。
  - 强制：生成和提供的 video latent 都保持官方 token-major storage layout；noising/conditioning 在 FP32 中按官方 lerp 顺序计算后再 materialize 为模型 dtype；velocity 使用 host scalar sigma，ancestral extra-noise 使用独立的 `seed + 10000` 流，并保持请求 generator 所有权。
  - 验收：对 2、2.3、2.5 参数化 seeded generated/provided latent 测试，逐值核对 layout、stride、后续 RNG 状态、FP32 noising 和 sigma arithmetic；ancestral step 再与固定官方 reference 对照，硬件 parity 必须固定 attention backend 与 checkpoint revision。^[PR #6070]
- [DIFF-NORM-1a] shared RMSNorm 必须对 empty stream 保持 native fallback 与明确精度边界
  - 触发：修改sharedRMSNorm的CUDA/HIPdispatch或MammothModa2caption/refiner/QKnorm替换。
  - 强制：compile或x.numel()==0走native，保留residual处理及fused异常fallback；替换Qwen2RMSNorm保持checkpoint参数名/shape/eps，包括captionembedder重建。共享FP32accumulation仍由DIFF-1c拥有。
  - 验收：CPU/acceleratorempty、residual、compilecontrol及checkpointload覆盖；真实Previewhidden/QKshape验证fusedpath被调用、相对旧路径一BF16step界及独立float64referenceerror；模型parity/性能不能从单kernel测试外推。 ^[PR #7489]

## 决策与踩坑

- [DIFF-1c] 禁止：runtime temporary 依赖环境中不受控的 process-default fp32/CPU 或隐式 cast/move；但不能把这条禁令错用于 loader-scoped parameter construction。不得把 Python 参数默认写死 fp32 来绕过 BF16 loader context，也不能只测 shape 而不执行真实 consumer。
- [DIFF-1o] 禁止：只对 LTX-2.5 应用 token-major layout；在 BF16 mask 上提前乘 `noise_scale`；直接用 CUDA scalar tensor 做 sigma 除法；让 padding 或共享全局 RNG 改变请求的随机状态；仅凭 shape 和可运行性宣称数值 parity。
- [DIFF-NORM-1a] 禁止：对CFG无条件branch的zero-tokenstreamlaunch fusedkernel；将一次rounding的shared/fused结果宣称与先cast后weightmultiply的Qwen2路径bit-identical；fallback结果冒充真实fused精度证据。
