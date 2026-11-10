---
name: 2026-06-01-remote-validation-019
description: 2026-06-01 错题：HunyuanImage3 AR-only benchmark smoke 在 B4 L20X 空等 13 分钟，实为 serve 的 --disable-log-requests 被 argparse 拒绝而 health wait 没查 PID 与日志；含 CLI 参数先验证、watchdog 同查 health/PID/fatal 签名的硬规则与最小 watchdog 模板
metadata:
  scope: 只收 2026-06-01 远端 benchmark 启动无 fail-fast 这一起事故及其 watchdog 模板；同日 Full IT2I 的 unavailable 指标归 2026-06-01-remote-validation-020
---
# 2026-06-01 — 远端 benchmark 脚本没有 fail-fast，会把 argparse 失败空等成“模型慢”

## 关键事实

- 源页：`knowledge/repos/vllm-omni/remote/incidents/performance-validation/2026-06-01-remote-validation-019.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-06-01-remote-validation-019`
- 归属：`repos/vllm-omni/remote`
- 状态：已验证
- 搜索词：远端 benchmark 脚本没有 fail-fast，会把 argparse 失败空等成“模型慢”
- 影响范围：repos/vllm-omni/remote
- **症状**：HunyuanImage3 AR-only benchmark smoke 在 B4 L20X 上耗时超过 13 分钟没有结果。用户指出 L20X 140G 足够，问题不应是显存。复查远端后发现 GPU 全空，只有一个本次留下的 `bash /tmp/hy3_ar_smoke_openai.sh` 在空等；server 日志第一屏已经明确失败：

```text
main.py: error: unrecognized arguments: --disable-log-requests
```

- **根因**：
  1. 把 vLLM 习惯参数当成 vLLM-Omni 当前 CLI 参数，没有先用当前 worktree/venv 的 `serve --help` 验证。
  2. health wait 只轮询 `/health`，没有同时检查 server PID 是否退出，也没有 grep `error:` / `Traceback` / `unrecognized arguments`。
  3. 用户改口“去掉 DiT”后，没有先重定 benchmark 口径，仍带着 full `/v1/images/edits` 的惯性探索；AR-only 应走 chat completions streaming 或 offline AR engine。
  4. 之前看到 `Free memory 1.38GiB` 时错误归因到 140G 不够，真实原因是失败/中断后的 worker 残留。显存异常必须先查 compute apps/PID/PGID。
- **硬规则**：
  1. 远端 serving/benchmark 启动前必须验证每个非平凡 CLI 参数：

     ```bash
     $VENV/bin/python -m vllm_omni.entrypoints.cli.main serve --help | grep -E 'deploy-config|chat-template|chat-template-content-format|port'
     ```

  2. 服务启动 watchdog 必须同时检查 health、PID、fatal log signature。PID 已死或日志出现 `error:` / `Traceback` / `unrecognized arguments` 时立刻 tail log 失败，禁止继续 sleep。
  3. 单请求 smoke 通过前禁止跑 concurrency sweep；smoke 只能证明路径可用，不能出性能表。
  4. AR-only / DiT-only / full AR+DiT benchmark 必须先写口径矩阵；AR-only 不准用 `/v1/images/edits` 冒充目标路径。
  5. 清理只杀本次 `setsid` 进程组，清理后 `nvidia-smi` 验证显存回零；不能 kill 其他用户进程。
- **最小 watchdog 模板**：

```bash
setsid "$VENV/bin/python" -m vllm_omni.entrypoints.cli.main serve ... >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!
SERVER_PGID=$(ps -o pgid= -p "$SERVER_PID" | tr -d ' ')
START_TS=$(date +%s)

while true; do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    tail -160 "$SERVER_LOG" >&2
    exit 1
  fi
  if grep -E '(^|[^a-zA-Z])(error:|Traceback|unrecognized arguments|EngineDeadError)' "$SERVER_LOG" >/dev/null 2>&1; then
    tail -160 "$SERVER_LOG" >&2
    exit 1
  fi
  curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null && break
  [ "$(($(date +%s) - START_TS))" -gt 180 ] && { tail -160 "$SERVER_LOG" >&2; exit 1; }
  sleep 2
done
```
