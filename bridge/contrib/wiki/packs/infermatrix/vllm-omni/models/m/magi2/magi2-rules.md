---
name: magi2-rules
description: "MAGI-2 BF16 routed MoE 规则：MAGI2-MOE-1a fused BF16 dispatch 的 eligibility（CUDA tokens>=4096、MUSA、非 deterministic、非 compile）与派生 cache 失效、MAGI2-MOE-1b routed GEMM 的 head 归属、SwiGLU7 数值与 launch 合同（PR #7206）"
metadata:
  scope: 只收 MAGI2-MOE-1a 与 MAGI2-MOE-1b 两条规则与代码快速入口；触发条件与归属边界归 magi2-overview
---
# MAGI-2 BF16 routed MoE 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/magi2/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #7206

### Direct 代码快速入口

| PR 描述信号 | 规则组 | 第一批源码 |
|---|---|---|
| BF16 dispatch、packing/cache、route buffer、reload/device move | `MAGI2-MOE-1a` | `vllm_omni/diffusion/models/magi2/mh_moe.py::Magi2MultiHeadMoE`；`vllm_omni/diffusion/models/magi2/modeling_magi2.py` 的 weight-loading caller |
| grouped GEMM、SwiGLU7、head/expert routing、launch config | `MAGI2-MOE-1b` | `vllm_omni/diffusion/models/magi2/fused_moe_kernels.py::invoke_fused_moe_bf16`；`tests/diffusion/models/magi2/test_moe_kernel_contract.py` |

### [MAGI2-MOE-1a] Fused BF16 dispatch 必须保留 eligibility 和派生 cache 失效

- 触发：修改Magi2MultiHeadMoE本地forward、gate/uppacking、routebuffers或checkpointreload。
- 强制：仅eager CUDA/MUSA+BF16+非MAGI2_DETERMINISTIC且不在torch.compile内走fused；CUDA还要求tokens>=4096，MUSA无该CUDA门槛，其余native。gate/up相邻行pack在load后准备，nonpersistentcache按parameterID、storagepointer、可用_version、device/dtype失效；inference tensor无version时显式reload仍清cache，.to/_apply清派生weight和routebuffer。
  - routebuffer按upperbound容量重用/resize，livepaddedcount留device，block超过liveprefix提前返回。
- 验收：CUDA4095/4096、MUSA、CPU/nonBF16/deterministic/compile、empty、inplace/mmap/inference reload、device移动、bufferreuse/resize分别回归；真实head/expert数下独立量cache/packing成本与native对照。 ^[PR #7206]

### [MAGI2-MOE-1b] Routed GEMM 必须保持 head 归属、数值与 launch 合同

- 触发：修改BF16groupedgate/up+downkernel、routinglayout、SwiGLU7或launchconfig。
- 强制：按localhead加expertbankoffset，gate/up以相邻行pair，FP32dotaccumulation通过clampedSwiGLU7(gate<=7、up[-7,7]、alpha1.702、up+1)，写BF16intermediate；down另以FP32累加并只乘一次routeweight再BF16cast，按topk恢复原token/head。
  - launcher检查BF16A/B/C、contiguous输出/routeweights、整数1Droutebuffers、共同device、非空匹配维度、even gate/up、positive topk、blockaligned容量和白名单launchvalues。非法配置拒绝；missingexpert down置零，overflow/paddingmask在int64offset计算前建立。
- 验收：wrapper负例、unevenK/N、padding/empty/missingexpert、多head/topk、routeweight一次和int64offset合同；对独立native/CPUreference采用明确容差并检查真正fuseddispatch，性能报告保留平台、warmup/cache和operator边界。 ^[PR #7206]

## 决策与踩坑

- [MAGI2-MOE-1a] 禁止：恢复已移除opt-inenv；每forward重新复制完整expertbank；用.item()读取paddedcount；把derivedweights加入checkpoint；跨reload/devicechange使用旧storage；把operator历史诊断说成视频E2E加速或确定性保证。
- [MAGI2-MOE-1b] 禁止：把分段BF16rounding说成全程FP32/逐位nativeparity；重复routeweight、混headexpertindex；只测toyexperts而不测productionlocalshape；用BF16atomicadd缺失代表此fusedpath不能运行，它不依赖该atomic。
