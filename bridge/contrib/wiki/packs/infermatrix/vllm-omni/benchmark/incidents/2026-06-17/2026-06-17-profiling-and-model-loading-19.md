---
name: 2026-06-17-profiling-and-model-loading-19
description: 2026-06-17 错题：LTX2.3 T2V 开图 profiling 用带 --enforce-eager 的 eager trace 配 graph e2e benchmark 下结论，及 profiling artifact gate、最小增量加 profiler、按 PID/PGID 清理的做法
metadata:
  scope: 只收 2026-06-17 LTX2.3 开图气泡分析混用 eager trace 与 graph benchmark 这一起事故的症状、根因、解法和提醒；同日 mask-sync 精度事故归 2026-06-17-profiling-and-model-loading-20，证据分层口径归 ar-graph-online-2026-06-12-evidence
---
# 2026-06-17 — LTX2.3 开图 profiling 把 eager trace 和 graph benchmark 混成一个结论

## 关键事实

- 源页：`knowledge/repos/vllm-omni/benchmark/incidents/2026-06-17-profiling-and-model-loading-19.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-06-17-profiling-and-model-loading-19`
- 归属：`repos/vllm-omni/benchmark`
- 状态：已验证
- 搜索词：LTX2.3 开图 profiling 把 eager trace 和 graph benchmark 混成一个结论
- 影响范围：repos/vllm-omni/benchmark
- **症状**：用户要求看 LTX2.3 T2V 开图后的气泡和算子耗时。我先用已有 eager torch trace 分析了“气泡很多”，同时引用了开图 e2e benchmark 结果，导致表达上像是在分析开图 trace。用户追问后才确认本地和远端当时都没有可用的开图 `trace_rank*.json(.gz)`；已有完整 trace 来自 `<REMOTE_WORK_ROOT>/ltx23_t2v_offline_trace_20260616_142741`，脚本明确带 `--enforce-eager`。
- **根因**：
  - 没有先做 profiling artifact gate：没有逐项确认 trace 文件、run script、server log、`--enforce-eager` / `transformer compiled with torch.compile` 属于同一轮。
  - 把两个证据层混用：无 profiler steady benchmark 只能证明 e2e / qps，torch trace 才能证明算子和气泡。
  - 补跑时一开始没有复用已成功的 serving `/v1/videos/sync` benchmark 路径，而是写了 direct `Omni(...)` runner，worker 初始化 EOF，扩大了变量面。
  - 远端脚本 cleanup 只杀外层 PGID，没有复查实际 server PGID，导致 profiler server 进程残留，需要按本轮 PID/PGID 精确清理。
- **解法**：
  1. 先枚举远端所有 `trace_rank*.json(.gz)`，再读对应 `run*.sh` / `server.log`，确认没有现成开图 trace。
  2. 复用已经跑通的 serving benchmark 路径，只加 `--profiler-config` 和 online `/start_profile -> /v1/videos/sync -> /stop_profile`。
  3. 用 full-shape warmup 丢弃 cold compile/capture，再 profile 真实 512x384、25 frames、20 steps 请求。
  4. 交付前确认三类证据同轮一致：`transformer compiled with torch.compile`、`profiled_request.json` 成功、`trace_rank0.json.gz` 落盘并下载/解压。
  5. 清理时按实际 server PID/PGID 精确 kill，并复查 `nvidia-smi`，不能只依赖外层 shell PGID。
- **对未来的提醒**：
  - 用户说“开图后的气泡 / 算子耗时”时，必须先证明 trace 是 graph mode：无 `--enforce-eager`，日志有 `Model runner: transformer compiled with torch.compile`，trace 文件属于同一 run。
  - e2e/qps 和 profiler trace 必须分开汇报：e2e 用无 profiler steady benchmark；气泡/算子用 profiler 单请求 trace，并注明 profiler overhead。
  - 已有成功 benchmark 路径时，只做最小增量加 profiler，不换 runner、不重写入口。
  - 如果只有 benchmark stats 没有 trace，要直接说“当前没有 trace profiling artifact”，不能拿 benchmark 或其他模式 trace 补位。
