---
name: 2026-05-26-ci-and-testing-03
description: "2026-05-26 CI 错题 inc-2026-05-26-ci-and-testing-03，PR #3766 HunyuanImage3 DiT batching 在 vbench 并发 4 下报 piecewise_attn requires homogeneous batch，漏测非齐次 full_attn_spans，解法是 FLASH_ATTN 遇非齐次 span fallback 到 SDPA"
metadata:
  scope: "只收 2026-05-26 PR #3766 DiT batching 漏审非 tensor attention metadata 这一起错题及异质输入测试提醒；同一 PR 的 ruff format 错题归 2026-05-21-ci-and-testing-04"
---
# 2026-05-26 — PR #3766 DiT batching 漏测非齐次 attention metadata

## 关键事实

- 源页：`knowledge/repos/vllm-omni/ci/incidents/2026-05-26-ci-and-testing-03.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-05-26-ci-and-testing-03`
- 归属：`repos/vllm-omni/ci`
- 状态：已验证
- 搜索词：PR #3766 DiT batching 漏测非齐次 attention metadata
- 影响范围：repos/vllm-omni/ci
- **症状**：Semmer2 用 `diffusion_benchmark_serving.py --dataset vbench --task t2i --max-concurrency 4 --num-inference-steps 50` 测 HunyuanImage3 DiT batching 时，
  - 服务端在 FlashAttention piecewise path 报 `ValueError: piecewise_attn requires homogeneous batch: sample 0 spans [(12, 4108)] != sample 2 spans [(9, 4105)]`。默认 `hunyuan_image3_dit.yaml` 和之前 benchmark 没暴露这个问题。
- **根因**：我把 grouped batching 的风险主要建模成 tensor shape/padding/cat 问题，漏审了非 tensor attention metadata。`full_attn_spans` 随 prompt length 变化；不同 prompt 合批后，即使 q/k/v shape 能 pad 到一致，FlashAttention piecewise backend 仍要求每个 sample 的 full-attn span homogeneous。official benchmark 默认重复同一 prompt，span 天然一致；
  - 默认配置若 `max_num_seqs: 1` 又会让“服务能跑”变成假信心。
- **解法**：在 `Attention._run_local_attention` 对 `FLASH_ATTN` + 非齐次 `full_attn_spans` 做显式检测，有 `attn_mask` 时 fallback 到 SDPA，并用 `warning_once` 标记。新增单测分别覆盖非齐次 fallback 和齐次仍走 FlashAttention。
  - 远端 B1 复现验证：新增单测 2 passed，vbench smoke `num_prompts=8/max_concurrency=4/steps=8` 不再触发 `piecewise_attn requires homogeneous batch`。参考 PR #3857：HunyuanImage3 DiT precision validation deploy 选择 `TORCH_SDPA`，说明 backend 本身就是正确性口径的一部分。
- **对未来的提醒**：
  1. batching / `step_execution` / `InputBatch` merge-split 改动，测试不能只证明 tensor shape 能合；必须列完整 state ABI，包括 tensor 字段和非 tensor metadata。
  2. 至少补一组异质输入：不同 prompt length、不同 request-local metadata、`max_concurrency/max_num_seqs > 1`，并证明实际命中 grouped path。
  3. duplicate prompt benchmark 只能证明 smoke，不能证明 variable prompt dynamic batching。
  4. backend 有 homogeneous span、mask layout、dtype、precision 约束时，必须写清 fallback/early error，并用坏路径单测锁住。
