---
name: 2026-06-08-remote-validation-003
description: 2026-06-08 错题：用户已指定 online /start_profile 到 /stop_profile 的正式 trace，却连跑三轮 profiler 变体并把 max_iterations=20 加 64 output 的 bounded smoke（约 140MB/rank）当成果，而正常 trace 应为 900MB-1GB；含正确做法与重启前三问
metadata:
  scope: 只收 2026-06-08 用 bounded smoke 替代用户指定 online 正式 trace 这一起事故；无界采样杀 worker 归 2026-06-08-remote-validation-004，重跑新建 cache root 的 10 分钟 cold compile 归 2026-06-08-remote-validation-027
---
# 2026-06-08 — 用户已指定 online start/stop，我却用 bounded smoke 替代正式 trace

## 关键事实

- 源页：`knowledge/repos/vllm-omni/remote/incidents/performance-validation/2026-06-08-remote-validation-003.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-06-08-remote-validation-003`
- 归属：`repos/vllm-omni/remote`
- 状态：已验证
- 搜索词：用户已指定 online start/stop，我却用 bounded smoke 替代正式 trace
- 影响范围：repos/vllm-omni/remote
- **症状**：用户一开始已经说明“正常开图模式，然后 online 模式发 profiling 请求”，也就是服务 READY 后在目标请求前 `/start_profile`，请求完成后 `/stop_profile`。我却连续跑了三轮 profiler 变体：先漏 `profiler: torch`，再无界 512 output 导致 worker 死亡，最后改成 `max_iterations=20` + `64 output` 的 bounded smoke，得到 140MB/rank trace 后误当成果。
  - 用户指出正常 trace 应该是 900MB-1GB，并再次强调“请求进去之前开采集，请求完成结束采集，例如 t2i 用例的请求”。
- **根因**：
  - 没有把用户的 online start/stop 语义当硬约束，擅自把问题改写成“调 profiler 采样参数直到文件变大”。
  - 把 profiler plumbing smoke 当正式 trace。`max_iterations`、短 output、random-mm smoke 只能证明 endpoint 和 rank trace 可用，不能替代目标 workload。
  - 看到 trace 小，没有先反查采集窗口是否错了，而是继续重启服务追 1GB 文件大小，浪费十几分钟 graph startup 机时。
  - 重启前没有做必要性 gate：已有服务/已有结论是否足够？这次重启是否改变正式请求窗口？答案是否，但我仍然跑了。
- **正确做法**：
  1. 正常 graph serve 拉起到 `/health=200`，确认 profiler endpoints enabled。
  2. 不用 `max_iterations` 限制正式 trace，除非用户明确接受“只采前 N step”。
  3. 在目标请求前调用：

     ```bash
     curl -X POST /start_profile -d '{"stages":[0]}'
     ```

  4. 发用户要分析的真实请求，例如 t2i/it2i 用例或指定 AR chat workload；不要用 random-mm short smoke 代替。
  5. 目标请求完成后立刻：

     ```bash
     curl -X POST /stop_profile -d '{"stages":[0]}'
     ```

  6. 交付前校验 rank、文件大小、event count、`python_function`、`aten::`、CUDA kernel/NCCL；trace 小于预期时先检查采集窗口，不先重启。
- **怎么避免**：
  - 用户明确说“online / 请求前开 / 请求后关”时，把这句话写进 `$OUT/scope.txt`，并在每轮命令前核对。
  - bounded profiler 只能标注为 `plumbing_smoke`，最终回答不得叫“正式 trace”。
  - 任何 graph profiling 重启前必须回答三问：目标请求是否已定义？是否必须重启才能改变条件？这轮是否会完整 start->request->stop？任一否，禁止长启动。
  - 用户指出“这不是我要的”后，先释放资源和复盘，不继续跑新变体。
