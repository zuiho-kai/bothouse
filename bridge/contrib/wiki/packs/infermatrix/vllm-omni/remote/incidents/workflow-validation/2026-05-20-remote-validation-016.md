---
name: 2026-05-20-remote-validation-016
description: "2026-05-20 错题：复现 issue #3743 时 --bot-task 已不被 diffusion_benchmark_serving.py 支持，ti2i 改走 /v1/chat/completions 得 0/128，真实错误 ChatTemplateResolutionError 未打到 KV transfer / Mooncake 路径"
metadata:
  scope: 只收 2026-05-20 Issue 复现不能把脚本跑完当成打到同一路径这一起事故、CLI/schema 对齐与错误签名核对解法及硬规则；GitHub 评论权限归 2026-05-20-remote-validation-018
---
# 2026-05-20 — Issue 复现不能把“脚本跑完”当成“打到同一路径”

## 关键事实

- 源页：`knowledge/repos/vllm-omni/remote/incidents/workflow-validation/2026-05-20-remote-validation-016.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-05-20-remote-validation-016`
- 归属：`repos/vllm-omni/remote`
- 状态：已验证
- 搜索词：Issue 复现不能把“脚本跑完”当成“打到同一路径”
- 影响范围：repos/vllm-omni/remote
- **症状**：复现 vLLM-Omni issue #3743 时，issue 里的命令包含 `--bot-task think` 并声明会走 `/v1/images/edits`。当前 main 的 `benchmarks/diffusion/diffusion_benchmark_serving.py` 不再支持 `--bot-task`；去掉该参数后，`--backend vllm-omni` 对 `ti2i` 实际映射到 `/v1/chat/completions`，很快得到 `0/128`。
  - 如果只看 benchmark summary，会误以为“低成功率复现了”，但 server log 里真实错误是 `ChatTemplateResolutionError`，没有打到 KV transfer / Mooncake 路径。
- **根因**：
  - 没有先核对 issue 命令和当前脚本 CLI/schema 是否一致。
  - 把“同名 benchmark 脚本”误当成“同一请求路径”；实际上 endpoint mapping 已经变化。
  - 第一轮 `0/128` 没有立即定位失败类型，险些把 400 bad request 当成 issue 里的 KV timeout 类失败。
- **解法**：
  1. 复现 issue 前先做 CLI/schema 对齐：

     ```bash
     python benchmarks/diffusion/diffusion_benchmark_serving.py --help | grep -E "bot-task|endpoint|backend"
     grep -n "backends_function_mapping\|LEGACY_BACKEND_ENDPOINT_ALIASES" benchmarks/diffusion/backends.py
     ```

  2. Benchmark summary 不是根因证据。任何 `0/N` 或低成功率，必须立刻看 server status/error：

     ```bash
     tail -300 /tmp/server.log | grep -E "ERROR|Traceback|400|422|500|Timeout|Pool exhausted|KV transfer"
     ```

  3. 只有错误签名匹配 issue（例如 `Pool exhausted` / `Timeout waiting for KV cache` / `KV transfer FAILED`）才算复现；HTTP 400、schema error、chat template error 都是前置请求错误。
  4. 当前脚本不支持 issue 参数时，不要硬跑“差不多”的命令；应写最小客户端直接请求 issue 声明的 endpoint，并显式列出字段（这里是 `/v1/images/edits` multipart + `bot_task=think` + `num_inference_steps=8` + `size=1024x1024`）。
- **硬规则**：
  - Issue 复现结论必须包含三件证据：实际 endpoint、server-side 错误签名、关键配置差异。
  - `Successful requests: X/Y` 只能作为现象摘要，不能单独作为复现依据。
  - 如果本地/远端环境和 issue 不一致（硬件、checkpoint、YAML、脚本版本），评论必须明确写 caveat，不能写成严格复现。
