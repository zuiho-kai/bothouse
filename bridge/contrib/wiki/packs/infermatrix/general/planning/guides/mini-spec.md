---
name: mini-spec
description: Canonical Mini Spec：开发前 gate 的最小模板、model/checkpoint appendix、reviewer-lens appendix，以及本页作为 mini spec 唯一模板的 source of truth 约定
metadata:
  scope: 只收 mini spec 的 canonical 模板、两个可选 appendix 和何时必须写；实现与验证方法归 implementation-validation，产品闭环拆任务归 product-loop-planning
---
# Canonical Mini Spec

## 现状

- **何时来翻**：新模型、新 pipeline、新 backend、已有模型新增 public path、execution path 变更、public 字段 / multimodal payload 变更、性能 claim PR、docs / recipe / supported model / perf config 公开入口变化。
- Mini spec 是开发前 gate，不是 review 后补账。写不出来就先不要编码；五行能讲清就写五行，五行也讲不清说明改动不是小改。

## 关键事实

- 源页：`knowledge/general/planning/guides/mini-spec.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, planning；created: 2026-07-10；updated: 2026-07-10；sources: 无

### 1. 最小模板

```text
Mini spec
- Goal:
- User-visible/public surface:
  - offline:
  - serving/API:
  - docs/config/recipe:
- Source of truth:
  - upstream code/docs:
  - current repo owner/helper:
- Request / config semantics:
  - fields:
  - defaults:
  - invalid input behavior:
- Validation contract:
  - local:
  - remote/GPU:
  - perf/accuracy:
- Explicit non-goals:
```

### 2. Model / checkpoint appendix

- 只有涉及新模型、checkpoint layout、pipeline 或 adapter 时补这段：

```text
- Checkpoint layout:
  - runnable model id:
  - raw/upstream model id:
  - required files/subfolders:
- Stage / pipeline matrix:
  - tokenizer/processor:
  - AR / DiT / VAE / other stages:
  - offline vs serving:
- Parity target:
  - HF/upstream behavior:
  - acceptable smoke vs semantic parity:
```

### 3. Reviewer-lens appendix

- 只有准备 review / merge / public PR 时补这段：

```text
- Duplication risk:
- Layering / owner:
- Edge cases:
- Surface area touched:
- PR evidence placement:
```

### 4. Source of truth

- 本页是 mini spec 的 canonical template。`model_adaptation_pr_guardrails.md` 可以追加模型/checkpoint 细节；`reviewer_lens_audit.md` 可以追加 reviewer-lens 自审维度；二者不能定义互相竞争的 mini spec。
