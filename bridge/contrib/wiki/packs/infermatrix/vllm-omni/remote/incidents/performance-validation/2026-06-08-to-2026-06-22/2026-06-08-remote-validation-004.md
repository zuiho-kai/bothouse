---
name: 2026-06-08-remote-validation-004
description: "2026-06-08 错题：HunyuanImage3 AR 图模式 profiler 漏 profiler: torch 导致 VllmConfig 校验失败，补上后无界采 512 output tokens 使 VllmWorker-0 死亡、torch_profile 只剩空目录；bounded 结果仅证明 plumbing，不是 900MB-1GB 正式 trace"
metadata:
  scope: 只收 2026-06-08 AR graph profiler 无界采样杀 worker 与空 trace 目录不算成功这一起事故；用户已指定 online 窗口仍用 bounded smoke 的偏航归 2026-06-08-remote-validation-003
---
# 2026-06-08 — AR graph profiler 无界采样会杀 worker，空 trace 目录不能算成功

## 关键事实

- 源页：`knowledge/repos/vllm-omni/remote/incidents/performance-validation/2026-06-08-remote-validation-004.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-06-08-remote-validation-004`
- 归属：`repos/vllm-omni/remote`
- 状态：已验证
- 搜索词：AR graph profiler 无界采样会杀 worker，空 trace 目录不能算成功
- 影响范围：repos/vllm-omni/remote
- **症状**：用户要求在 HunyuanImage3 AR 图模式下跑 profiling。第一次把 `profiler_config` 写进 deploy 但漏了 `profiler: torch`，`VllmConfig` 直接校验失败。补上后无界采 `512` output tokens，bench 客户端显示 `1/1` 成功，但服务端 `VllmWorker-0 died unexpectedly`，`/stop_profile` 连接失败，`torch_profile` 只有空 session 目录。
  - 再把 `record_shapes=false` 但仍无边界启动，worker 甚至在 READY 前后死亡。
- **根因**：
  - 把“profiler endpoint 可用”误当成“trace 一定可导出”；实际 trace 只有 `stop()` 跑完后才落盘。
  - 对 80B AR graph 请求做无界 torch profiler，事件积累太重；一旦 worker 在 stop 前死掉，bench stats 可能仍写出来，但 trace 是废品。
  - 后续用 `max_iterations` / 短 output 做 profiler smoke 虽然证明 plumbing，但不等于正式请求窗口 trace。
- **解法**：正式 graph profiler 仍然必须按 online 窗口采集：服务 READY 后 `/start_profile`，发用户指定真实请求，请求完成后 `/stop_profile`。如果完整请求窗口让 worker 死亡，先报告失败和 root cause，再征求是否降级为 bounded sample。bounded 配置（如 `max_iterations=20`、`--random-output-len 64`）只能叫 smoke；
  - 本轮 bounded 结果生成 `trace_rank0.json` / `trace_rank1.json`，各约 140MB、约 51 万 events，只能证明 `python_function`、`aten::`、CUDA kernel、NCCL 都能被采到，不能作为用户预期的 900MB-1GB 正式 trace。
- **怎么避免**：
  1. profiler artifact gate 必须看文件和内容：trace 文件非空、event count、rank 覆盖、`aten::`、kernel、Python function；空 session 目录不是成功。
  2. 图模式性能结论仍用无 profiler 10-run；profiler run 只解释热点，必须报告 overhead、目标 workload、采集窗口、是否 bounded。
  3. 资源释放不能只杀 APIServer PGID 后就结束；杀完再查 `nvidia-smi --query-gpu`，确认目标 GPU 回到 0MiB。
