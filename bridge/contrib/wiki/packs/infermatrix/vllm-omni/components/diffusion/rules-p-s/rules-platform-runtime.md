---
name: rules-platform-runtime
description: "Diffusion 平台运行时规则 DIFFPLAT-1a、2a、3a 与入口表：platform get_default_ir_op_priority 在 Inductor 下只优先 native、否则 vllm_c → native（MUSA/ROCm，PR #6058）；ROCm host 上 CPU 输入走 F.linear 绕过 rocm_unquantized_gemm（PR #6267）；DiffusionModelRunner 按 supports_torch_inductor() 决定是否调用 pipeline setup_compile()（PR #6983）"
metadata:
  scope: 只收 diffusion worker/runner 与硬件 platform 之间的配置合同；layer 与 kernel 自身的设备分派和数值规则归 rules-platform-kernels
---
# Diffusion 平台运行时规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/diffusion/rules-platform-runtime.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, diffusion；created: 2026-09-02；updated: 2026-09-05
- 来源（sources）：PR #6058；vllm_omni/diffusion/registry.py；vllm_omni/diffusion/worker/diffusion_worker.py；vllm_omni/platforms/musa/platform.py；PR #6267；vllm_omni/diffusion/models/ltx2/ltx2_phase_adapter.py；PR #6983；vllm_omni/diffusion/worker/diffusion_model_runner.py
  - vllm_omni/diffusion/models/dreamzero/pipeline_dreamzero.py
- 置信度（confidence）：high
- 本页承载 diffusion worker 与硬件 platform 之间的配置合同；模型自己的 kernel、数值与性能结论仍归共享 layer/backend 或模型 owner。

### Direct 代码快速入口

| PR 描述在做什么 | 规则 | 第一批 live 源码 |
|---|---|---|
| IR-op priority、Inductor/eager 默认顺序、模型 hook 覆盖 | `DIFFPLAT-1a` | platform `get_default_ir_op_priority` → `diffusion_worker._resolve_ir_op_priority` → model `get_diffusion_ir_op_priority_func` |
| pipeline `setup_compile()` 的平台准入 | `DIFFPLAT-3a` | `DiffusionModelRunner` → `pipeline.setup_compile()` |

### [DIFFPLAT-1a] platform IR-op priority 必须区分 Inductor 与 eager

- 触发：平台新增或修改 `get_default_ir_op_priority()`，或 diffusion worker 改变 platform default 与模型 hook 的合并顺序。
- 强制：worker 先取当前 platform default，再让模型级 `get_diffusion_ir_op_priority_func()` 做精确覆盖。MUSA 与 ROCm 的通用基线是：backend 为 `inductor` 且 compilation mode 非 `NONE` 时只优先 `native`，否则按 `vllm_c → native`；返回值必须经 `IrOpPriorityConfig.with_default()` 构造，使显式 per-op priority 仍可表达。
- 验收：平台单测至少覆盖 Inductor enabled、mode `NONE`、非 Inductor backend，并由 worker 测试断言 platform default 先于 model hook。PR #6058 没有新增自动测试或 MUSA runtime 运行，当前证据只证明静态实现与现有 worker consumer 接通。^[PR #6058]

### [DIFFPLAT-2a] ROCm host 上的 CPU 输入必须绕过 ROCm GEMM dispatch

- 触发：修改 LTX phase adapter 的 unquantized linear/GEMM dispatch，或出现 ROCm host 与 CPU tensor device 不一致的测试路径。
- 强制：当 `current_platform.is_rocm()` 且 `input_.device.type == "cpu"` 时，必须使用 `F.linear(input_, weight, bias)`，绕过没有 CPU kernel 的 `rocm_unquantized_gemm`；其他设备路径继续遵循既有 dispatch 和 batch-invariant 逻辑。
- 验收：ROCm host 的 CPU 输入测试必须断言结果来自 `F.linear` 且未调用 `rocm_unquantized_gemm`；同时回归 ROCm device、CUDA/其他平台及既有 batch-invariant 路径。^[PR #6267]

### [DIFFPLAT-3a] runner 必须是 pipeline compile 的唯一平台准入者

- 触发：修改 `DiffusionModelRunner` 的 `setup_compile()` 调用条件，或模型 pipeline 的 `setup_compile()`。
- 强制：runner 仅在 `enforce_eager` 为 false 且 `current_omni_platform.supports_torch_inductor()` 时调用 pipeline `setup_compile()`；pipeline 只负责其模型专有的编译工作，沿用 runner 的平台能力决策。
- 验收：以 mock platform 覆盖 eager、Inductor 支持与不支持的组合，断言仅合格组合调用 `setup_compile()`；并回归 DreamZero 的 setup 路径经 runner 可达。^[PR #6983]

## 决策与踩坑

- [DIFFPLAT-1a] 禁止：在 compile 路径优先可能产生不兼容 custom-call 的 `vllm_c`；把 CUDA 固定优先级、ROCm 的 AITER/RMSNorm 特例或单模型 override 泛化到 MUSA；仅凭实现与 ROCm 排序一致声称 MUSA kernel 已验证。
- [DIFFPLAT-2a] 禁止：仅因 host platform 是 ROCm 就把 CPU tensor 交给 ROCm GEMM；不得把该 fallback 推广为 ROCm kernel 的通用 CPU 支持或改变其他平台的 dispatch 语义。
- [DIFFPLAT-3a] 禁止：pipeline 以 `torch.cuda.is_available()` 或其他 CUDA 专属条件重复收窄该入口；不得仅据此变更宣称 XPU、ROCm 或其他平台已经完成运行时验证。
