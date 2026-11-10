---
name: ar-graph-online-2026-06-09-overview
description: 2026-06-09 HunyuanImage3 AR graph online（hunyuan_image3_ar 单阶段 vllm serve 加 vllm bench serve）总览：runbook、decode-only 跳过 MM embedding 的 fast path 只出 3 tokens 的误判、启动耗时拆解和优化方向
metadata:
  scope: 只收这轮 AR graph online 调查的目标、runbook、被排除的 fast path、启动耗时和后续方向；有效 trace 数字归 ar-graph-online-2026-06-09-trace，patch 对照归 ar-graph-online-2026-06-09-timestep-patch 和 ar-graph-online-2026-06-09-no-profiler
---
# HunyuanImage3 AR Graph Online 结果总览

## 关键事实

- 源页：`knowledge/repos/vllm-omni/benchmark/results/ar-graph-online-2026-06-09-overview.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter
- 目标：观察 AR graph online 路径中 decode step 间隙和短 memcpy 现象，尝试优化 `hunyuan_image3_ar` 单阶段 `vllm serve` + `vllm bench serve` 路径。
- 关键 runbook：
  - 远端：`root@<REMOTE_HOST>:31342`
  - 工作仓：`<REMOTE_WORK_ROOT>/vllm-omni`，该仓有 serving 侧 dirty patch；clean worktree 启动同命令会 400，不能拿 clean worktree 直接做 online 对照。
  - AR graph deploy：`enforce_eager: false`，`devices: "0,1"`，外层 `CUDA_VISIBLE_DEVICES=2,3` 映射物理 GPU 2/3。
  - 必须用本地模板绝对路径：`--chat-template <REMOTE_WORK_ROOT>/vllm-omni/hunyuan_image3_i2t.jinja`。
  - 共享机器上 GPU0 有其他用户进程；本轮只用 GPU2/3，结束后确认两张卡回到 `4 MiB`。
  - 大模型启动前设置 `HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1`，日志应出现 snapshot 替换，避免网络/下载抖动。
- 本轮误判和排除：
  - 试过在 `OmniGPUModelRunner._preprocess` 对 decode-only batch 跳过 multimodal embedding path，直接用 `input_ids` 进模型。这个优化 **不可用**。
  - 证据：同一 dirty serving、同一 bench 命令、同一 GPU、同一 seed 下：
    - fast path：`Successful requests=1`，但只生成 `3` tokens，`Mean TPOT=1795.63 ms`。
    - baseline：生成 `294` tokens，`Mean TTFT=792.78 ms`，`Mean TPOT=12.99 ms`，`Output throughput=63.93 tok/s`。
  - 结论：HunyuanImage3 AR 的 multimodal input/kwargs 路径在 decode 阶段仍然是语义契约的一部分，不能为了减少 `embed_input_ids -> inputs_embeds.copy_` 把 supports-mm 模型切到普通 text-only `input_ids` 路径。
- 启动耗时拆解：
  - baseline 对照：`Model loading took 78.71 GiB memory and 37.95s`，`Graph capturing finished in 7s`，`AsyncOmniEngine initialized in 88.56s`。
  - fast path 首次修改 runner 后：`torch.compile took 51.56s`，`AsyncOmniEngine initialized in 166.40s`。这不是“图模式本身 15 分钟”，而是代码变更触发新的 torch compile cache key；恢复 baseline 后 cache 命中，engine init 回到约 1.5 分钟。
  - 首请求仍有 Triton JIT during inference：`_compute_slot_mapping_kernel`、`kernel_unified_attention`、`fused_moe_kernel`。这会污染 TTFT/首轮 trace；正式性能测量应先跑 warmup 请求，或者把这些形状纳入 engine warmup，再开始 profiler/benchmark 主请求。
- 后续正确优化方向：
  1. 不再改 AR decode 输入契约；任何跳过 MM embedding 的方案必须先做 token 序列 parity，至少比较 `ignore_eos=True` 下生成 token 数和前几十个 token。
  2. 优先优化首请求 JIT：复用已有 `dummy_run` / graph capture / serving warmup 机制，覆盖真实 AR image prompt 的 slot mapping、attention、MoE 形状。
  3. profiling 要在 warmup 请求之后打开，在目标请求完成后关闭；否则 trace 会主要记录启动、compile、空闲或无效短输出。
