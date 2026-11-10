---
name: rules-platform-backends-1
description: "平台后端合同（1/2）：EXEC-NPU-INIT-1a（VoxCPM2 补丁在 set_device 之后安装，PR #8330）、EXEC-10a（NPU runner 的 runtime mode 与 dummy_run 签名）、EXEC-10b（XPU 异步 D2H 记录设备无关 torch.Event，PR #5571）、EXEC-10c（xpu/utils.py 的 torch_cuda_wrapper，PR #5569）、EXEC-10d（GPU/NPU AR runner 的 set_batch_req_ids，PR #5048）、EXEC-12a（ROCm 分页注意力走 packed KV varlen，PR #5886）、EXEC-13a（NPU 模型补丁由生产初始化注册，PR #6061）"
metadata:
  scope: 只收平台后端规则的前七条（EXEC-NPU-INIT-1a、EXEC-10a 至 EXEC-10d、EXEC-12a、EXEC-13a）；EXEC-13b 至 EXEC-13f、EXEC-10e、EXEC-13h、EXEC-10f、EXEC-10f2 见 rules-platform-backends-2，EXEC-13g 归 rules-npu-profiler，其余审查组路由归 model-executor-rules-1
---
# 平台后端合同（1/2）

## 关键事实

- 拆分说明：本页是源页 `rules-platform-backends.md` 的第 1/2 部分；第 2 部分 [[rules-platform-backends-2]]
- 源页：`knowledge/repos/vllm-omni/components/model-executor/rules-platform-backends.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, model-executor；created: 2026-09-04；updated: 2026-10-06
- 来源（sources）：PR #5886；PR #6061；PR #6096；vllm_omni/platforms/；PR #5604；PR #6293；PR #5571；vllm_omni/platforms/xpu/platform.py；PR #5569；vllm_omni/platforms/xpu/utils.py；PR #5048；PR #6350；PR #6102；PR #6563；PR #6054；vllm_omni/platforms/npu/platform.py；tests/platforms/npu/test_diffusion_platform.py
  - tests/platforms/npu/test_diffusion_attn_backend_selector.py；PR #6674；vllm_omni/platforms/npu/worker/npu_ar_model_runner.py；vllm_omni/platforms/npu/worker/npu_generation_model_runner.py；vllm_omni/platforms/npu/worker/npu_model_runner.py；PR #7301；PR #7393；PR #8330
- 置信度（confidence）：high
- [EXEC-NPU-INIT-1a] 模型补丁必须在 platform 初始化完成后、worker 建模之前安装
  - 触发：修改 NPUOmniPlatform constructor/set_device、VoxCPM2 patch import 或 worker class。
  - 强制：会经模型 transitive dependencies 再解析 current_omni_platform 的补丁不得在 platform constructor 导入；在 super.set_device 之后、worker 构造模型之前幂等安装，保持既有 custom-op/device 设置与 worker class。
  - 验收：platform 构造不安装 VoxCPM2 patch，set_device 顺序为底层设备→补丁→custom ops，重复安装不重复 wrap；pytest collection 与真实 NPU execution 分开记录。^[PR #8330]
- `EXEC-10a`–`10e`、`EXEC-12a`–`EXEC-13h`：NPU 平台 runner 的 runtime mode 与 dummy-run 接口、ROCm 分页注意力的 packed KV varlen 路径，以及 NPU 模型补丁的注册与回归。触发条件与其余审查组见 [[model-executor-rules-1]]、[[model-executor-rules-2]]、[[model-executor-rules-3]]（model-executor 共享规则） 的 Direct 代码快速入口。
- [EXEC-10a] NPU 平台 runner 必须保持 runtime mode 与 dummy-run 接口合同
  - 触发：平台 runner 覆盖 `dummy_run` 或接收 `cudagraph_runtime_mode`，而共享 runner 新增运行时参数或需要校验复合 runtime mode。
  - 强制：平台 override 必须保留共享签名中的 `randomize_inputs` 默认值并将其传给 `maybe_randomize_inputs`；runtime mode 必须调用 `is_valid_runtime_mode()` 判断当前实例是否有效。
  - 验收：对 base NPU runner 与 generation override 分别覆盖 `randomize_inputs` 的默认和显式路径，并用包含 `FULL_DECODE_ONLY` 等复合模式的正负用例断言 `is_valid_runtime_mode()` 的校验结果和签名 parity。 ^[PR #6096]
- [EXEC-10b] XPU 异步 D2H 必须记录设备无关的 torch.Event
  - 触发：修改 `XPUOmniPlatform.record_device_event()`，或修改使用通用 `torch.Stream.wait_event()` 门控异步 D2H 的 XPU 输出路径。
  - 强制：在当前计算流上记录设备无关的 `torch.Event()`，再由通用 stream 等待该事件，使 accelerator hooks 建立计算流到侧流复制的依赖；保持与 CUDA、ROCm 平台一致。
  - 验收：mock 测试断言 `torch.Event()` 被创建并记录且 `torch.xpu.Event()` 未被调用；XPU 硬件测试在计算流完成后让侧流执行 non-blocking D2H，等待侧流同步后断言 host tensor 全部保持预期值、无尾部图像损坏。 ^[PR #5571]
- [EXEC-10c] XPU CUDA 兼容包装必须覆盖异步运行时接口
  - 触发：XPU 等非 CUDA 平台复用 Omni AR 异步输出或 warm-up 路径，而共享 runner 调用了 `torch.cuda` 的 stream、event、device 或 graph 接口。
  - 强制：在 `vllm_omni/platforms/xpu/utils.py::torch_cuda_wrapper()` 中集中把 CUDA-facing API 映射到 XPU；`current_stream`、`default_stream`、`stream`、`set_stream`、`set_device` 使用 `partial`，`Stream` 映射为 `torch.xpu.Stream`，`Event` 忽略 CUDA 专属 `blocking` 参数后构造 `torch.xpu.Event`；
    - 仅在 `supports_xpu_graph()` 为真时映射 graph、`CUDAGraph`、pool 和 capture 状态接口。
  - 验收：XPU 平台测试进入 wrapper 后断言异步 runner 所需的 stream、event、device 和 graph 调用均路由到对应 XPU API，且不支持 graph 时保持禁用；Qwen3-TTS 等 AR-stage warm-up 与完整异步输出 smoke 在 XPU 上成功完成，同时 CUDA 路径和共享 runner 行为保持不变。^[PR #5569]
- [EXEC-10d] GPU/NPU AR runner 必须镜像逐请求 logits metadata handoff
  - 触发：AR 模型在 logits 计算中需要 runner 提供按 request 的 req_id 或其他逐请求 metadata，且 GPU 与 NPU 有独立的 execute/logits 路径。
  - 强制：GPU/NPU runner 都必须在 `flush_pending_metadata` 后，以 logits 行顺序调用可选的 `set_batch_req_ids(req_ids[:num_reqs])`；仅在 `spec_decode_metadata is None` 时建立一行对应一个 request 的映射，并允许没有该 hook 的模型无操作通过。
  - 验收：GPU 与 NPU 的测试分别断言 hook 的调用顺序、参数和 `num_reqs` 截断；覆盖无 hook 模型、mixed batch 与 spec decode，证明错误映射不会进入模型 logits mask。^[PR #5048]
- [EXEC-12a] ROCm 分页注意力必须走 packed KV 的兼容 varlen 路径
  - 触发：修改 `vllm_omni/experimental/ar_diffusion/kv_cache/paged_attention.py` 的 ROCm 分页注意力、AITER/`flash_attn` varlen kernel、`block_table` 映射或 KV block layout。
  - 强制：ROCm 路径必须避开 CUDA 专用的 `vllm.vllm_flash_attn` 接口，优先解析 AITER、再回退到 `flash_attn`；依据每个请求的 `seq_lens` 构造 `cu_seqlens_k`，在 device 上按 `block_table` gather 可见 KV 为 packed tensors，并使用匹配的 query offsets、最大长度、`softmax_scale` 和 `causal` 参数调用 `flash_attn_varlen_func`。
  - 验收：在 ROCm GPU 上覆盖不同 history/action 长度、block table、请求长度和 `commit_current` 组合，与 dense reference 校验数值和输出 shape；分别验证 AITER 与 `flash_attn` fallback，确认 HIP 路径不导入 `vllm.vllm_flash_attn`，并确认 CUDA/CPU 路径行为不变。 ^[PR #5886]
- [EXEC-13a] NPU 模型补丁必须由生产初始化路径注册并可回归
  - 触发：在 NPU platform 初始化中加入模型专有 monkey patch、融合算子或其他必须全局启用的 model hook。
  - 强制：把 hook 封装成幂等的 `apply_*_patch()`，在 `adapt_patch(is_global_patch=True)` 完成后由生产初始化路径显式调用；注册必须只指向目标模型 consumer，并保留非 NPU和其他模型路径。测试必须验证生产注册链，而不只直接调用 helper。
  - 验收：从 NPU 平台初始化/注册入口运行测试，断言目标 Qwen3-VL text encoder 的 consumer 已替换且重复初始化不重复 patch；随后用真实 consumer 覆盖至少一个 BNSD fast path、一个 BSND fallback 和 batched M-RoPE。^[PR #6061]
- 相关执行流见 [[model-executor-architecture]]（model-executor architecture）；跨 stage 合同见 [[rules-bridge-batch-1]]、[[rules-bridge-batch-2]]（bridge/batch 规则）。

## 决策与踩坑

- [EXEC-NPU-INIT-1a] 禁止：因为直接 model import 看起来 lazy 就在 constructor 安装；只验证 normal serve 而不检查先 import 模型的 collection；把 CPU/mock 的 import-order 测试当作 NPU graph parity。
- [EXEC-10a] 禁止：通过实例调用返回集合的 `valid_runtime_modes()` 冒充实例有效性校验，或因共享签名新增可选参数而让平台 override 产生接口漂移。
- [EXEC-10b] 禁止：向通用 `torch.Stream.wait_event()` 传递 `torch.xpu.Event()`，或通过零散的 `xpu.synchronize()` 掩盖事件类型不兼容造成的复制竞态。
- [EXEC-10c] 禁止：为适配 XPU 修改共享 `gpu_ar_model_runner.py`，或只映射 stream 而遗漏 `set_stream`、`set_device`、event 与受支持的 graph 接口；不得让通用 `torch.Stream.wait_event()` 接收不兼容的专用事件类型，也不得在不支持 XPU graph 时无条件安装 graph shim。
- [EXEC-10d] 禁止：只在 GPU 路径接入、在 metadata flush 前调用、把 padding/dummy request 传入 batch，或在 spec decode 的多行 request 映射下继续按位置记录 req_id。
- [EXEC-12a] 禁止：复用 CUDA 专用的 `seqused_k`/`fa_version` 参数合同；直接把不兼容的 ROCm paged kernel 用于 AR-Diffusion 的 frame-aligned blocks；依赖 ROCm kernel 对 `block_table` 的隐式支持；丢失逐请求长度或把 KV gather 到 CPU 后再调用 kernel。
- [EXEC-13a] 禁止：依赖 import side effect 或手工调用 helper 代替平台注册；只覆盖 patched function 的数值而不验证注册实际生效；把模型专有 patch 扩大到 MiniMax H3 DiT 或所有 NPU 模型。
