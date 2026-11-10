---
name: rules-platform-backends-2
description: "平台后端合同（2/2）：EXEC-13b（NPUGraph 精确形状捕获，PR #5604）、EXEC-13c（NPU 补丁避开 diffusion 导入回环，PR #6293）、EXEC-13d（fused MoE 的 OOT 注册，PR #6350）、EXEC-13e（diffusion paged KV 平台 native hook，PR #6102、PR #6563）、EXEC-13f（MindIE-SD 提前导入，PR #6054）、EXEC-10e（NPU runner shallow-copy SchedulerOutput map）与 EXEC-13h（profiling timing gate，PR #6674）、EXEC-10f（XPU W8A16 FP8 linear，PR #7301）、EXEC-10f2（async PP sampled-token broadcast send，PR #7393）"
metadata:
  scope: 只收平台后端规则的后九条（EXEC-13b 至 EXEC-13f、EXEC-10e、EXEC-13h、EXEC-10f、EXEC-10f2）；EXEC-NPU-INIT-1a、EXEC-10a 至 EXEC-10d、EXEC-12a、EXEC-13a 见 rules-platform-backends-1，NPU KV connector finalize 的 EXEC-5b 归 model-executor-rules-3，NPU K/V cache 布局归 rules-npu-kv-layout
---
# 平台后端合同（2/2）

## 关键事实

- 拆分说明：本页是源页 `rules-platform-backends.md` 的第 2/2 部分；第 1 部分 [[rules-platform-backends-1]]
- 源页：`knowledge/repos/vllm-omni/components/model-executor/rules-platform-backends.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, model-executor；created: 2026-09-04；updated: 2026-10-06
- [EXEC-13b] NPU 精确形状图捕获必须隔离动态边界并失败即停
  - 触发：修改 `vllm_omni/platforms/npu/graph_tools.py` 的 NPUGraph 捕获/重放、NPU 模型补丁的 tensor-only 子图，或 Token2Wav 图执行上下文。
  - 强制：图缓存 key 必须同时包含 operation、缓存模式、所有输入的完整 shape、dtype 和 device；首次匹配调用先 eager 预热，再使用 vLLM global graph pool 捕获，后续重放前把当前值复制到静态输入，并在请求状态或 streaming cache 接管前 clone 持久化输出。Python metadata、CPU 频率张量、H2D、随机数和动态 state 必须留在 eager 边界；捕获失败后必须停止该 stage 进程。
  - 验收：CPU/mock 测试覆盖 exact-signature dispatch、cached/uncached bucket、global graph pool、persistent-output ownership、capture failure fail-stop 和异常传播；A3 硬件测试分别比较 eager 与 uncached/cached NPUGraph 的输出、shape 和 cache，并核对图数量上限与 runtime preconditions。^[PR #5604]
- [EXEC-13c] NPU 模型补丁必须避开平台构造期的 diffusion 导入回环
  - 触发：NPU 平台注册模型专有 monkey patch，且该 patch 包会导入 diffusion pipeline/data 或依赖已完成初始化的平台状态。
  - 强制：平台构造阶段只完成轻量、全局且无 diffusion 回环的 patch；将会加载模型 encoder/pipeline 的 patch 延迟到 `init_diffusion_model_runner_runtime`，并在 diffusion pipeline 加载前、平台对象已建立后，按既有顺序显式应用所有相关 patch。注册入口仍须幂等且只作用于目标 consumer。
  - 验收：静态或子进程测试证明平台构造不会加载 MiniMax-H3 encoder/diffusion data，runtime hook 在 pipeline 加载前调用目标 patch 且保留其他 patch；验证重复初始化不重复 patch，并用真实 NPU consumer 覆盖 patch 生效路径。^[PR #6293]
- [EXEC-13d] NPU diffusion fused MoE 必须在真实 runtime 注册 OOT 实现
  - 触发：NPU diffusion 路径调用 fused MoE，而 vllm-ascend 的 OOT MoE 注册只在其 `NPUWorker.__init__` 中执行，导致 `RoutedExperts` 未注册或无法接收 `n_shared_experts`。
  - 强制：在生产 `prepare_fused_moe_runtime()` 路径中幂等注册 `MoERunner` 与 `RoutedExperts`；注册前检查 `op_registry_oot`，已有名称必须保留其现有实现，并只依赖 diffusion config shim 实际提供的参数。
  - 验收：从真实 NPU diffusion runtime 覆盖首次和重复初始化，断言两个 OOT 名称均解析到可接受 `n_shared_experts` 的实现并完成 HunyuanImage3 fused-MoE accuracy/performance smoke；同时确认普通 NPU、非 NPU 和已完成 vllm-ascend 注册的路径不变。^[PR #6350]
- [EXEC-13e] diffusion paged KV 必须经平台 native hook 闭合
  - 触发：平台为 diffusion paged KV 增加或修改 BlockTables、native attention metadata builder，或 common adapter 需要支持 CUDA 与 NPU 的不同 native contract。
  - 强制：common `OmniPlatform` 通过 `get_diffusion_kv_block_tables_cls()`、`build_diffusion_kv_attn_metadata()`、backend specialization 与 prewrite hook 提供默认 native 实现；
    - NPU 必须返回 `AscendBlockTables`，把 `seq_lens_cpu` 转为 `seq_lens_np` 并使用 `AscendAttentionState.ChunkedPrefill`，在 spec discovery 前设 Ascend 支持的 block geometry，并为 FIA 在 piecewise segments 前恰好 prewrite complete K/V span。strict Ulysses 的 Ascend paged backend 必须绕开上游 PCP dispatch。
    - common diffusion data plane 只调用 platform hooks，并在 layer registration 阶段验证 resolved backend 与 hook 能力。^[PR #6563]
  - 验收：default 与 NPU hook 的 class、metadata 参数、block geometry、prewrite 与 backend selection 通过 mock/contract 测试，unsupported hook/backend 在物理 cache allocation 前 fail fast；CUDA 与 NPU lane 分别验证 native metadata construction。
    - 硬件证据限于 PR 的 H200/910B request-mode lanes，不能推出其他平台、Ring/AllGather 或性能一般化。^[PR #6102] ^[PR #6563]
- [EXEC-13f] NPU diffusion attention 必须只为会触达 MindIE-SD 的后端提前导入
  - 触发：修改 `NPUOmniPlatform.get_diffusion_attn_backend_cls()` 的 diffusion attention backend 选择、NPU FlashAttention/RAINFUSION fallback，或 MindIE-SD custom-op 环境初始化。
  - 强制：显式 `FLASH_ATTN`（包括在 NPU 上回退到本地 FlashAttention 的 `FLASH_ATTN_HUB` / `FLASH_ATTN_3_HUB`）和 `RAINFUSION_ATTN` 在 `mindiesd` 可发现时必须在 backend path 返回前导入它；后者的 dense FlashAttention fallback 会在 `start_step` 前或没有可稀疏化 video segment 的 layer 触达 MindIE-SD。
    - 该导入须早于任何会让 CANN 固化 custom-op registry 的 regInfo lookup，使 `mindiesd.env` 能先把 vendor dirs 写入 `ASCEND_CUSTOM_OPP_PATH`。
  - 验收：CPU/mock selector test 应分别断言 FLASH、两个 hub FLASH fallback 与 RAINFUSION 触发 eager import，TORCH_SDPA 不触发；同时覆盖 `mindiesd` 缺失时显式 FLASH 仍解析、未选择 backend 时才在可用条件下默认 FLASH，否则回退 SDPA。该测试不运行 NPU/CANN，不证明 custom-op 注册、真实 kernel 或 Ascend 生产可用性。^[PR #6054]
- [EXEC-10e] NPU runner 只能 shallow-copy 自己要改的 mutable map
  - 触发：NPU AR/generation runner 在 `speculative_config.use_ngram_gpu()` 下把同一 `SchedulerOutput` 交给会 trim invalid draft 的继承路径，或升级 upstream NPU runner ownership。
  - 强制：AR 与 generation 两条路径都用 `dataclasses.replace` 浅拷贝外层 `SchedulerOutput`，且只 `.copy()` 两个会被修改的 map：`num_scheduled_tokens` 与 `scheduled_spec_decode_tokens`；其他 immutable/tensor state 继续共享。
    - vLLM-Ascend 0.28 已拥有 CUDAGraph/KV-scale handling 与 SP/flashcomm-v1 output gather 时，Omni 只保留自身 forwarding/output hooks，不重复 reset、calculate 或 gather。
  - 验收：ngram enabled 时两 runner 的 inherited mutation 都不改变原始两个 map，copy 仅隔离它们；disabled control 不额外复制。另以 owner/call-count 测试防止 duplicate KV-scale 与 SP gather。PR #6674 未新增这些专项执行测试；CPU/mock 也不证明真实 NPU parity。^[PR #6674]
- [EXEC-13h] NPU profiling 只有 enabled 且 need_timing 才进入 timing path
  - 触发：NPU runner profiling、model execute timing 或 vLLM 0.28 profiler API 对齐。
  - 强制：AR 与 generation 都从同一 `profiling_chunk_config` 读取 gate；scheduler output 的 `disable_profiling_timing` 先把当前 call 的 `need_timing` 置 false。只有 `enabled && need_timing` 才启动/同步计时，并且只有同一 gate 成立才导出 `execution_time_ms`；其他调用保持 normal path。
  - 验收：AR/generation 都覆盖 enabled+timed、disabled+timed、enabled+not-timed 及 per-output disable，断言 start/sync/export 一致。PR #6674 没有这些专项测试，属于后续验收要求。^[PR #6674]
- [EXEC-10f] XPU W8A16 FP8 linear 必须 flatten-then-reshape 恢复 N-D 输出
  - 触发：修改 `vllm_omni/platforms/xpu/patch.py`、`XPUOmniPlatform` 初始化补丁，或 XPU 上 diffusion `--quantization fp8` 的 ScaledMM 路径。
  - 强制：对 `XPUW8A16FP8LinearKernel.apply_weights` 在平台 init 幂等 patch：先按 `(*x.shape[:-1], out_features)` 记录输出形，把 activation reshape 为 2-D 再调用原实现，最后 `.view` 回 N-D。与其他 ScaledMM/W8A8 合同一致；kernel 不可用时 skip。
  - 验收：XPU 上 FLUX/Qwen-Image 等 FP8 diffusion 能完成 dummy warmup 与生成；2-D LLM 路径不受影响。^[PR #7301]
- [EXEC-10f2] AR runner 在 async PP 下必须配对 sampled-token broadcast 的 send
  - 触发：修改 `GPUARModelRunner.sample_tokens`、async scheduling + `pipeline_parallel_size > 1`，或继承/覆盖上游 `_pp_receive_prev_sampled_token_ids_to_input_batch` / `_pp_broadcast_prev_sampled_token_ids`。
  - 强制：非最终 PP rank 在 connector-only 分支 posted 的 async broadcast receive，必须由最终 rank 在 `_update_states_after_model_execute` 之后立刻执行匹配 send。守卫与上游一致：`use_async_scheduling` 且 `not broadcast_pp_output` 且 `pp.world_size > 1` 且 `pp.is_last_rank`。
  - 验收：ledger 或真实多进程 PP group 证明非最终 rank 的 receive 仅因最终 rank 的 Omni send 完成；PP1 与 `broadcast_pp_output` 路径不变。缺 send 时不得把“设 `async_scheduling: false`”当作长期合同。^[PR #7393]

## 决策与踩坑

- [EXEC-13b] 禁止：捕获整个请求编排或包含动态 Python/RNG 状态的路径；使用无界 shape cache、绕过 global graph pool、在 nested capture 中重放、复用会被下一次重放覆盖的输出，或吞掉 capture、patch setup、SDPA context 的异常后继续运行。
- [EXEC-13c] 禁止：在 NPU platform `__init__` 中导入或执行会经 `pipeline_registry` → `DiffusionOutput` 回环的模型 patch；依赖 import side effect；只移动一个 patch 而让同一模型的相关 patch 仍在过早阶段加载；把 NPU 时序修复外推为所有平台的通用行为。
- [EXEC-13d] 禁止：依赖 `NPUWorker` 初始化或 import side effect 建立 diffusion 注册；无条件注册完整 `REGISTERED_ASCEND_OPS` 表；重复调用触发注册断言，或让 `PluggableLayer` 回退到不兼容的上游实现。
- [EXEC-13e] 禁止：在 common adapter 直接导入 `vllm_ascend` 或硬编码 CUDA `BlockTables`/metadata 假设；把 platform capability 延迟到首次 attention dispatch；平台未提供 native contract 时静默回退 dense 或继续占用 paged KV。
- [EXEC-13f] 禁止：为 `TORCH_SDPA` 或其他不会到达 MindIE-SD kernel 的显式 backend 导入可选 `mindiesd`；不得把 optional-package 损坏扩散成这些 backend 的选择失败，也不得假定所有 RAINFUSION layer 都走 sparse path。
- [EXEC-10e] 禁止：原地修改 EngineCore-owned maps；`deepcopy(scheduler_output)`；只修 AR 或 generation 一侧；恢复已经上移给 upstream 的 KV-scale/CUDAGraph/SP gather，或把删除重复逻辑写成数值/性能已验证。
- [EXEC-13h] 禁止：仅因 profiler/config object 存在或 `need_timing=true` 就计时；profiling disabled 时创建 timing state；只在 start 处 gate、却无条件同步/导出，或将 gate 本身当作 NPU 性能结果。
- [EXEC-10f] 禁止：把 3-D diffusion activation 直接交给 fake 恒返回 2-D 的 `fp8_gemm_w8a16`；把该 patch 宣称为 LLM 2-D 路径修复或上游永久替代（upstream 修好后应变 no-op）。
- [EXEC-10f2] 禁止：只继承 receive 而不补 send；在 `broadcast_pp_output=True`（external_launcher 已广播 logits/输出）时重复发送 sampled ids；把死锁归因于必须关闭 Thinker `async_scheduling` 而不修复配对集体通信。
