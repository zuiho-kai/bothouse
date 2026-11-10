---
name: debug-basics-2
description: Remote Debug 基础策略（第 2/2 部分）：远端重建 venv / benchmark 先过 import gate、diffusion scheduler/grouping 的串行边界表述、远端 issue 复现优秀实践与快速证据模板
metadata:
  scope: 只收远端重建 venv 的 import gate 经验、diffusion 分组串行的表述规则和远端 issue 复现实践；默认执行顺序、脚本投递门禁和 SSH/tmux 陷阱归 debug-basics-1
---
# Remote Debug · 基础策略（第 2/2 部分）

## 现状

- 本页是源页 `debug-basics.md` 的后半部分（“远端重建 venv / benchmark 先过 import gate”到“远端 issue 复现优秀实践”）；前半部分在 [[debug-basics-1]]。

## 关键事实

- 源页：`knowledge/general/remote/guides/debug-basics.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, remote；created: 2026-07-10；updated: 2026-07-10；sources: 无

### 远端 issue 复现优秀实践

- 复现不是“命令跑过”，而是“打到同一路径并收集到同类证据”。本轮 #3743 里有几件事值得保留：

1. **先把 blocker 串行化**：`venv OK` → `vllm import OK` → `vllm-omni import OK` → `server /health OK` → `client request OK` → `server-side signature OK`。前一步不 OK，不碰后一步。
2. **用当前代码验证 issue 命令是否仍有效**：先看 `--help`、endpoint mapping、request schema。脚本版本变了时，明确记录差异，不用“差不多”的 benchmark summary 冒充复现。
3. **server/client 双日志配对**：client 记录每个请求的 status/latency/body length；server 用 grep 统计关键签名（如 `KV transfer OK`、`Pool exhausted`、`Timeout waiting for KV cache`）。最终结论只基于 server-side 签名。
4. **失败类型先分类**：低成功率可能来自 400/schema/chat-template，也可能来自 500/engine/KV timeout。先查 HTTP status 和 traceback，再决定是否继续压测。
5. **手写最小客户端补齐 benchmark 缺口**：当 benchmark CLI 不支持 issue 参数时，写最小 aiohttp/curl 客户端直接打目标 endpoint；请求字段显式列出，日志可复用。
6. **环境 caveat 写在结论里**：硬件、checkpoint、YAML、脚本版本、`max_inflight` 这类差异必须写出来。不能把 CUDA 上 Instruct 的结果包装成 Ascend 上 Distill 的严格复现。
7. **释放资源只杀自己的 PID**：记录 server/client pid；结束时只 kill 本次 venv / `repro*` 进程，不碰其他用户服务。释放后用 GPU memory 检查确认。

- 快速证据模板：

```bash
# client summary
tail -160 /tmp/repro_x_client.log

# server signature counts
grep -c 'KV transfer OK' /tmp/repro_x_server.log
grep -c 'Successfully received KV cache' /tmp/repro_x_server.log
grep -c 'Pool exhausted' /tmp/repro_x_server.log
grep -c 'Timeout waiting for KV cache' /tmp/repro_x_server.log
grep -c 'KV transfer FAILED' /tmp/repro_x_server.log

# config caveat
grep -n 'max_inflight\|memory_pool_size' vllm_omni/deploy/hunyuan_image3.yaml
```

## 决策与踩坑

### 远端重建 venv / benchmark 先过 import gate

- 2026-06-05 PR4041 DiT 复测踩坑：用户要求在 `<REMOTE_WORK_ROOT>` 删除旧 venv 并重装。
  - 第一次按旧记忆装 `vllm==0.21.0`，结果 `vllm-omni` import gate 失败，报 `vllm.model_executor.models.registry` symbol mismatch。
  - 修正后用 `vllm==0.22.0` 才能进入正式 benchmark。
- 经验：

1. **删 venv 前确认目标路径**：`readlink -f <REMOTE_WORK_ROOT>/.venv`，只删用户指定根下的 venv。
2. **新 venv/cache 都落宿主工作根**：`UV_CACHE_DIR`、`PIP_CACHE_DIR`、`XDG_CACHE_HOME`、`HF_HOME` 指向 `<REMOTE_WORK_ROOT>/...`，不要写 `/root/.cache`。
3. **benchmark 前必须 import gate**：
   ```bash
   python - <<'PY'
   import torch, vllm, vllm_omni, transformers, flashinfer
   print(torch.__version__, torch.cuda.is_available(), torch.cuda.device_count())
   print(vllm.__version__, transformers.__version__, flashinfer.__version__)
   print(vllm_omni.__file__)
   PY
   ```
4. **版本错配是 blocker，不是性能数据**：import/init smoke 失败时先修环境，不进入长跑。
5. **正式结果只看同口径 JSON**：init time、warmup、measured elapsed/throughput 分开；baseline 和 candidate 要同物理 GPU、同模型、同 quantization、同 prompt/steps。

### Diffusion scheduler/grouping 表述要说清串行边界

- 2026-06-08 讨论 HunyuanImage3 grouped DiT 时踩的表达坑：`scheduler tick` 里同时带出多个 request，不等于这些 request 一定在同一个 forward 里跑，更不等于并行跑。
  - pipeline 还会按 step/layout/shape 拆成 step groups；拆出的多个 group 是在同一 worker 内 **for-loop 串行执行多个 forward**，不是 CUDA stream 并行，也不是多模型副本并行。
- 回答 diffusion batching / performance 问题时必须显式区分：

1. **同一 scheduler tick**：scheduler output 可以包含多个 request。
2. **同一个 Hunyuan step group**：shape、CFG、layout 兼容后才会合成一次 DiT forward。
3. **多个 step group**：同一 tick 内按 group 顺序串行 forward，属于 micro-batch 串行。

- 例子：512x512 请求和 768x768 请求即使出现在同一 scheduler tick，也会因为 latent shape / `num_image_tokens` 不同被拆成两个 group，然后先后跑两个 forward。
  - 不要说成“一起跑”；正确说法是“同一轮调度，但 pipeline 内部分组后串行执行”。
  - 不同 later step 在 same shape / compatible layout 下可以进同一个 forward；first step 和 later step 会拆组。
