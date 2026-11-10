---
name: rules-token2wav-attention
description: "Qwen2.5-Omni 规则 QOMNI-TOKEN2WAV-BLOCK-1a：Token2Wav DiT block_sparse_attention 保留 dense window 的可见 key、最后 partial block 与越界邻块 mask、输出裁回原 seq_len（PR #7975）"
metadata:
  scope: 只收 QOMNI-TOKEN2WAV-BLOCK-1a 一条规则；Qwen2.5 code2wav 缺失 soft-fail 的 QOMNI-1e 归 qwen-omni-rules
---
# Qwen2.5-Omni Token2Wav block attention 合同

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/qwen-omni/rules-token2wav-attention.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models；created: 2026-10-09；updated: 2026-10-09
- 来源（sources）：PR #7975
- 置信度（confidence）：high
- [QOMNI-TOKEN2WAV-BLOCK-1a] block attention 保留 dense window 的可见 key 与输出布局
  - 触发：修改 Qwen2.5 Token2Wav DiT block_sparse_attention 或窗口参数。
  - 强制：只计算本块与配置允许的前后邻块；最后 partial block 和越界邻块的 key 必须 mask，输出裁回原 seq_len。保持 query/key/value 的 batch/head/seq/dim 布局及输出 transpose 后的 token/head 拼接，不重建每层 n×n dense mask。
  - 验收：dense masked SDPA oracle 比较短于一块、整块和 partial tail；覆盖当前 own/backward/forward 窗口，新增更大邻域时另测越界几何；真实 GPU 性能与音频质量单独验证。 ^[PR #7975]

## 决策与踩坑

- [QOMNI-TOKEN2WAV-BLOCK-1a] 禁止：让 padding key 参与 softmax；混淆 block 窗口方向或 head/seq；从小 CPU oracle 推出所有窗口大小、GPU backend 或端到端音频已验证。
