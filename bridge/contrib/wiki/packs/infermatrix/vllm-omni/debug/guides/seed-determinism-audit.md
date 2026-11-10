---
name: seed-determinism-audit
description: "同 seed 多次运行输出不同时的审计清单：先确认 AR stage 是否 greedy（temperature 0.0 时 seed 不参与采样）、只读核对 api_server.py:1845 与 serving_chat.py ~2282 的 seed 传递、greedy 漂移的 LOGITS 层嫌疑顺序表（MoE expert tie-breaking 居首）、修复选项成本表、PR #3444 P2 审计（2026-05-11，Run 1 686 tokens vs Run 2 613 tokens，A1 回滚）"
metadata:
  scope: "只收同一路径同 seed 漂移的审计顺序与 PR #3444 P2 的记录；跨路径系统性偏差的分类归 systematic-vs-stochastic，显式随机源 grep 归 alignment-debug"
---
# Seed 确定性审计流程

## 关键事实

- 源页：`knowledge/repos/vllm-omni/debug/guides/seed-determinism-audit.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, debug；created: 2026-07-10；updated: 2026-07-16
- When a user reports "same `seed=N` produces different images / cot text across runs", do NOT immediately suspect the seed plumbing code. Walk this checklist first:

### 1. Confirm sampling mode

- Look at the AR stage `default_sampling_params` in the yaml. For HunyuanImage-3.0 / GLM-Image and most image-gen multi-stage configs it's:

```yaml
default_sampling_params:
  temperature: 0.0
  top_p: 1
  top_k: -1
```

- That's **greedy** (argmax). Greedy decoding **does not use seed for sampling** — `seed` only matters for stochastic samplers (`temperature > 0` or `top_k > 0`).
- **Implication:** if AR is greedy and outputs still drift across same-seed runs, **the seed plumbing is not the bug.** Drift comes from non-deterministic LOGITS, not non-deterministic SAMPLING.

### 2. Confirm seed is plumbed correctly (read-only verification)

- For `/v1/images/edits` flow:
  - `api_server.py:1845`: `seed = seed if seed is not None else random.randint(0, MAX_UINT32_SEED)` -> `gen_params.seed = seed`
  - `serving_chat.py:_build_multistage_generation_inputs` reads `seed = gen_params.seed` and at line ~2282 does `default_stage_params.seed = seed` for the comprehension (AR) stage.
- If you DON'T see drift across same-seed runs, code is correct AND you got lucky. If you DO see drift across same-seed runs **AND** AR is greedy, code is correct AND drift is downstream.

### 3. Suspect order for greedy drift (LOGITS layer)

| # | Suspect | Evidence to gather |
|---|---|---|
| 1 | **MoE expert tie-breaking** (top-k expert selection in BF16; tied scores resolved non-deterministically per kernel call) | Highest prior for MoE models (HunyuanImage-3.0, GLM-Image). Check yaml `enable_expert_parallel: true`. |
| 2 | cuBLAS / cuDNN non-deterministic matmul / attention atomic-add | Mid prior. `torch.use_deterministic_algorithms(True)` would surface as warnings/errors. |
| 3 | KV cache layout / scheduler timing (vLLM V1 batcher state is request-order-dependent) | Affects same-server but should NOT affect cold-start single-request. |
| 4 | Per-request `torch.manual_seed(...)` not called -> ops using global RNG drift | Confirm by grep `torch.manual_seed` / `manual_seed_all` in worker init paths. |

### 4. Fix options weighted

| Option | Cost | Fixes |
|---|---|---|
| `torch.use_deterministic_algorithms(True)` + `CUBLAS_WORKSPACE_CONFIG=:4096:8` env + per-request `torch.manual_seed(seed)` | High: perf hit, some kernels raise NotImplementedError under deterministic mode. Needs worker-init patch. | Most of #1-#4. |
| Force float32 for MoE routing | Mid: memory hit, dispatch slowdown. | #1 (tie-breaking is BF16 artifact). |
| Document as inherent MoE+greedy non-determinism, decline to fix | 0 | Nothing (just sets user expectation). |
| Naively delete the seed plumbing line at serving_chat.py:2282 (because "offline doesn't set AR seed") | Breaks `test_multistage_images_async_omni_construction` which asserts AR.seed==user_seed. Existing **explicit contract**. | Nothing user-visible; just a path-level cosmetic change. |

### 5. Specific to PR #3444 P2 audit (2026-05-11)

- Setup: HunyuanImage-3.0-Instruct, multi-image IT2I, 4x L20X, online `/v1/images/edits` with `task=it2i bot_task=think_recaption sys_type=en_unified seed=42 steps=50 guidance=5.0`.
- Run 1: AR 686 tokens / cot 1184 chars.
- Run 2 (same server, same params): AR 613 tokens / cot 1066 chars. PNG hash differs.
- Verified `serving_chat.py:2282` does set AR seed=42 for both runs.
- Conclusion: drift is CUDA/MoE non-determinism, not seed code. **No fix landed in PR #3444** beyond documenting this.
- Attempted "A1" — delete the AR seed setter at `serving_chat.py:2282` to align with offline `end2end.py` (which never sets AR seed) — **rolled back** because it broke `test_multistage_images_async_omni_construction::assert captured[0].seed == 7`, which explicitly pins the contract for the t2i path.
- **Reminder for future maintainers:** treating "same seed -> different output" as a P0 will burn hours on seed plumbing that isn't broken. Confirm sampling mode (greedy vs stochastic) **first**.
