---
name: 2026-06-16-remote-validation-030-1
description: "2026-06-16 错题 LTX2.3 PR #4464 性能看护验证跑偏（上）：症状、PR head 6372f0de 下 vllm 0.23.0 的有效固定 prompt baseline（qps 0.1663、latency 6.0142s）与八项根因链"
metadata:
  scope: "只收 2026-06-16 LTX2.3 PR #4464 验证跑偏的症状、有效结果与根因链；硬规则、GPU/cleanup gate 与固定流程归 2026-06-16-remote-validation-030-2"
---
# 2026-06-16 — LTX2.3 PR #4464 性能看护验证多次跑偏（1/2）

## 关键事实

- 拆分说明：本页是源页 `2026-06-16-remote-validation-030.md` 的第 1/2 部分；第 2 部分 [[2026-06-16-remote-validation-030-2]]
- 源页：`knowledge/repos/vllm-omni/remote/incidents/performance-validation/2026-06-16-remote-validation-030.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-06-16-remote-validation-030`
- 归属：`repos/vllm-omni/remote`
- 状态：已验证
- 搜索词：LTX2.3 PR #4464 性能看护验证多次跑偏
- 影响范围：repos/vllm-omni/remote
- **症状**：用户要求 LTX2.3 T2V L4 perf PR #4464 用官方固定 prompt 重新跑 `e2e_latency_ms`、`throughput_qps` 和 profiling。过程中连续出现多个低级问题：先没有直接基于 PR #4464 head 跑；远端使用了错误的 `HF_HOME=<REMOTE_WORK_ROOT>/hf-home`；offline 模式下用模型 id 触发 tokenizer hub lookup 失败；
  - fixed prompt 先落成被 `.gitignore` 命中的 `tests/dfx/perf/tests/data/*.jsonl`；runner 子进程 cwd 不同导致相对 `dataset-path` 找不到文件；GPU0 被别人进程占用后仍尝试启动导致 OOM；跑完后还残留了本轮 profiling/serve 进程，需要补清理。
- **实际有效结果**：

```text
PR head: 6372f0dee3bd2aa446480f8a7ad101ba4bc34be1
vllm: 0.23.0
HF_HOME: /data/models
HF_HUB_CACHE: /data/models/hub
snapshot: /data/models/hub/models--dg845--LTX-2.3-Diffusers/snapshots/01fc4e67e5c88bf8c44f5217b9669b7e496fb985
GPU: CUDA_VISIBLE_DEVICES=6
baseline artifact: <REMOTE_WORK_ROOT>/ltx23_t2v_pr4464_official_prompt_inline_gpu6_20260616_140355/results/diffusion_result_test_ltx2_3_vllm_omni_snapshot_20260616-140420.json
throughput artifact: <REMOTE_WORK_ROOT>/ltx23_t2v_pr4464_throughput_inline_gpu6_20260616_140641/results/diffusion_result_test_ltx2_3_vllm_omni_snapshot_20260616-140703.json
```

- Baseline fixed-prompt result:

```text
workload: /v1/videos, 512x384, 25 frames, 20 steps, max_concurrency=1, 3/3 completed
throughput_qps: 0.1663
latency_mean: 6.0142s
peak_memory_mb_max: 73290
stage_0_gen_ms mean: 5123.98
text_encoder.forward mean: 142.31ms
vae.decode mean: 8.81ms
serving path: pure diffusion mode, single diffusion stage
attention: DIFFUSION_ATTENTION_BACKEND=FLASH_ATTN
```

- **问题链路和根因**：
  1. **没有先锁 PR head**：用户已经给了 PR #4464，正确动作应该是远端 `git fetch origin pull/4464/head` 并记录 `HEAD`。我先绕到本地/临时配置和旧分支判断，导致用户质疑“为什么不直接用 PR 跑”。根因是没有把“PR head 是唯一被测对象”写成 scope lock。
  2. **HF cache 路径凭旧印象写错**：我临时设置了 `<REMOTE_WORK_ROOT>/hf-home`，没有先查 live env 或正在跑进程的 `/proc/<pid>/environ`。真实 cache 是 `HF_HOME=/data/models`、`HF_HUB_CACHE=/data/models/hub`。这违反了 `Live facts > knowledge`。
  3. **模型 id 和 offline snapshot 混淆**：PR 配置里保留 `dg845/LTX-2.3-Diffusers` 是对的，但远端 offline 测量时模型 id 会在 `AutoTokenizer.from_pretrained(..., subfolder="tokenizer", local_files_only=True)` 查询 repo-root config 并失败。正确测量方式是先做 tokenizer gate，确认模型 id 失败、绝对 snapshot 成功，然后仅在临时测量 config 中把 `model` 改成 snapshot。
  4. **数据集路径没过 cwd gate**：fixed prompt 先用 `dataset-path: tests/dfx/perf/tests/data/...`，但 runner 启动 benchmark 子进程时 cwd 是 `$WT/tests`，相对路径变成 `$WT/tests/tests/dfx/...`。此外 `tests/dfx/perf/tests/data` 被 `.gitignore` 的 `data/` 规则影响，需要 `git add -f`。
     - 正确做法是复用现有 Hunyuan perf 的 `dataset-path-inline`，让 runner 生成临时 JSONL。
  5. **没有先验证远端 remote 能不能用 Taffy alias**：远端没有 `github-taffy` SSH alias，第一次 fetch fork branch 失败。正确方式是对 public PR 直接 fetch upstream `pull/<id>/head`，不要依赖本机 SSH alias。
  6. **GPU ownership gate 做晚了**：GPU0 初始空闲，但后来被 `<REMOTE_WORK_ROOT>/scripts` 进程占用 125GB，我没有在重跑前重新查 `nvidia-smi` + `/proc/<pid>/cwd`，导致 OOM。正确处理是每次启动前都重查 compute apps，且只能选择当前空闲 GPU；占用方不是本轮 cwd 时禁止 kill。
  7. **cleanup gate 不够前置**：throughput 后发现本轮还有 `<REMOTE_WORK_ROOT>/wt-ltx23-t2v-profile` cwd 的 serve/worker 进程，占用 GPU4。虽然最后按 cwd/PID 清了，但应该在每轮 pytest 结束后立即检查并清理本轮进程。
  8. **PR body provenance 滞后**：PR body 里一度还写旧 head 和旧 profiling 值。性能 PR 体必须在最终跑完后按 head SHA、artifact path、completed/failed、metric 同步更新，不应保留旧证据。
