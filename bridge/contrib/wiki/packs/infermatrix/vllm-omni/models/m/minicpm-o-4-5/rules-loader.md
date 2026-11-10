---
name: rules-loader
description: "MiniCPM-o 4.5 multimodal loader 规则 MCPMO-5a2：SupportsMultiModal 实现必须显式覆盖 embed_multimodal 并委托 get_multimodal_embeddings，避免 V1 profiling 落入 Protocol stub 的 None（PR #7384）"
metadata:
  scope: 只收 MCPMO-5a2 一条规则；输入处理的其他规则 MCPMO-2a 至 2g 归 minicpm-o-4-5-rules-1、minicpm-o-4-5-rules-2 与 minicpm-o-4-5-rules-3
---
# MiniCPM-o 4.5 multimodal loader 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/minicpm-o-4-5/rules-loader.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models；created: 2026-09-22；updated: 2026-09-22
- 来源（sources）：PR #7384
- [MCPMO-5a2] `SupportsMultiModal` 实现必须显式覆盖 `embed_multimodal`
  - 触发：Omni 模型类实现/继承 `get_multimodal_embeddings`，或对齐 vLLM V1 encoder profiling / runtime 的 `embed_multimodal` 调用。
  - 强制：concrete 类必须 override `embed_multimodal` 并委托到现有 `get_multimodal_embeddings`（或等价实现）；不得依赖 Protocol stub 的默认 `None`。同目录 sibling wrapper 已委托时，LLM/核心类必须保持同一合同。
  - 验收：无权重构造 + monkeypatch 断言 `embed_multimodal` 转发 kwargs 并返回 embeddings；去掉 override 时测试必须看到 stub 的 `None`。^[PR #7384]

## 决策与踩坑

- [MCPMO-5a2] 禁止：只实现旧 `get_multimodal_embeddings` 却让 V1 profiling/runtime 落入 stub；把远处的 `NoneType` 启动失败当成权重/registry 问题。
