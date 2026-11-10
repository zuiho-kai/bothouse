---
name: serving-failfast-cleanup
description: 远端 serving / benchmark 脚本必须 fail-fast：四个强制启动 gate、等待 health 时的 watchdog、只杀本次进程组的清理规则、pytest / accuracy cleanup 限定本轮归属，以及对应反例
metadata:
  scope: 只收远端 serving / benchmark / pytest 的启动 gate、health watchdog 和按 PGID / cwd 限定归属的清理规则及其反例；Bash 脚本投递门禁本体归 debug-basics-1，Slurm 资源边界归 srun-lifecycle
---
# Remote Debug · Serving / Benchmark fail-fast 与清理

## 关键事实

- 源页：`knowledge/general/remote/guides/serving-failfast-cleanup.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, remote；created: 2026-07-10；updated: 2026-07-10；sources: 无

### 远端 serving / benchmark 脚本必须 fail-fast

#### 强制启动 gate

- 远端启动任何 serving / benchmark 前，先跑下面四个 gate；任一失败，禁止进入长跑。
- 第 2 项的唯一标准是远端 Bash 脚本投递门禁（[[debug-basics-1]] 的“远端 Bash 脚本投递必须失败关闭”一节），本页不再维护弱化副本。

```bash
# 1. 参数来自当前 worktree + 当前 venv，不凭记忆
$VENV/bin/python -m vllm_omni.entrypoints.cli.main serve --help | grep -E 'deploy-config|chat-template|chat-template-content-format|port'

# 2. 脚本投递有效
# 先执行 debug-basics 的 canonical fail-closed gate，全部通过才继续。

# 3. 资源真空闲，不靠 free-memory 猜
nvidia-smi --query-compute-apps=gpu_uuid,pid,process_name,used_memory --format=csv,noheader,nounits || true
nvidia-smi --query-gpu=index,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits

# 4. endpoint/口径已分清
# AR-only: /v1/chat/completions streaming
# Full AR+DiT image edit: /v1/images/edits
# DiT-only: image generation/edit diffusion endpoint or offline diffusion path
```

#### 强制 watchdog

- 服务启动后等待 health 时，必须同时检查三件事：

```bash
while true; do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "server exited before health" >&2
    tail -160 "$SERVER_LOG" >&2
    exit 1
  fi
  if grep -E '(^|[^a-zA-Z])(error:|Traceback|unrecognized arguments|EngineDeadError)' "$SERVER_LOG" >/tmp/server_error_hit 2>/dev/null; then
    echo "server log has fatal signature" >&2
    tail -160 "$SERVER_LOG" >&2
    exit 1
  fi
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null; then
    break
  fi
  if [ "$(($(date +%s) - START_TS))" -gt 180 ]; then
    echo "health timeout" >&2
    tail -160 "$SERVER_LOG" >&2
    exit 1
  fi
  sleep 2
done
```

#### 清理规则

- 服务必须用独立进程组启动，只杀本次进程组：

```bash
setsid "$VENV/bin/python" -m vllm_omni.entrypoints.cli.main serve ... >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!
SERVER_PGID=$(ps -o pgid= -p "$SERVER_PID" | tr -d ' ')

cleanup() {
  set +e
  if [ -n "${SERVER_PGID:-}" ]; then
    kill -TERM -"$SERVER_PGID" 2>/dev/null || true
    sleep 5
    kill -KILL -"$SERVER_PGID" 2>/dev/null || true
  fi
  nvidia-smi --query-gpu=index,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits
}
trap cleanup EXIT
```

- 不要按进程名全局终止服务，也不要处理其他用户进程。清理后资源仍未释放时，只检查本次记录的 PGID/child PID；无法证明归属就停下报告。

#### pytest / accuracy cleanup 也必须限定本轮归属

- 远端 pytest、accuracy test、profiling wrapper 不一定是 long-running server，但 cleanup 规则一样严格。
- 凡是测试 helper 按进程名扫描整个节点，共享节点开跑前必须先改成下列任一限定：

```bash
# 优先：只杀本次 runner 的进程组
kill -TERM -"$RUNNER_PGID"

# 兜底：只杀 cwd 属于本次 worktree / out_dir 的进程
for pid in $(pgrep -f 'vllm|vllm_omni|StageEngineCoreProc' || true); do
  cwd=$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)
  case "$cwd" in
    "$WORKTREE"/*|"$OUT_DIR"/*) kill "$pid" ;;
  esac
done
```

## 决策与踩坑

### 远端 serving / benchmark 脚本必须 fail-fast：2026-06-01 反例

- **2026-06-01 HunyuanImage3 AR benchmark 反例**：为了比较 `origin/main` 与 PR #3938 的 AR 性能，我把 PR #3767 的 streaming metrics overlay 叠到两个 worktree 后，切到 B4 远端跑 AR-only smoke。
  - 用户已经指出“去掉 DiT”，但我仍把 endpoint 探索、chat-template smoke、正式 benchmark sweep 混在一起推进，最后写了一个只轮询 `/health` 的长脚本。
- 真实失败信号其实在服务日志第一屏：

```text
main.py: error: unrecognized arguments: --disable-log-requests
```

- 服务进程已经退出，但脚本没有检查 server PID，也没有 grep `error:` / `Traceback` / `unrecognized arguments`。结果就是脚本继续空等健康检查十几分钟。
- 这个耗时不是模型慢、不是 L20X 140G 不够、也不是 AR TP2 资源不足，而是远端脚本没有 fail-fast。
- 同一轮还暴露两个连锁问题：

1. `/v1/images/edits` 在 AR-only deploy 下硬依赖 diffusion stage，会返回 `No diffusion stage found in multi-stage pipeline`。用户要求去掉 DiT 后，必须切 `/v1/chat/completions` 或 offline AR engine，不能沿用 full pipeline endpoint。
2. `Free memory 1.38GiB` 不是 140G 不够，而是之前失败/中断后的 worker 残留。资源判断必须先看 compute apps / PID / PGID，不能把残留显存解释成模型配置不可能启动。

### 强制 watchdog：禁止模式

- 只轮询 `/health`，不检查 PID。
- server log 已经有 argparse / traceback 还继续 sleep。
- smoke 没过就跑 concurrency sweep。
- 把残留 worker 造成的显存占用解释成“这套配置启动不了”。
- 用 vLLM 习惯参数跑 vLLM-Omni CLI，却没先 `--help` 验证。

### pytest / accuracy cleanup：禁止模式

- 按服务或进程名称全局终止。
- 先跑完整测试，等 cleanup 误杀后再解释。
- 只看 GPU UUID / 显存，不查 `/proc/<pid>/cwd` 或 PGID 就 kill。
- 2026-06-04 HunyuanImage3 accuracy 复跑里，现有 pytest cleanup 实际扫到并终止了旧 `vllm` PID。以后同类 accuracy 长测必须先过 cleanup gate，和配置生效 gate、GPU gate 同级。
