---
name: 2026-06-17-remote-validation-001
description: "2026-06-17 错题：PR #4041 512 step-SDPA 验证（step_execution=true、max_num_seqs=8、TORCH_SDPA、batch 2/4/8）重跑通过后，复盘险些写进个人 Codex 私有目录而非本仓；含旧 artifact 分类、config-only 目录误导、有效结果 completed=8 failed=0 与 PowerShell 脚本 BOM/CRLF 预防"
metadata:
  scope: "只收 2026-06-17 PR #4041 512 step-SDPA 验证的有效结果与复盘落盘位置错误；跑错 workload 的更早事故归 2026-06-15-remote-validation-002，本仓不放个人 memory 的规则见本页引用的 benchmark scope 指南"
---
# 2026-06-17 — PR #4041 512 step-SDPA 验证复盘必须落本仓，不落个人 Codex 私有目录

## 关键事实

- 源页：`knowledge/repos/vllm-omni/remote/incidents/performance-validation/2026-06-17-remote-validation-001.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-06-17-remote-validation-001`
- 归属：`repos/vllm-omni/remote`
- 状态：已验证
- 搜索词：PR #4041 512 step-SDPA 验证复盘必须落本仓，不落个人 Codex 私有目录
- 影响范围：repos/vllm-omni/remote
- 规则入口：仓库上下文落盘规则见根目录 `CLAUDE.md`；远端 benchmark / accuracy 证据规则见 [[benchmark-scope-1]]、[[benchmark-scope-2]]（benchmark scope）。本节只保留反例和本轮有效结果，不作为主规则入口。
- **症状**：用户要求“跑一下精度用例看看，要求 image size=512, batch=2,4,8”。执行过程中先把旧 PR body / 旧 artifact 当线索继续追，发现多份结果都不能直接作为本次证据：旧 512 accuracy 只有 batch=1/2；旧 performance sweep 有 b2/b4/b8 但不是当前 PR head / 当前 step-execution 口径；远端已有若干 `pr4041_023_groupbatch_512_*` 目录实际只是 config JSON 或跑的是默认 `max_num_seqs=1` deploy。
  - 最终重新跑通显式 `step_execution=true`、`max_num_seqs=8`、`DIFFUSION_ATTENTION_BACKEND=TORCH_SDPA`、512x512、batch/concurrency 2/4/8 后，用户要求“落盘”。我却先准备写到用户个人 Codex 目录，这违反本仓规则：长期知识只写本仓 `general/` 或 `repos/`，机器事实写 ignored `local/`，禁止写个人 memory。
- **根因**：
  1. 把 Codex 私有 memory 更新规则错误地覆盖了仓库 AGENTS / `CLAUDE.md` 规则。用户在这个仓库里说“落盘”，默认应理解为写入本仓长期记录，除非用户明确说写个人 Codex memory。
  2. 远端验证前没有一次性锁定“可发布证据”的完整口径，导致旧 artifact 需要反复排除：PR head、vLLM 版本、venv、deploy config、attention backend、`step_execution`、`max_num_seqs`、GPU、result JSON 都必须同轮对齐。
  3. 目录名造成误导。`pr4041_023_groupbatch_512_sdpa_*` 看起来像完成结果，但其中多份只有 benchmark config JSON；另一个 completed run 使用默认 deploy，没有 `step_execution=true`，所以不能证明 grouped step path。
  4. 把 client `max-concurrency=2/4/8` 和 server grouped batch 混在一起看。只有同时证明 server `step_execution=true`、`max_num_seqs >= 8`、backend 生效、result rows `completed=8 failed=0`，才是本次请求的有效验证。
  5. PowerShell -> SSH -> bash 链路仍然有 BOM/CRLF 和参数漂移风险。第一轮远端脚本带 UTF-8 BOM/CRLF，且误传不存在的 pytest `--results-dir`，pytest exit 4；幸好失败发生在模型启动前，没有形成假 benchmark。
- **有效结果**：

```text
PR: vllm-project/vllm-omni#4041
PR head: 162c6f1a11e7e92949dfea48bc10cf1b03bd12bb
Remote: root@<REMOTE_HOST>:31449
Worktree: <REMOTE_WORK_ROOT>/wt-pr4041-023-groupbatch
Python: <REMOTE_WORK_ROOT>/.venv-vllm023-baseline/bin/python
vLLM: 0.23.0
CUDA_VISIBLE_DEVICES: 5,6
Backend: DIFFUSION_ATTENTION_BACKEND=TORCH_SDPA
Deploy: inline hunyuan_image3_dit, step_execution=true, max_num_seqs=8
Workload: 512x512, 50 steps, num_prompts=8, max_concurrency=2/4/8
Run dir: <REMOTE_WORK_ROOT>/pr4041_512_step_sdpa_rerun_20260615_180116/run
Result JSON: <REMOTE_WORK_ROOT>/pr4041_512_step_sdpa_rerun_20260615_180116/run/results/diffusion_result_test_pr4041_512_step_grouped_sdpa_batch_2_4_8_20260615-180205.json
Pytest: status=0, 3 passed
```

```text
batch=2: completed=8 failed=0 duration=35.95s stage_0_gen_ms_mean=8828.14 amortized_gen_per_req=4.414s
batch=4: completed=8 failed=0 duration=33.62s stage_0_gen_ms_mean=16357.06 amortized_gen_per_req=4.089s
batch=8: completed=8 failed=0 duration=31.86s stage_0_gen_ms_mean=30853.85 amortized_gen_per_req=3.857s
```

- **正确做法**：
  1. 用户在仓库上下文里说“落盘 / 记录 / 复盘”时，先按 `CLAUDE.md` 写本仓 `general/` 或 `repos/`；机器事实写 ignored `local/`，禁止默认写用户个人 Codex 目录。
  2. 远端验证先写 scope lock，再跑：

     ```text
     PR / head SHA:
     worktree / venv / vLLM:
     deploy config:
     step_execution / max_num_seqs:
     backend:
     image size / steps / num_prompts / max_concurrency:
     CUDA_VISIBLE_DEVICES / GPU ownership:
     result JSON path:
     pass/fail criterion:
     ```

  3. 复用旧 artifact 前先分类：

     ```text
     config-only: 不能作为结果
     completed but wrong deploy/path: invalid for current request
     completed and scope-aligned: 可作为证据
     ```

  4. HunyuanImage3 grouped step 验证至少要 grep / log 证明：

     ```text
     DIFFUSION_ATTENTION_BACKEND parsed as target backend
     selector resolved target backend
     config has step_execution=true
     config has max_num_seqs >= requested batch
     result completed_requests == num_prompts
     result failed_requests == 0
     ```

  5. PowerShell 投递远端脚本必须 file-backed，并在远端执行前固定：

     ```bash
     perl -i -pe 's/^\xEF\xBB\xBF//; s/\r$//' <script>
     wc -c <script>
     sed -n '1,80p' <script>
     bash -n <script>
     ```

  6. 不要临时猜 pytest / benchmark 参数。先读 harness help 或源码；本次正确结果目录应通过 `DIFFUSION_BENCHMARK_DIR`，不是不存在的 `--results-dir`。
- **怎么避免**：这类请求的第一验收标准不是“有个 benchmark 跑完”，而是“当前 PR head + 当前目标 deploy path + 当前 workload + 当前 backend + 当前 result JSON”全部对齐。复盘落盘同理，第一验收标准不是“我写了 memory”，而是“写到了这个仓库其他人会读到的位置”。
