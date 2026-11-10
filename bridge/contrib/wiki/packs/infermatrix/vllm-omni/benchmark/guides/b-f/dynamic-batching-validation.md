---
name: dynamic-batching-validation
description: "Dynamic / continuous batching 验证：2026-05-26 PR #3766 反例（HunyuanImage3 DiT step batching 在混合 prompt length 下 piecewise_attn requires homogeneous batch）、PR #3857 固定 TORCH_SDPA 的含义，以及 batching 改动 Evidence Matrix 必补的 B1…B5 列（State ABI inventory、Heterogeneous input、Grouped path evidence、Backend constraint、Bad-path behavior）"
metadata:
  scope: 只收合批 / step_execution / merge-split 改动的语义验证矩阵及其反例；证明 grouped DiT 真正命中的 benchmark 步骤归 grouped-dit-benchmark，分叉路径 parity 归 divergent-path-validation
---
# Dynamic / Continuous Batching 验证

## 关键事实

- 源页：`knowledge/repos/vllm-omni/benchmark/guides/dynamic-batching-validation.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, benchmark；created: 2026-07-10；updated: 2026-07-16
- 来源（sources）：#3766；#3857

### Dynamic / continuous batching 验证：shape 能合不等于语义能合

- 以后碰到 batching / `step_execution` / merge-split / attention mask / KV metadata 改动，Evidence Matrix 必须补下面几列：

| ID | 必填项 | 要求 |
| --- | --- | --- |
| B1 | State ABI inventory | 列出 tensor 字段和非 tensor metadata：`full_attn_spans`、slice/offset、position ids、CFG rows、KV metadata、request index 映射 |
| B2 | Heterogeneous input | 至少一组不同 prompt length / request state 的输入；duplicate prompt 只能算 smoke |
| B3 | Grouped path evidence | `max_num_seqs > 1` 与 benchmark `max_concurrency > 1` 同时打开，并用日志/断点证明实际 batch size 或 grouped path 命中 |
| B4 | Backend constraint | FlashAttention / SDPA / custom kernel 的 homogeneous、mask、dtype、layout 约束逐项写清 |
| B5 | Bad-path behavior | 不支持的 metadata 组合必须有显式 fallback、warning 或早炸测试；不能靠 benchmark 没撞到 |

- **一句话规则**：batching PR 的测试目标不是“cat 后 shape 对”，而是“每个 request-local state 在合批、执行、拆回之后语义还对”。

## 决策与踩坑

### Dynamic / continuous batching 验证：shape 能合不等于语义能合

- **2026-05-26 PR #3766 反例**：HunyuanImage3 DiT step batching 的 tensor padding / cat 路径能跑，official benchmark 又默认重复同一 prompt，看起来 grouped batching 正常。但 vbench `--max-concurrency 4` 混入不同 prompt length 后，FlashAttention piecewise path 收到非齐次 `full_attn_spans`，直接报：

```text
ValueError: piecewise_attn requires homogeneous batch: sample 0 spans [(12, 4108)] != sample 2 spans [(9, 4105)]
```

- 漏点不是 tensor shape，而是非 tensor attention metadata 的语义约束。`full_attn_spans` 随 prompt length 变化，padding 后 shape 一样也不代表同一个 FlashAttention backend 能处理。PR #3857 把 HunyuanImage3 DiT precision validation deploy 固定到 `TORCH_SDPA`，本质上也是提醒：backend choice 是 correctness surface，不是无关实现细节。
