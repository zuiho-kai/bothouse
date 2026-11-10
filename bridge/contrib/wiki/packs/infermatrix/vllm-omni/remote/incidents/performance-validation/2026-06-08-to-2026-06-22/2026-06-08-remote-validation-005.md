---
name: 2026-06-08-remote-validation-005
description: "2026-06-08 错题：HunyuanImage3 AR 图模式只需 enforce_eager: false 加 vllm serve / bench serve，却被 profiler、torch compile cache、相对 chat template 路径与 serve PATH 缺 ninja 的 FlashInfer JIT 失败混排；最终 10 请求 10.19 tok/s，torch.compile 从 660.79s 降到 38.69s"
metadata:
  scope: 只收 2026-06-08 AR graph 性能运行被复杂化、单变量没守住及 ninja PATH 根因这一起事故；profiling 窗口偏航归 2026-06-08-remote-validation-003 与 2026-06-08-remote-validation-004，新建 cache root 归 2026-06-08-remote-validation-027
---
# 2026-06-08 — HunyuanImage3 AR graph 被复杂化：profiler/cache/PATH 混排导致耗时过长

## 关键事实

- 源页：`knowledge/repos/vllm-omni/remote/incidents/performance-validation/2026-06-08-remote-validation-005.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-06-08-remote-validation-005`
- 归属：`repos/vllm-omni/remote`
- 状态：已验证
- 搜索词：HunyuanImage3 AR graph 被复杂化：profiler/cache/PATH 混排导致耗时过长
- 影响范围：repos/vllm-omni/remote
- **症状**：用户要求跑 HunyuanImage3 AR 图模式性能，本质只需要 `hunyuan_image3_ar` deploy 里 `enforce_eager: false`，再用 `vllm serve` + `vllm bench serve` 打 `/v1/chat/completions`。实际过程先被相对 chat template 路径挡住，又把 profiler、torch compile cache、timeout、graph startup 混在一起排，最后多轮长启动才收敛。
  - 最终跑通的 10 请求 graph 结果是 `10/10` 成功，`duration=236.21s`，`output_throughput=10.19 tok/s`，`mean_TTFT=2980.83ms`，`mean_TPOT=96.57ms`。
- **根因**：
  - 没有坚持用户给出的单变量：图模式开关就是 `enforce_eager: false`。我先引入 profiler/trace 方案，扩大了变量面。
  - `--chat-template hunyuan_image3_i2t.jinja` 使用相对路径，vLLM 校验 path-like 字符串时找不到文件。正确路径是 `<REMOTE_WORK_ROOT>/vllm-omni/hunyuan_image3_i2t.jinja`。
  - 旧全局 torch compile cache 触发过 `torch._dynamo` `IndexError`，污染了对 graph 配置的判断。隔离 cache 后该错误没再复现。
  - timeout 放宽后才暴露真实 worker 错误，但一开始把 READY 前失败过度归因到 timeout。
  - 真正的最终 blocker 是 FlashInfer sampling JIT 找不到 `ninja` 可执行文件：`ninja` 包在 `<REMOTE_WORK_ROOT>/.venv` 里已安装，但 serve 进程 PATH 没有 `<REMOTE_WORK_ROOT>/.venv/bin`，导致 warmup 阶段 `FileNotFoundError: [Errno 2] No such file or directory: 'ninja'`。
- **解法**：
  1. 纯 graph 先跑通，不带 profiler：

     ```bash
     export PATH=<REMOTE_WORK_ROOT>/.venv/bin:$PATH
     export CUDA_VISIBLE_DEVICES=2,3
     export VLLM_ALLREDUCE_USE_FLASHINFER=0
     export VLLM_CACHE_ROOT=/tmp/<run>/vllm_cache
     ```

  2. deploy 只改：

     ```yaml
     enforce_eager: false
     ```

  3. serve 使用绝对 chat template：

     ```bash
     --chat-template <REMOTE_WORK_ROOT>/vllm-omni/hunyuan_image3_i2t.jinja
     ```

  4. 启动前把 `command -v ninja`、`ninja --version`、`command -v vllm` 写进 run artifact；graph 失败时先 grep worker root cause，而不是停在外层 `StageEngineCoreProc died during READY`。
  5. 首轮冷编译可慢，AOT cache 命中后再重跑会快很多。本轮 `torch.compile` 从 `660.79s` 降到 `38.69s`。
- **怎么避免**：
  1. 用户明确给出最小方案时，先按最小方案端到端跑通；profiling、trace、额外 instrumentation 作为第二阶段。
  2. graph serve 状态按阶段汇报：service init、weight load、torch.compile、CUDA graph capture、orchestrator ready、health 200、smoke、正式 bench、artifact saved、resources released。不要用“还在跑/跑完了”这种含糊说法。
  3. AR-only bench 固定口径：`/v1/chat/completions`、`openai-chat-omni`、`{"modalities":["text"]}`；不要切到 DiT 或 `/v1/images/*`。
  4. 每轮结束必须打包 artifact 到本地，并只杀本轮 PGID；查端口和 GPU 后再说资源已释放。
