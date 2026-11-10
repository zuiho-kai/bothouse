---
name: rules-flashinfer-quantization
description: "FlashInfer attention 量化规则 DIFF-13a、13b、13c：FLASHINFER_ATTN 的 FP8 per-tensor scale 在 FP32 计算并被 wrapper 消费、TRTLLM SAGE quantizer 的 ragged cumulative lengths / smooth_k / flashinfer 0.6.18rc10 版本门槛、DIFFUSION_ATTENTION_QUANT 环境变量与 explicit default 的优先级（PR #7431）"
metadata:
  scope: 只收 flashinfer_attn.py、trtllm_attn.py 的量化 scale、SAGE quantizer 与 attention quant 环境变量解析；FlashInfer mixed-dtype plan 合同 DIFF-4h 归 rules-system-runtime-1，TRTLLM packed/SP admission（DIFF-1m）归 rules-attention-2，TRTLLM custom op 与执行能力规则 DIFF-14a、14b 归 rules-trtllm-execution
---
# FlashInfer attention quantization 合同

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/diffusion/rules-flashinfer-quantization.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, diffusion；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #7431；vllm_omni/diffusion/attention/backends/flashinfer_attn.py；vllm_omni/diffusion/attention/backends/trtllm_attn.py；vllm_omni/diffusion/data.py；tests/config/test_environment_variables.py；tests/diffusion/attention/test_trtllm_attn.py
- 置信度（confidence）：high
- 本页细化 [[rules-system-runtime-1]]（FlashInfer plan 合同 DIFF-4h；源锚点 #diff-4h-flashinfer-mixed-dtype-plan-必须绑定完整-runtime-shape-与-mask-内容）；TRTLLM packed/SP admission 仍由 [[rules-attention-2]]（DIFF-1m；源锚点 #diff-1m-trtllm-packed-paddingskip-softmax-与-sage-必须保留-producersp-和-schedule-合同） 约束。
- [DIFF-13a] FP8 per-tensor scale 必须在 FP32 中计算并被实际 kernel 消费
  - 触发：修改 `FLASHINFER_ATTN` 的 dtype override、`_per_tensor_quantize` 或 wrapper scale 参数。
  - 强制：8-bit 浮点转换用 `scale = max(amax(abs(x)).float(), 1e-6) / finfo(dtype).max`，在 FP32 中乘 reciprocal 后才 cast；非 8-bit cast 返回 scale 1。Q/K/V 分别计算 scale，wrapper 必须消费对应 scale，输出恢复原 query dtype。现有 public override allowlist 仍为 Q/K fp16/bf16、V 另含 fp8_e4m3，不能从通用 helper 推断 Q/K FP8 override 已开放。
  - 强制：仅在 wrapper 明确抛 `NotImplementedError` 时走无 scale 重试；非单位 Q 或 K scale 必须报 unsupported，只有单位 Q/K 的 V scale 可在输出后乘回。不能吞掉其他执行错误。
  - 验收：覆盖零/小值、FP16 大 reciprocal、独立 Q/K/V scale、无 scale fallback 的 V-only 正例与 Q/K 拒绝、输出 dtype。硬件数值须固定实际 wrapper/backend；review 接受 host scalar 限制是当前 API 边界，后续 device-scalar 改动须另测。^[PR #7431]
- [DIFF-13b] TRTLLM SAGE 必须消费 ragged metadata、Smooth-K 与实际版本能力
  - 触发：修改 `TRTLLM_ATTN` 的量化初始化、SAGE quantizer、ragged tail 或 causal dispatch。
  - 强制：noncausal quantized 路径解析实际 `flashinfer.trtllm_sage_attention_quantize`；可解析版本低于 `0.6.18rc10` 时 fail fast。quantizer 必须收到 Q/KV cumulative lengths 和 `smooth_k=True`，并按实际返回合同消费 scale/layout；短或非整 tile 的 ragged document 不再以 device `.item()` 检查静默禁用量化。
    - causal 路径显式清除量化 dtype/block 配置，保持既有 dense causal 行为。
  - 强制：TRTLLM kernel dispatch 传 `skip_all_rows_active_check=True`，保留 producer 的真实 ragged 长度、packed-padding 与 SP admission；不能用去掉 host sync 的动机删除正确性 metadata。
  - 验收：覆盖 known-old 版本拒绝、实际 quantizer 缺失、ragged `S % 64 != 0`、Smooth-K 参数及 causal 禁用；真实 Blackwell 对 dense reference 检验量化误差。作者所报 B200 测试属于其注明的 vLLM/build/head，不替代最终 target 的重新验证。^[PR #7431]
- [DIFF-13c] attention quant 环境变量必须服从显式 default 与 backend fallback
  - 触发：修改 `build_attention_config`、`DIFFUSION_ATTENTION_BACKEND`、`DIFFUSION_ATTENTION_QUANT` 或环境变量 inventory。
  - 强制：先 normalize config；已有 explicit default 时立即保留它。只有缺 default、backend env 存在且不为 `auto` 时才构造 env default，并按 backend-independent `AttnQuantSpec` 解析 `<dtype_qk>:<dtype_vo>[:<q_block_size>:<k_block_size>]`。只允许 2 或 4 个非空字段；block pair `(0,0)` 表示不传 block override，其余整数 pair 交给 spec 校验。
    - 已有 per-role config 保留。
  - 验收：覆盖 explicit default/per-role precedence、无 backend env、`auto`、两字段/四字段、零 pair、空字段与非法整数；inventory 与文档使用同一公共变量名，backend 执行另按能力合同验证。^[PR #7431]

## 决策与踩坑

- [DIFF-13a] 禁止：直接 cast FP8 冒充有 scale 的量化、在 FP16 中计算 reciprocal 导致 NaN，或无视 Q/K scale 后得到错误 softmax。当前 FlashInfer API 仍要 host scalar，`_extract_scalar().item()` 位于 compiler-disabled 边界；不得声称 device scalar 或每次调用无同步已实现。
- [DIFF-13b] 禁止：把早期 try-import symbol 当版本证明，或将未解析/缺失版本描述成当前实现已 fail closed；merged code 在该情况继续解析实际 symbol，故版本字符串不提供已验证能力证明。不得把 causal attention 当 SAGE 支持范围。
- [DIFF-13c] 禁止：将 quant env 绑定少数 backend 的特殊 allowlist、以 quant env 单独激活 backend，或让 `auto`/显式 default 被 env quant 覆盖。generic spec 能解析不等于任意 backend 都有实际量化能力。
