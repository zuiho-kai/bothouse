---
name: 2026-06-12-remote-validation-028
description: "2026-06-12 错题：HunyuanImage3 AR graph 性能优化与 profiling 返工复盘，无效 trace、采集窗口不对、启动耗时未分层、PR 描述缺证据，最终收敛到 PR #4363 去掉 embed_input_ids() 的 timestep_mask.sum().item()；含 Scope Lock、有效证据标准与 Tensor.item 50.25s 到 0.36s 的证据模板"
metadata:
  scope: 只收 2026-06-12 AR graph perf/profiling 返工的口径、证据标准与 PR 证据模板；10 小时 d-step 分析失控的过程归 2026-06-12-remote-validation-029
---
# 2026-06-12 — AR graph perf/profiling 返工复盘：先锁口径，再烧 GPU

## 关键事实

- 源页：`knowledge/repos/vllm-omni/remote/incidents/performance-validation/2026-06-12-remote-validation-028.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-06-12-remote-validation-028`
- 归属：`repos/vllm-omni/remote`
- 状态：已验证
- 搜索词：AR graph perf/profiling 返工复盘：先锁口径，再烧 GPU
- 影响范围：repos/vllm-omni/remote
- **症状**：HunyuanImage3 AR graph 性能优化和 profiling 连续返工。用户一开始已经明确“在线模式，通过请求开关 profiling”，但执行中先后出现了无效 trace、采集窗口不对、启动耗时异常、PR 描述缺 benchmark script/result、accuracy 只一句话带过等问题。最后才收敛到 PR #4363：去掉 `embed_input_ids()` 里的 `timestep_mask.sum().item()`，并用 online graph benchmark + AR-only prefix accuracy 证明。
- **根因**：
  1. **口径没有先锁死**：把“图模式 AR server 是否能启动”、“profiler 是否能采到有效请求窗口”、“PR 需要什么 reviewer 证据”混在一起推进。结果每次跑完都只能回答一部分问题。
  2. **采集窗口错误**：正式 profiling 应该是 `service ready -> warmup outside profiler -> start_profile -> target request/bench -> stop_profile`。之前有的 trace 采到启动、等待、短 smoke 或 worker iteration 截断，不足以解释用户关心的 decode step。
  3. **trace 质量 gate 缺失**：只看 trace 文件存在或大小，不先验收 event_count、pid/tid、python stack、aten、CUDA runtime/kernel、rank0/rank1 是否完整，导致废 trace 被当成进展。
  4. **启动成本没有分层归因**：graph 启动慢可能来自权重加载、torch.compile cache miss、CUDA graph capture、FlashInfer/TRTLLM JIT、PATH 里没有 `ninja`、新建 `VLLM_CACHE_ROOT` 触发 cold compile。没有拆分就会把环境问题说成模型或图模式本身慢。
  5. **性能结论没有分层**：profiler run 可以定位同步点，但不能替代 no-profiler benchmark。必须分开写“热点证据”和“端到端收益”。
  6. **accuracy 说明太弱**：只写 `PASS` 不够。Reviewer 需要知道用什么 prompt/images、什么 metric、为什么这个 metric 覆盖该改动、结果是多少。
- **有效证据标准**：

```text
Scope Lock
- mode: HunyuanImage3 AR-only graph
- server: vllm serve + hunyuan_image3_ar + enforce_eager=false
- endpoint: /v1/chat/completions
- backend: openai-chat-omni
- bench: vllm bench serve
- request body: {"modalities":["text"],"bot_task":"think"}
- profiler window: start_profile before target request, stop_profile immediately after target request
- accuracy: AR-only prefix metric from tests/e2e/accuracy/test_hunyuan_image3.py
```

- **正式性能结论必须同时具备**：
  1. no-profiler benchmark before/after：duration、output tok/s、TTFT、TPOT、ITL，并给百分比。
  2. profiler trace before/after：目标同步点的 count / total / max / slow-count 变化。
  3. trace 质量摘要：rank0/rank1 trace、event_count、pid/tid、python stack、aten、CUDA runtime/kernel、NCCL 是否存在。
  4. accuracy：同 prompt/images、同 metric、threshold 和结果。
- **这次最终可写入 PR 的证据模板**：

```text
Benchmark:
- vllm serve on HunyuanImage3 AR graph deploy, enforce_eager=false.
- vllm bench serve against /v1/chat/completions, backend=openai-chat-omni.
- random-mm, 10 prompts, concurrency 1, 1x1024x1024 image/request, input 256, output 512.

Perf result:
- Tensor.item total: 50.25s -> 0.36s (-99.3%).
- Slow Tensor.item >50ms: 18 -> 0 (-100%).
- Benchmark duration: 41.83s -> 40.20s (-3.9%).
- Output tok/s: 72.54 -> 75.47 (+4.0%).

Accuracy:
- AR-only prefix accuracy using the same PROMPT and TEST_IMAGE_URLS as tests/e2e/accuracy/test_hunyuan_image3.py.
- text_prefix_match_count=29, threshold >=10, PASS.
```

- **硬规则**：
  1. 用户说“在线模式发 profiling 请求”时，不要改成 offline profiler、短 smoke profiler、max-iteration trace 或启动期 trace。
  2. 用户问“跑完没有”时，按状态机回答：service ready、request done、trace exported、profiler stopped、bench done、local saved、resources released。不能用一个“跑完了”盖过去。
  3. 10 分钟无目标阶段进展必须停损汇报。目标阶段包括：health ready、smoke 200、start_profile 200、target request 200、stop_profile 200、trace rank0/rank1 落盘。只看到 GPU 占用或日志滚动不算进展。
  4. 启动耗时必须拆开：weight loading、torch.compile、graph capture、engine init、API startup、request warmup/JIT。不要只报总耗时。
  5. `VLLM_CACHE_ROOT` 是实验变量。复用已知 cache 还是 cold cache 必须写进 scope；正式 perf 对照默认复用 cache，除非目标就是测冷启动。
  6. 共享机器上只杀本轮 PGID/PID。释放资源后必须查 `nvidia-smi --query-compute-apps`，确认本轮 GPU 归还。
  7. PR body 不写私有 IP、远端用户名、临时失败、被阻塞的垃圾测试。只写 reviewer 可复现的命令口径、结果表和必要 caveat。
