---
name: 2026-06-17-remote-validation-031
description: "2026-06-17 错题：LTX2.3 PR #4464 的 torch.compile benchmark 写出 mean 10.69 对 median 4.01 的半冷口径，实为 CustomDataset 没把 num_frames/fps 传到 RequestFuncInput 而 warmup 被强制 25f；修复后 eager 与 compile 的 qps 均约 0.166；含先审 payload、warmup 与 measured 同源的规则"
metadata:
  scope: 只收 2026-06-17 LTX2.3 baseline 被半冷口径与 payload 漏传带偏这一起事故；同一 PR 早先的性能看护验证跑偏归 2026-06-16-remote-validation-030-1、2026-06-16-remote-validation-030-2
---
# 2026-06-17 — PR #4464 LTX2.3 L4 baseline 被半冷口径和 payload 漏传带偏

## 关键事实

- 源页：`knowledge/repos/vllm-omni/remote/incidents/performance-validation/2026-06-17-remote-validation-031.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-06-17-remote-validation-031`
- 归属：`repos/vllm-omni/remote`
- 状态：已验证
- 搜索词：PR #4464 LTX2.3 L4 baseline 被半冷口径和 payload 漏传带偏
- 影响范围：repos/vllm-omni/remote
- **症状**：LTX2.3 T2V L4 PR #4464 的 torch.compile benchmark 一度写出 `throughput_qps=0.0936`、`latency_mean=10.6879`、`latency_median=4.0096`，并把它解释成 semi-cold guard。用户指出 `latency_mean` 和 `latency_median` 差异异常，不应该把预热编译计入正式 baseline。
  - 后续 sub-agent 才定位到关键问题：custom dataset measured 请求没有把 benchmark config 里的 `num_frames` / `fps` 传播到 `RequestFuncInput`，而 warmup 通过 `--warmup-num-frames=25` 被强制成 25f。结果 warmup 和 measured 请求不是同一个 shape 口径。
- **直接影响**：
  - 错误方向上尝试过 `ignore-first-measured-requests`，这会改变 measured 样本数，和 perf runner 的 `completed == num_prompts` contract 冲突。
  - PR body 过早发布了 semi-cold 表格，后来必须回退。
  - 远端跑数和读结果期间又踩了 PowerShell/SSH 引号、BOM、`$!` pid 写成字面量、here-doc 读 JSON 失败等旧坑。
- **最终有效修复**：

```text
head: 96e342830c0b383f628eacb7ba58b15208ce0376
fix: CustomDataset propagates num_frames and fps into RequestFuncInput
unit: tests/dfx/perf/tests/test_diffusion_benchmark_warmup.py 3 passed
L4 assert: tests/dfx/perf/scripts/run_diffusion_benchmark.py --assert-baseline 2 passed
```

- 最终 L4 指标：

```text
workload: /v1/videos, 512x384, 25 frames, 24 fps, 20 steps, num_prompts=3, max_concurrency=1
eager throughput_qps: 0.166288
eager latency_mean: 6.013432s
compile throughput_qps: 0.166240
compile latency_mean: 6.015079s
```

- **根因**：
  1. 没先按 benchmark 数据链路审计。正确顺序应是 `test_ltx2_3_vllm_omni.json -> run_diffusion_benchmark.py -> CustomDataset.__getitem__() -> RequestFuncInput -> async_request_v1_videos form fields -> server log`。我只看 config 中有 `num-frames=25`，就假设 measured 请求会带上它。
  2. 看到 `mean >> median` 后先往 torch.compile settle / semi-cold 解释，而不是把异常当成 payload 或样本集合不一致信号。
  3. 试图通过 `ignore-first` 过滤指标，属于在指标层修补症状；正确做法是先修 measured shape 传播。
  4. PR body provenance gate 做晚了，探索 run 还没被最终 assert 验证就写成 reviewer-facing baseline。
  5. 远端执行没有全程坚持文件脚本模式，导致 PowerShell 本地展开、空脚本、BOM、pid 写错、here-doc 失败等噪音叠加耗时。
- **硬规则**：
  1. benchmark 异常先审 payload，不先审结论。凡是出现 `latency_mean` 明显大于 `latency_median`、首个 measured 明显慢、warmup/compile 口径被质疑，必须先打印/证明：

     ```text
     config fields
     runner CLI argv
     dataset -> RequestFuncInput fields
     backend payload/form fields
     server log sampling params
     per-request latency
     ```

     - 这些不一致时，禁止更新 baseline。
  2. warmup shape 和 measured shape 必须同源验证。不能只证明 warmup request 被强制成目标 shape；还要证明 measured request 也带着同一组 `width/height/num_frames/fps/num_inference_steps`。
  3. 不要先加指标过滤 knob。`ignore-first`、settle request、baseline tolerance 放宽都不能用来解释未知首条慢请求；只有 root cause 已确认且样本集合 contract 不被破坏时，才允许新增统计口径。
  4. 性能 PR body 只写 final assert 结果。探索 run、失败 run、半冷口径、待确认 caveat 不进公开 baseline；如果已经写进去，必须先回退再继续调试。
  5. PowerShell 到 SSH 的 benchmark/读结果动作只用远端脚本文件。涉及 `$!`、`$VAR`、here-doc、JSON 解析、后台 pid、长命令时，必须：

     ```bash
     wc -c /tmp/run.sh
     sed -n '1,80p' /tmp/run.sh
     perl -i -pe 's/^\xEF\xBB\xBF//' /tmp/run.sh
     bash -n /tmp/run.sh
     ```

     - 然后再 `nohup bash /tmp/run.sh ... & echo $! > /tmp/run.pid`，确保 `$!` 在远端 shell 展开。
- **下次固定流程**：

```text
1. 读 PR head、config、runner/client 代码，写 metric contract。
2. 从 config 追到 backend payload，确认 measured 请求字段完整。
3. 再跑 warmup/compile 相关实验；异常时先查 per-request latency 和 server sampling params。
4. 修语义 bug 后跑 unit + full L4 assert。
5. 只把 final head + final result JSON + assert pass 写进 PR body。
```
