---
name: magi2-overview
description: "MAGI-2 Preview 模型 owner 入口：本地 routed MoE、派生 weight cache、BF16 kernel/launch 与 checkpoint 加载的触发条件，源码 mh_moe.py、fused_moe_kernels.py、modeling_magi2.py，EP 与框架通信归共享 distributed owner（PR #7206）"
metadata:
  scope: 只收 MAGI-2 的触发条件、源码入口与归属边界；BF16 routed MoE 规则 MAGI2-MOE-1a/1b 归 magi2-rules
---
# MAGI-2 Preview

## 现状

- 触发：MAGI-2本地routedMoE、derivedweightcache、BF16kernel/launch或modelcheckpoint加载。
- 源码：`diffusion/models/magi2/mh_moe.py`、`fused_moe_kernels.py`、`modeling_magi2.py`。
- [[magi2-rules]]（BF16 routed MoE规则）：eligibility、cache失效、head/routing/numerical/launch验收。
- EP/framework通信归shared distributed owner，attention/其他modelfamily不得从此fusedcontract外推。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/magi2/_index.md`（InferMatrixCopilot@ecfb84d0）；title: MAGI-2 Preview model owner；type: index；tags: vllm-omni, models, diffusion；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #7206；vllm_omni/diffusion/models/magi2/
