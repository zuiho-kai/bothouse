---
name: rules-trtllm-execution
description: "TRTLLM 规则 DIFF-14a、DIFF-14b：`vllm_omni::trtllm_ragged_attention` custom op 把 FlashInfer JIT/cubin I/O 封在 opaque op 内、schema 只声明 workspace_buffer mutation、fake output 对 FP8/INT8 query 返回 BF16；verified CUSTOM_OP 仅限 dense、noncausal、BF16、head size 128、CUDA SM100/SM103，其余保持 UNMIGRATED（PR #7214）"
metadata:
  scope: 只收 trtllm_attn.py 的 custom op 注册与 resolve_execution 能力声明；SAGE 量化数值与版本门槛（DIFF-13b）归 rules-flashinfer-quantization
---
# TRTLLM custom op 与执行能力合同

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/diffusion/rules-trtllm-execution.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, diffusion；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #7214；vllm_omni/diffusion/attention/backends/trtllm_attn.py；tests/diffusion/attention/test_trtllm_attn.py；tests/diffusion/attention/test_trtllm_contract.py；docs/design/feature/attention_execution_contract_poc.md
- 置信度（confidence）：high
- 通用 attention admission 见 [[rules-attention-1]]、[[rules-attention-2]]、[[rules-attention-3]]（attention rules）；量化数值见 [[rules-flashinfer-quantization]]（FlashInfer quantization）。
- [DIFF-14a] TRTLLM custom op 必须封装 JIT I/O 并准确声明 workspace 与 fake output
  - 触发：修改 `vllm_omni::trtllm_ragged_attention` 注册、FlashInfer JIT/cubin 调用、fullgraph compile 或 fake implementation。
  - 强制：真实 FlashInfer dispatcher 的 cached JIT、cubin/file I/O 位于 opaque custom-op 内；schema 仅声明 `workspace_buffer` mutation，Q/K/V、sequence metadata 和 scale tensors 保持输入合同。fake output shape 为 `(*query.shape[:-1], value.shape[-1])`，在 query device；FP8 e4m3/e5m2 与 INT8 query 返回 BF16，其余保留 query dtype。
  - 强制：实际 dispatcher 与 fake shape/dtype 一致；SAGE scale/block metadata、skip-softmax sentinel、causal 与 ragged lengths 通过显式参数传入，不能把 Python I/O重新暴露给编译图。
  - 验收：编译测试中 FlashInfer I/O trap 不逃入 fullgraph，fake/real 输出 shape、device、BF16低精度输出一致；覆盖 workspace mutation、非等 QK/VO dimension 与 scale 参数。真实数值另用对应硬件/kernel验证，CPU fake tests 只证明 schema。^[PR #7214]
- [DIFF-14b] TRTLLM verified execution 必须来自已初始化 backend 的真实输入
  - 触发：修改 TRTLLM `resolve_execution`、capability metadata、backend construction、packed metadata 或 compile admission。
  - 强制：pre-construction query 清除 caller 自填的 kernel variant，返回 `UNMIGRATED`。初始化后由实际 quant/skip/packed 路径和真实 query dtype、causal、piecewise、metadata 构造合同。verified `CUSTOM_OP` 只覆盖 dense、noncausal、BF16、head size 128、equal Q/K/V heads、CUDA SM100/SM103；
    - parallel、paged KV、piecewise 和 outer HSDP/compile boundary 没有该验证承诺。
  - 强制：Q/K/V rank4、dtype/device、K/V shape、batch/head dimension 与非零尺寸必须一致；`attn_mask` 拒绝；四个 packed key 要么齐全要么皆无，`PackedPaddingMetadata` 另要求完整 packed metadata。missing FlashInfer 或非法真实输入为 unsupported；SAGE、skip-softmax、packed、其他架构或未验证 geometry 保持 `UNMIGRATED`。
  - 验收：覆盖 construction 前后、SM100/SM103 与 SM90/SM120、actual config 覆盖 caller hints、dtype/shape/mask/partial metadata 拒绝和 unverified path 矩阵。最终 supported scope 须在对应 Blackwell上执行 custom op 与 dense reference；静态架构 guards 不提供硬件数值证据。^[PR #7214]

## 决策与踩坑

- [DIFF-14a] 禁止：fake 无条件用 query dtype、把 workspace mutation 藏在纯函数 schema 中，或因 trace 成功就假定不同 dtype/VO head dimension 输出正确。
- [DIFF-14b] 禁止：把 caller 声明、成功 import 或 uninitialized backend 标成 verified，或把 advisory `UNMIGRATED` 当作关闭普通执行/compile 的新硬门禁。不能把早期 Blackwell测试、Cosmos parallel timing 或 GH200 上 Blackwell skips外推成最终 parallel/Blackwell合同证明。
