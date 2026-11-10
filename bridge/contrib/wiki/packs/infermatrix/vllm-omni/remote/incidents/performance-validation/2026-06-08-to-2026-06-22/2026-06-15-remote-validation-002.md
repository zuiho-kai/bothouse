---
name: 2026-06-15-remote-validation-002
description: "2026-06-15 错题：PR #4041 在 vLLM 0.23.0 下要求 512x512、50 steps、batch 2/4/8，却先跑成 1024x1024、8 steps、concurrency 1，又因 max_num_seqs=1 把并发误当 grouped batch，另踩 heredoc JSON 引号、ulysses_degree 配置与漏 step_execution 的坑；含 grouped batch 证明清单与 Scope Lock 模板"
metadata:
  scope: "只收 2026-06-15 PR #4041 0.23 benchmark 跑错 workload 与并发误报 grouped batch 这一起事故；该 PR 更早的验证失控归 2026-06-05-remote-validation-025，后续 512 step-SDPA 结果与落盘位置归 2026-06-17-remote-validation-001"
---
# 2026-06-15 — PR #4041 0.23 benchmark 先跑错 workload，又把并发误报成 grouped batch

## 关键事实

- 源页：`knowledge/repos/vllm-omni/remote/incidents/performance-validation/2026-06-15-remote-validation-002.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-06-15-remote-validation-002`
- 归属：`repos/vllm-omni/remote`
- 状态：已验证
- 搜索词：PR #4041 0.23 benchmark 先跑错 workload，又把并发误报成 grouped batch
- 影响范围：repos/vllm-omni/remote
- **症状**：用户要求把 PR #4041 里需要的 HunyuanImage3 benchmark 数据落成当前 PR body 格式：vLLM 0.23.0、image size 512x512、50 steps、batch 2/4/8。第一轮跑成 benchmark 默认/旧 workload，得到 1024x1024、8 steps、concurrency 1 的三组无关结果。第二轮虽然改成 512x512、batch 2/4/8，但 deploy 仍是 `max_num_seqs=1`，所以只是 client 侧并发，不是真正 grouped DiT batch。
  - 后续切到 grouped 配置时又连续踩 PowerShell/SSH heredoc JSON 引号剥离、`ulysses_degree=2` 与 `sequence_parallel_size=1` 配置不匹配、漏 `step_execution: true` 导致日志降级回 `max_num_seqs=1`。
- **根因**：
  1. 没先读 PR body 当前表格格式和用户指定 workload，就直接用手边 benchmark harness 开跑。
  2. 把 benchmark client 的 `max-concurrency` 当成 server grouped batch，没检查 deploy 中 `step_execution` / `max_num_seqs` 是否生效。
  3. 启动服务后没有先扫日志确认没有 fallback；等完整 sweep 跑完才回头发现它不是 grouped path。
  4. 远端配置用 inline/heredoc 临时拼，PowerShell 到 SSH 的 quoting 风险没有通过落盘脚本和 `bash -n` / `sed` gate 消掉。
  5. 没把 baseline 与 PR grouped 的实验变量写成 scope lock，导致 vLLM 版本、backend、workload、batch 含义在口头状态里漂移。
- **硬规则**：
  1. PR benchmark 不是先跑数据再想怎么填表。开跑前必须读当前 PR body / reviewer request，抄出现有列名和口径，写到 `$OUT/scope.txt`。
  2. HunyuanImage3 grouped batch 必须同时证明：

     ```text
     client max-concurrency = 2/4/8
     server step_execution = true
     server max_num_seqs >= requested batch
     startup log has no fallback to max_num_seqs=1
     result row completed_requests == num_prompts
     result row failed_requests == 0
     ```

     - 缺任一项，只能叫 smoke / concurrent baseline，不能叫 grouped batch。
  3. baseline 和 grouped PR 要分清：

     ```text
     baseline: upstream/main SHA, vLLM version, max_num_seqs=1, backend
     grouped: PR SHA, vLLM version, step_execution=true, max_num_seqs=<n>, backend
     workload: image size, steps, num-prompts, max-concurrency, endpoint
     ```

  4. 远端 deploy/config 不用长 inline JSON。生成脚本或配置文件后固定检查：

     ```bash
     wc -c <file>
     sed -n '1,80p' <file>
     python -m json.tool <json> >/dev/null  # JSON 时
     bash -n <script>                       # bash 时
     ```

  5. 正式 sweep 前先做 1 条小 smoke，目的不是性能，而是日志 gate：确认 `step_execution=true`、`max_num_seqs`、attention backend 和 grouped path 生效。
  6. 如果发现跑错 workload / 跑错 execution path，旧结果必须标成 `invalid for current PR request`，不得为了“已有数据”继续转换格式或写入 PR。
- **正确处理模板**：

```text
Benchmark Scope Lock
- PR body target section:
- Baseline SHA / vLLM:
- PR SHA / vLLM:
- Image size / steps:
- Requests / concurrency:
- Baseline deploy:
- Grouped deploy:
- Backend:
- Smoke log gate:
- Result JSON:

Result Classification
- baseline: valid / invalid, reason:
- grouped: valid / invalid, reason:
- rows safe to publish:
```

- **怎么避免**：把“数据是否能填 PR 表”作为第一验收标准，而不是“pytest/benchmark status=0”。`status=0` 只证明某个 workload 完成；只有 workload、server deploy、日志 gate、result JSON 同时对齐，才是可发布的性能基线。
