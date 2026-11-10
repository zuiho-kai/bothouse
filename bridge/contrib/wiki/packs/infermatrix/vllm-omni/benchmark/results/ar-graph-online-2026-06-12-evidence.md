---
name: ar-graph-online-2026-06-12-evidence
description: "2026-06-12 AR graph perf PR #4363 证据口径：trace / no-profiler benchmark / AR-only prefix accuracy 三层证据、可复用的 bench 写法、Tensor.item() 50.25s 到 0.36s 与吞吐 +4.0% 的性能表、精度写法和执行顺序"
metadata:
  scope: "只收 PR #4363 最终采用的证据分层、benchmark 口径、before/after 表、解释边界、精度说明和下次执行顺序；各轮原始数字归 ar-graph-online-2026-06-09-trace、ar-graph-online-2026-06-09-no-profiler 和 ar-graph-online-2026-06-10-tail-gap"
---
# AR Graph Performance PR 证据口径

## 关键事实

- 源页：`knowledge/repos/vllm-omni/benchmark/results/ar-graph-online-2026-06-12-evidence.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

### AR graph perf PR 证据口径（2026-06-12）

- 这轮最终用于 PR 的证据分三层，不要混报：
  1. **算子/同步点证据**：来自 request-window profiler trace，用来证明 `timestep_mask.sum().item()` 是真实 GPU scalar sync。
  2. **端到端性能证据**：来自 no-profiler online benchmark，用来证明收益不是 profiler artifact。
  3. **精度证据**：来自 AR-only prefix accuracy，用来证明改动没有破坏 AR 输出语义。
- 最终 PR #4363 的可复用写法：
  - server path：`vllm serve` + `hunyuan_image3_ar` deploy + `enforce_eager: false`
  - bench script：`vllm bench serve`
  - endpoint/backend：`/v1/chat/completions` + `openai-chat-omni`
  - workload：`random-mm`，`num_prompts=10`，`max_concurrency=1`，每请求 1 张 `1024x1024` 图片，`input_len=256`，`output_len=512`，`temperature=0`，`ignore_eos=True`
  - request body override：`{"modalities":["text"],"bot_task":"think"}`
- PR 性能表要同时给绝对值和百分比：

| Metric | Before | After | Change |
|---|---:|---:|---:|
| Total `Tensor.item()` time | `50.25s` | `0.36s` | `-99.3%` |
| Slow `Tensor.item() >50ms` | `18` | `0` | `-100.0%` |
| Max `Tensor.item()` | `209.153ms` | `10.174ms` | `-95.1%` |
| Input-prep p50 | `5.910ms` | `1.642ms` | `-72.2%` |
| Benchmark duration | `41.83s` | `40.20s` | `-3.9%` |
| Output tok/s | `72.54` | `75.47` | `+4.0%` |
| Mean TPOT | `15.93ms` | `15.25ms` | `-4.3%` |
| Mean ITL | `6.84ms` | `6.54ms` | `-4.4%` |

- 解释边界：
  - 可以说：这个 PR 移除了 HunyuanImage3 AR embedding path 的一个逐 step GPU scalar sync，`Tensor.item()` profiler 总耗时下降 `99.3%`，同口径 no-profiler online benchmark 端到端吞吐提升约 `4%`。
  - 不要说：这个 PR 解决了所有 GPU 空转。trace 仍显示 tail gap 集中在 `cudaGraphLaunch` / graph replay 提交边界。
  - 不要用 profiler target request 的 TPOT 当最终性能结论；profiler run 只解释热点和调用栈。
- 精度结果不能只写一行 PASS。PR 里要写清楚：
  - 为什么理论上不影响精度：所有 `<timestep>` token 仍然拿 `timestep_emb(0)`，非 `<timestep>` token embedding 不变。
  - 为什么 AR-only accuracy 是相关检查：改动只在 AR embedding replacement，不碰 DiT image generation。
  - 用什么输入：`tests/e2e/accuracy/test_hunyuan_image3.py` 里的同一组 `PROMPT` 和 `TEST_IMAGE_URLS`，prompt format 为 `task=it2i`、`bot_task=think_recaption`、`sys_type=en_unified`、`num_images=2`。
  - 用什么指标：`text_prefix_match_count`，即输出 CoT 前缀与 reference CoT 连续相同的字符数。
  - 结果：`text_prefix_match_count=29`，threshold `>=10`，PASS，AR output length `1181` chars。
- 如果 reviewer 要 “which benchmark scripts were used and paste corresponding results”，不要只回答 “vllm bench”。必须贴命令形态、server path、request payload、before/after 表、accuracy input/metric/result。
- 下次执行顺序：
  1. 先跑纯 graph online path，确认 `vllm serve` ready 和 smoke 请求通过。
  2. no-profiler benchmark 先给端到端数字。
  3. request-window profiler 只用于解释热点：`start_profile -> target request -> stop_profile`。
  4. trace 质量 gate 通过后再分析；文件小、进程少、缺 stack 时不能当正式 trace。
  5. PR body 只写可复现证据，不写远端私有路径、IP、临时失败和垃圾测试。
