---
name: 2026-04-28-profiling-and-model-loading-08
description: 2026-04-28 错题：HunyuanImage3 的 Hunyuan_ATTENTION_CLASSES 硬编码 SDPA，from_pretrained 传 attn_implementation=eager 无效
metadata:
  scope: 只收 2026-04-28 attn_implementation 参数被模型自定义 attention dispatch 忽略这一起事故的症状、根因、解法和提醒；SDPA 的 RoPE 广播报错本身归 2026-04-28-profiling-and-model-loading-11
---
# 2026-04-28 — attn_implementation="eager" 对自定义 attention dispatch 无效

## 关键事实

- 源页：`knowledge/repos/vllm-omni/benchmark/incidents/2026-04-28-profiling-and-model-loading-08.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-04-28-profiling-and-model-loading-08`
- 归属：`repos/vllm-omni/benchmark`
- 状态：已验证
- 搜索词：attn_implementation="eager" 对自定义 attention dispatch 无效
- 影响范围：repos/vllm-omni/benchmark
- **症状**：传了 `attn_implementation="eager"` 但模型仍然走 SDPA，报 `key.size(1) != value.size(1)`
- **根因**：模型自定义了 `Hunyuan_ATTENTION_CLASSES` dict（line 1375），硬编码只有 `HunyuanImage3SDPAAttention`，完全忽略 `from_pretrained` 的 `attn_implementation` 参数
- **解法**：需要在 `Hunyuan_ATTENTION_CLASSES` 里加一个 eager 实现（用 `torch.matmul` + `softmax` 替代 `scaled_dot_product_attention`），或直接 patch `HunyuanImage3SDPAAttention.forward` 把 SDPA 换成手动实现
- **对未来的提醒**：`trust_remote_code` 模型的 `attn_implementation` 参数不一定生效——先 `grep ATTENTION_CLASSES` 看模型自己的 dispatch 逻辑
