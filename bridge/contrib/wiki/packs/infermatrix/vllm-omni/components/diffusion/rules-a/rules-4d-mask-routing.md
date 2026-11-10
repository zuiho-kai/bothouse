---
name: rules-4d-mask-routing
description: Diffusion attention dense 4D mask 路由：现行规则 VLLM-OMNI-PR9302-PIECEWISE-SPAN-ROUTE（full_attn_spans is not None 且后端 supports_piecewise_spans 时跳过 dense 4D 检查，其余保留 SDPA 分流与 fail closed）；已被取代的 VLLM-OMNI-PR9248-DENSE4D-MASK-ROUTE 及其退役记录在历史
metadata:
  scope: "只收 Attention._run_local_attention 的 dense 4D attn_mask 分流与 piecewise spans 优先两条规则（PR #9248 已退役、PR #9302 现行）；混合 causal/full attention 的 DIFF-1z 归 rules-attention-3"
---
# Diffusion attention dense 4D mask routing

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/diffusion/rules-4d-mask-routing.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, diffusion；created: 2026-10-23；updated: 2026-10-23
- 来源（sources）：PR #9248；PR #9302
- [VLLM-OMNI-PR9302-PIECEWISE-SPAN-ROUTE] dense 4D mask 分流必须为 piecewise 后端的 full_attn_spans 让路
  - 触发：修改 `vllm_omni/diffusion/attention/layer.py` 中 `Attention._run_local_attention` 的 dense 4D mask 分流/拒绝判定，改动 `full_attn_spans` 与后端 piecewise 能力的优先级，或增删后端的 `supports_piecewise_spans` 声明。HunyuanImage3 的 dense prompt-KV 路径会同时携带 4D `attn_mask` 与 `full_attn_spans`。
  - 强制：dense 4D mask 检查前必须先算 spans 优先：`attn_metadata.full_attn_spans is not None` 且后端声明 `supports_piecewise_spans`（经 `getattr(..., False)` 读取，缺失该属性按非 piecewise 处理）时跳过该检查，让调用直达后端 piecewise 路径——CUDA `forward_cuda`、#9123 起的 XPU FlashAttention 与 FlashAttention Hub 变体先消费 spans、不读 dense mask。
    - spans 判定必须保持 `is not None` 存在性检查（空列表同样不是 `None`），不得改成非空或 truthiness 检查。
    - spans 优先不成立时（未携带 spans，或后端不支持 piecewise——非 piecewise 后端继续由 dense mask 合同管辖，与 DIFF-1z 一致），#9248 语义原样保留：后端 `supports_dense_4d_mask()` 为假时，自动选择下分流 SDPA，显式选择后端或 paged KV 激活时以 `NotImplementedError` fail closed（Qwen-Image-2.1 的 span-less dense mask 场景即属此类）。
  - 验收：在 `tests/diffusion/attention/test_attention_config.py` 以可 mock 后端断言路由去向：piecewise 后端携带 spans 时 backend forward 被调用一次、SDPA fallback 不被调用，`backend_explicit` 两种取值都要覆盖；piecewise 后端无 spans 时仍分流 SDPA；
    - 非 piecewise 后端携带 spans 且显式选择时抛 `NotImplementedError`（消息含 dense 4D attn_mask）且 backend 与 SDPA 均未被调用；#9248 原有 span-less 分流与拒绝路径保持回归。非 piecewise 后端 + spans + 自动选择的组合当前没有测试证据，不得据此声称其行为。^[PR #9302]

## 决策与踩坑

- [VLLM-OMNI-PR9302-PIECEWISE-SPAN-ROUTE] 禁止：恢复无条件的 dense 4D mask 拦截——它曾把 HunyuanImage3 在 XPU 的显式 `FLASH_ATTN` 请求以 `NotImplementedError` 打断，并在自动选择下静默降级到 SDPA，重演 #9248 对 #9123 的回归；借机删除 #9248 对 span-less dense mask 的分流/fail-closed 保护；把 spans 判定改成非空/truthiness 检查；仅凭后端调用未报错就声称路由正确。

## 历史

- [VLLM-OMNI-PR9248-DENSE4D-MASK-ROUTE] dense 4D mask 只允许按调用回退 SDPA，显式选择与 paged KV 必须失败关闭
  - 触发：修改 `vllm_omni/diffusion/attention/` 的 backend capability 位（如 `supports_dense_4d_mask`）、`Attention._run_local_attention` 的 attn_mask 路由/回退，或模型（如 Qwen-Image-2.1 在 right-padded batch 下）构造 dense `[B, 1, S, S]` block-causal mask 后送入共享 attention layer 的路径。
  - 强制：capability 必须显式声明并与 shipped backend 绑定——abstract 默认 `supports_dense_4d_mask() is False`，SDPA、cuDNN、Ascend `npu_fusion_attention`（即 NPU 上的 FlashAttention 分派）为 `True`。自动选择的 backend 声明不支持而本次 mask 为 dense 4D 时，仅把该次调用转发 `sdpa_fallback`（query/key/value/metadata 原样传递），不得持久切换 backend；
    - 回退须经 `warning_once` 发出去重告警报告该情形，不得每次调用重复输出；piecewise 路径保持不物化 mask。
  - 强制：显式选择的 backend、active paged-KV、缺失 `sdpa_fallback` 三种情形必须 fail closed，抛 `NotImplementedError`（分别说明 "does not support a dense 4D attn_mask" / "paged_kv=True"），且 backend forward 与 fallback forward 都不得被调用。
  - 禁止：让只接受 2D key-validity mask 的 backend（FlashAttention masked-varlen 断言 `attention_mask must be 2D`）在 kernel wrapper 深处 assert 崩溃并把 HTTP 500 暴露给请求；为自动选择加静默回退的同时放过显式选择或 paged KV 场景；把 capability 位写成与平台判定脱钩的常量使路由分支变成死代码；对 2D mask 或 capability=True 的 backend 多余改道。
  - 验收：mock-backend 单测覆盖六条路径：自动选择+不支持 → 恰好一次 `sdpa_fallback` 且 backend forward 未被调用；显式选择、paged KV、无 fallback → `NotImplementedError` 且两个 forward 均未被调用；2D mask 与 capability=True → 走原 backend 不改道；
    - 并 monkeypatch `current_omni_platform.is_npu` 断言 `FlashAttentionBackend.supports_dense_4d_mask() is is_npu`，防止 capability 与平台分派脱钩。^[PR #9248]
  - 退役记录：kb:rule status=retired since=v0.30.0 retired_at=v0.30.0 reason=superseded evidence="PR #9302 merged to main on 2026-10-23 (merge_commit 8e2a7c1).Its layer.py diff guards the #9248 dense 4D mask check in Attention._run_local_attention with `not spans_take_precedence`,
    - where spans_take_precedence requires `attn_metadata.full_attn_spans is not None` (an existence check, not a non-empty check) plus `getattr(self.attn_backend, 'supports_piecewise_spans', False)`.
    - Calls carrying both a 4D attn_mask and full_attn_spans (HunyuanImage3 dense prompt-KV) reach piecewise backends again instead of raising NotImplementedError under explicit FLASH_ATTN on XPU or being silently diverted to SDPA under automatic selection, restoring the #9123 behavior;
    - all other cases keep #9248 behavior.
    - The unconditional divert-or-reject claim of VLLM-OMNI-PR9248-DENSE4D-MASK-ROUTE therefore no longer matches vllm_omni/diffusion/attention/layer.py on current main, while its span-less semantics survive and are retested in tests/diffusion/attention/test_attention_config.py;
    - the non-piecewise + spans rejection is only tested with backend_explicit=True." superseded_by=VLLM-OMNI-PR9302-PIECEWISE-SPAN-ROUTE
