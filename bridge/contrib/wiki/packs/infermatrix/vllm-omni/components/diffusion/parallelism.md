---
name: parallelism
description: Diffusion 并行策略路由：docs/design/feature/ 下 tensor/pipeline/sequence/expert/cfg/hsdp/vae parallel 各 spec（main @ 5c390096），源码 vllm_omni/diffusion/distributed/，composable_parallel 已接线轴（tp/dp/pp/ep/stage_replica），ulysses_a2a_permute 的 SymmMem A2A（DIFF-4x）与 CFG parallel state（DIFF-4y）
metadata:
  scope: 只做并行策略到 spec、源码和规则的路由；ulysses_a2a_permute 的配置投影归 rules-diffusion-parallel-transport，并行拓扑配置合同归 rules-parallel-topology，SP padding 归 rules-sp-padding
---
# Diffusion 并行策略总览

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/diffusion/parallelism.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, components, diffusion；created: 2026-07-16；updated: 2026-09-05
- 来源（sources）：docs/design/feature/tensor_parallel.md；docs/design/feature/cfg_parallel.md；docs/design/feature/vae_parallel.md；PR #6340；PR #6786；vllm_omni/diffusion/distributed/a2a_permute.py；vllm_omni/diffusion/distributed/cfg_parallel.py；vllm_omni/diffusion/attention/parallel/ulysses.py
- 每种策略一篇官方 spec（`docs/design/feature/`，均在 `main @ 5c390096` 验证存在）：`tensor_parallel.md`、`pipeline_parallel.md`、`sequence_parallel.md`、`expert_parallel.md`、`cfg_parallel.md`（CFG 正负分支并行——与 [[serving-architecture]]（architecture 的 CFG companion 流）相关）、`hsdp.md`、`vae_parallel.md`。本页只做路由：读具体策略以对应 spec 为准。
- 源码：`vllm_omni/diffusion/distributed/`（distributed_vae、sp_plan、序列并行 hooks）；策略在 `diffusion/registry.py::initialize_model` 初始化链中注入（sequence parallelism、patch-parallel、VAE slicing/tiling）。
- **配置入口是 config 组件**：`composable_parallel` 的声明式 per-stage 轴栈（tp/dp/pp/ep/stage_replica 已接线；sp/cfg/vae_pp/hsdp 为保留位）见 [[configuration-architecture]]（Configuration）；stage 级 `tensor_parallel_size` 等字段见 deploy schema。
- strict Ulysses 可显式设置 `ulysses_a2a_permute=true` 使用 SymmMem permute-free A2A；它默认关闭，advanced-UAA 与 AllGather 不走该 path；strict Ulysses+Ring 的 Ulysses leg 可用。
  - workspace/capture/shutdown 与硬件 parity 门禁见 [[rules-system-runtime-1]]（DIFF-4x；源锚点 #diff-4x-symmmem-ulysses-a2a-只能显式启用并保持-workspace-生命周期闭合），配置投影见 [[rules-diffusion-parallel-transport]]（VOMNI-CFG-1q；源锚点 #vomni-cfg-1q-symmmem-ulysses-transport-开关必须完整投影且默认关闭）。^[PR #6340]
- CFG parallel state 的未初始化 serial-1 fallback、已初始化错误传播以及 two/N-branch rank 分派，见 [[rules-system-runtime-1]]（DIFF-4y；源锚点 #diff-4y-cfg-parallel-state-未初始化时串行初始化错误必须可见）。
- 并行度 × 设备容量的启动验收硬规则在 [[model-executor-rules-1]]、[[model-executor-rules-2]]、[[model-executor-rules-3]]（Model Executor 规则）。
