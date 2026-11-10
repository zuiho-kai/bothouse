---
name: ar-graph-profiling-2
description: AR graph serve / profiling 状态机第 2 部分：trace quality gate（gzip trace 事件检查脚本、按目标分级的合格 trace 表、2026-06-05 废 trace 的边界）、profiling 七状态汇报表（service ready 到 resources released）与查状态命令模板、artifact 打 tar / 下载 / 释放资源的顺序和最终汇报字段
metadata:
  scope: 只收 trace 质量验收、进度状态机和 artifact / resource 顺序；开跑前的 gate 归 ar-graph-profiling-1，graph mode 的 provenance gate 与 start/stop_profile 采集窗口归 ar-graph-profiling-3
---
# Remote Debug · AR graph serve / profiling 状态机（2/3）

## 关键事实

- 拆分说明：本页是源页 `ar-graph-profiling.md` 的第 2/3 部分；第 1 部分 [[ar-graph-profiling-1]]；第 3 部分 [[ar-graph-profiling-3]]
- 源页：`knowledge/repos/vllm-omni/benchmark/guides/ar-graph-profiling.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, benchmark；created: 2026-07-10；updated: 2026-07-10

### AR graph serve / profiling 必须按状态机推进

#### trace quality gate

- 交付 profiling 文件前，先确认 trace 质量，不要只看文件存在：

```bash
python - <<'PY'
import gzip, json, sys
for path in sys.argv[1:]:
    with gzip.open(path, "rt", encoding="utf-8") as f:
        data = json.load(f)
    events = data.get("traceEvents", [])
    pids = {e.get("pid") for e in events if e.get("pid") is not None}
    names = [e.get("name", "") for e in events]
    print(path)
    print("events", len(events), "pids", len(pids))
    print("has_python_stack", any(".py(" in n or ".py:" in n for n in names))
    print("has_aten", any("aten::" in n for n in names))
    print("has_cuda", any("cuda" in n.lower() or "kernel" in n.lower() for n in names))
PY "$OUT"/torch_profiler/*/trace_rank*.json.gz
```

- 验收标准按目标分级：

| 目标 | 合格 trace 应看到 |
| --- | --- |
| worker torch op 分析 | rank0/rank1 trace、`aten::` / CUDA kernel、shape/stack args、`profiler_out_0/1.txt` |
| 截图级 Python flame timeline | Python 函数调用栈、线程/进程长条、scheduler / multiprocessing / queue wait 等 CPU timeline |
| 全进程 serving 分析 | API server、orchestrator、StageEngineCoreProc、Worker_TP0/1、bench client 或 driver 进程都能区分 |
| graph/kernel 分析 | CUDA graph replay / kernel / NCCL / memcpy / stream timeline，而不是只有 Python wait |

- 本轮 2026-06-05 的废 trace 只满足“worker torch profiler plumbing 通了”：它有 rank0/rank1 worker trace，但没有完整 API server / orchestrator / bench client 多进程视图；轻量配置还关闭了 stack/shape。以后这种不能交付给用户当“分析级 trace”。
- 如果用户给的目标图像是 Python flame timeline（如 `threading.py::_bootstrap`、`multiprocessing`、`queue.get`、`vllm/engine/...` 长条），不要承诺 torch worker profiler 能复现。应改用全进程 Python tracer（例如 VizTracer/py-spy 类工具，按远端可用性选择）包住 server/worker，或用 Nsight Systems 做 CUDA/NVTX 多进程 trace；
  - 必要时同时保留 worker torch profiler 作为 CUDA/aten 辅助视图。

#### profiling 状态机

- 以后 profiling 进度只按下面状态汇报，不准混用“跑完”：

| 状态 | 证据 | 可以怎么说 |
| --- | --- | --- |
| service ready | `/health` 200；profiler run 还要有 `/start_profile` `/stop_profile` routes | 服务已 ready |
| request done | bench progress 100% 或 server 有 `POST /v1/chat/completions ... 200 OK` | AR 请求已完成 |
| trace exported | rank0/rank1 `trace_rank*.json(.gz)` 存在且大小稳定 | trace 已落盘 |
| profiler stopped | server log 有 `Profiler stopped` 且 `/stop_profile ... 200 OK` | profiler 已完整停止 |
| bench done | 无 `vllm bench serve` / bench wrapper 进程，且 bench JSON 存在 | bench 已完整退出 |
| local artifact saved | 本地 tar 和解包目录存在，列出 trace/profiler_out/bench json | 本地已保存 |
| resources released | 本轮 PGID 无进程，`nvidia-smi` 显存归零/系统占用 | 资源已释放 |

- 查状态模板：

```bash
OUT=/tmp/<run_dir>
date
curl -fsS -m 3 http://127.0.0.1:8091/health && echo HEALTH_OK || echo HEALTH_NOT_READY
ps -eo pid,ppid,pgid,stat,etime,cmd | grep -F "vllm bench serve" | grep -v grep || true
find "$OUT/torch_profiler" -maxdepth 3 -type f -ls 2>/dev/null | sort -k11
ls -lh "$OUT"/ar_profile_request_*/bench_ar_profile_1.json 2>/dev/null || true
grep -n -F "POST /stop_profile" "$OUT/serve.log" | tail -5
grep -n -F "Profiler stopped" "$OUT/serve.log" | tail -5
```

- 沟通规则：用户问“跑完没有”时，必须用上表回答，不要只说 trace 有了；如果 bench 还在等 `/stop_profile`，明确说“AR 请求已完成，但 bench 未完整退出”。

#### artifact / resource 顺序

- profile 文件一旦在远端完整，先打单个 tar 包并列内容；不要 `scp -r` 整目录黑盒拷贝。

```bash
OUT=/tmp/<run_dir>
tar -C /tmp -czf "$OUT.tar.gz" "$(basename "$OUT")"
ls -lh "$OUT.tar.gz"
tar -tzf "$OUT.tar.gz" | tail -40
```

- 推荐顺序：
  1. 远端确认 `trace_rank0/1`、`profiler_out_0/1`、bench JSON 都存在。
  2. 远端打 tar 并 `tar -tzf` 列内容。
  3. 如果 GPU 资源紧张，tar 验证后可以先释放本轮 serve PGID，再下载 tar。
  4. 本地下载 tar，解包，列文件和大小。
  5. 最终用本轮 PGID 清理服务并查 `nvidia-smi`；如果第 3 步已释放，这一步只做复查。
- 本地保存后最终汇报必须包含：

```text
local tar: <path>
local extracted dir: <path>
trace_rank0: <path>
trace_rank1: <path>
profiler_out_0/1: <path>
bench json/log: <path>
remote GPU: <nvidia-smi summary>
```

- 不要在用户要求“释放资源”时只说文件路径；必须实际查 GPU 和 VLLM 相关进程。
