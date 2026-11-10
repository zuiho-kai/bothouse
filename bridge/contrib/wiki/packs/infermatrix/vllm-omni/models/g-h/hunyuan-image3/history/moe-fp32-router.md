---
name: moe-fp32-router
description: HunyuanImage3 MoE router 须 fp32 的调查记录（2026-04-30，commit 0413c2c2）：HF 的 fp32 gate 与 autocast 关闭区、vLLM HunYuanSparseMoeBlock 默认 bf16 topk_softmax 导致 top-k 翻位、HunyuanImage3SparseMoeBlock 子类与 _patch_moe_blocks 的修法、IT2I 输出 741 增至 811 chars 的验证与通用化经验
metadata:
  scope: 只收 fp32 router 这一处根因、修法、验证与可推广的接 HF 模型检查项；对齐交付总清单与不可修架构差异归 alignment-inventory，sampler 不可对齐论述归 hf-omni-alignment-method-1、hf-omni-alignment-method-2
---
## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/history/moe-fp32-router.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

### 现象

- vllm-omni HunyuanImage3 离线推理与 HF 官方 transformers 实现输出不一致（length / token 序列）。prompt format / BPE / image preprocessing 全部对齐后仍有 ~70 chars 差距 + 偶发幻觉。

### 根因（HF 代码原文）

- `hunyuan3.0_ins/modeling_hunyuan_image_3.py`:

```python
# HunyuanTopKGate.__init__ (line 1102)
self.wg = nn.Linear(config.hidden_size, num_experts, bias=False, dtype=torch.float32)

# HunyuanTopKGate.forward (line 1114-1116)
if self.wg.weight.dtype == torch.float32:
    hidden_states = hidden_states.float()
logits = self.wg(hidden_states)

# HunyuanMoE.forward (line 1204-1207) — eager moe_impl branch
with torch.autocast('cuda', enabled=False):
    topk_weights, topk_idx = self.gate(hidden_states, topk_impl='easy')
topk_weights = topk_weights.to(hidden_states.dtype)  # cast back to bf16 ONLY for expert combine

# HunyuanTopKGate.easy_topk (line 1132-1139)
@staticmethod
def easy_topk(logits, moe_topk):
    gates = F.softmax(logits, dim=1)
    topk_weight_1, expert_index = torch.topk(gates, moe_topk)
    weight_sums = topk_weight_1.sum(dim=1, keepdim=True)
    weight_sums = torch.clamp(weight_sums, min=1e-8)  # ← clamp constant matters
    topk_weight = topk_weight_1 / weight_sums
    return topk_weight, expert_index
```

- → Router 全程 fp32（gate weight + matmul + softmax + topk + renormalize），只在 expert MLP combine 时才 cast 回 bf16。

### vLLM 默认行为（错的）

- `vllm/model_executor/models/hunyuan_v1.py: HunYuanSparseMoeBlock`:
  - `self.gate = ReplicatedLinear(...)` 默认 dtype = bf16
  - `self.experts = SharedFusedMoE(... renormalize=top_k>1, ...)`，没传 `custom_routing_function`
  - forward: `router_logits, _ = self.gate(hidden_states)` → bf16 logits
  - → `SharedFusedMoE` 的 `vllm_topk_softmax` CUDA op 吃 bf16 logits 做 softmax + topk + renormalize
- 差异：64 experts × top_k=8 × 32 layers，bf16 quantization 在边界处会让 top-k 决策翻位 → 错 expert MLP → hidden state 偏 → KV cache 累积偏 → 解码 token 翻位。

### 修法（已 commit 0413c2c2）

- `vllm_omni/model_executor/models/hunyuan_image3/hunyuan_image3.py`:
  1. 新增 `_hunyuan_image3_unpack_packed_topk` 函数：把 `(topk_weights, topk_indices)` 从 `gating_output` packed buffer 里解出来当 `custom_routing_function`。
  2. 新增 `HunyuanImage3SparseMoeBlock(HunYuanSparseMoeBlock)` 子类：
     - **不调 super().__init__()**——会浪费一次 bf16 experts 分配 + 撞 `Duplicate layer name` 注册冲突
     - 用 `nn.Module.__init__(self)`，再 1:1 复刻 parent 的 attrs（tp_size、ep_*、n_routed_experts、n_redundant_experts ...）
     - `self.gate = ReplicatedLinear(..., params_dtype=torch.float32, ...)` ← fp32 gate
     - `self.experts = SharedFusedMoE(..., renormalize=False, custom_routing_function=_hunyuan_image3_unpack_packed_topk)`
  3. forward 里：`hidden_states.float() @ gate.weight(fp32)` → fp32 logits → softmax/topk/clamp+divide 全 fp32 → cast topk_w 到 bf16 → cat 成 packed → call `self.experts(...)` 走 `CustomRoutingRouter` 直接 unpack
  4. `HunyuanImage3ForConditionalGeneration._patch_moe_blocks()`：
     - 在 `__init__` 里、`_replace_rotary_embeddings()` 之后、weight_load 之前调用
     - **替换前先 pop 旧 experts 的 `compilation_config.static_forward_context[old_prefix]` 注册**——否则新 SharedFusedMoE 撞 `Duplicate layer name` ValueError（vllm `fused_moe/layer.py:327`）
     - **替换前先 `layer.mlp = None; del mlp; gc.collect(); torch.cuda.empty_cache()`**——80B 模型 TP=2 时 parent 已经分配 ~750 MiB experts 缓冲区/层/worker，直接 RHS 求值会 OOM near gpu_memory_utilization 上限

### 验证（2026-04-30）

- 32/32 MoE 层都被替换（log: "Replaced 32 HunYuanSparseMoeBlock layers with HunyuanImage3SparseMoeBlock (fp32 router matching HF reference)"）
- 模型 79 GiB / worker 加载成功
- IT2I greedy 输出长度从 741 chars 增至 811 chars（+9.4%）——determinism 改变是预期的（router 动了）
- 输出消除了一个具体幻觉：旧版有"金毛幼犬开心地吐着舌头"（HF 是"开心地笑着"），新版只描述场景不再编造表情
- 仍未 byte-align HF（HF 466 chars，omni 811 chars）——因为剩下的差异是架构级（PagedAttention vs contiguous KV cache、sampler RNG），见 `hf_omni_alignment_method.md`

### 通用化经验

- HF 模型源码里 `with torch.autocast('cuda', enabled=False):` 是 **explicit 信号**——这块需要 fp32，不能让 AMP 偷偷 cast
- HF 模型源码里 `dtype=torch.float32` 写死的层（router、特定 norm、loss head 等）是 **explicit fp32 buffer**——vllm 默认建 bf16 会精度损失
- 接 HF 模型时必看：（1）所有 `nn.Linear(..., dtype=torch.float32)`；（2）所有 `with torch.autocast('cuda', enabled=False):` 包住的 region
- vllm `SharedFusedMoE` 的 `custom_routing_function` 接口是绕过 bf16 `topk_softmax` 的标准方式——see `modeling_bailing_moe_v2.py: _unpack_multi_routing` 也是同一招
- 替换 `HunYuanSparseMoeBlock` 这类 vllm-builtin 块的 trap：（1）super().__init__() 会预先注册 prefix 到 `static_forward_context`，重建必撞 dup name；（2）OOM 风险因为 parent 已经分配了完整 experts 缓冲。两件事必须在 patch caller 里先 pop registry + free 旧引用 + empty_cache 才能稳

### 没解决的部分

- 长度差（811 vs 466）剩下来源是架构差异，不可消
- sampler 模式下还会再分叉，按 `hf_omni_alignment_method.md` 已知不可对齐
