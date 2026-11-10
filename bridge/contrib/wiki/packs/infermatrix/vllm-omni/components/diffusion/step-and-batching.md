---
name: step-and-batching
description: Diffusion step 执行合同与 batching：step_execution × max_num_seqs 四种配置表（RequestScheduler / StepScheduler）、request-level batching 与实验性 continuous batching、supports_step_execution 的 grouped contract、DIFF-1af BAGEL image step wave 的 packed-state 合同、多 document packing、step_streaming() 统一 output stream 生命周期
metadata:
  scope: 只收 diffusion step 化与 request/continuous batching 的执行合同；request_batch_max_wait_ms 的 admission 等待细则归 rules-admission-wait，缓存后端归 cache-acceleration，paged KV 请求控制面归 paged-kv-control-plane
---
# Step 执行合同与 batching 模式

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/diffusion/step-and-batching.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, components, diffusion；created: 2026-07-16；updated: 2026-09-05
- 来源（sources）：PR #5599；PR #5810；PR #6045；PR #6359；PR #7049；docs/design/feature/diffusion_continuous_batching.md；docs/user_guide/diffusion/execution_modes.md；vllm_omni/diffusion/diffusion_engine.py；vllm_omni/diffusion/models/interface.py；vllm_omni/diffusion/sched/request_scheduler.py
  - vllm_omni/diffusion/sched/step_scheduler.py；vllm_omni/diffusion/worker/diffusion_model_runner.py；tests/diffusion/test_diffusion_engine.py；tests/diffusion/test_diffusion_step_pipeline.py；tests/diffusion/models/bagel/test_step_execution.py
- 官方设计入口已合并为 `docs/design/feature/diffusion_continuous_batching.md`，用户配置入口是 `docs/user_guide/diffusion/execution_modes.md`（`main @ 9f978923` 复核）。旧的 step、request batching 设计页及两份用户指南已删除；迁移依赖 MkDocs redirects，不能继续把旧路径当 source。

### 两个开关组成四种配置，不是四个 engine mode

| `step_execution` | `max_num_seqs` | scheduler / 执行语义 |
|---|---:|---|
| false | 1 | `RequestScheduler`；一次完整 `forward()`，串行 request |
| false | >1 | `RequestScheduler`；兼容 request 融合为一次完整 `forward()` |
| true | 1 | `StepScheduler`；每个 tick 推进一个 request 的一个 denoise step |
| true | >1 | `StepScheduler`；兼容 request 共享 step wave，即 continuous batching |

- 前两行在 engine 中同属 `REQUEST_BATCH`，后两行同属 `STEP_BATCH`。`max_num_seqs>1` 只是容量，不会自动赋予 pipeline 批处理能力。

### step_execution 不是通用开关

- `step_execution=True`（serving：`--step-execution`）只对实现了 `vllm_omni/diffusion/models/interface.py` 中**分段有状态合同**的 pipeline 生效；它是"作者实现合同 + 用户 opt-in 旋钮"的两层结构——给新 pipeline 加支持要按该接口实现，不要当成 runtime 配置随手打开。

### 两种 batching，别混

- **request-level batching**：对**兼容**的等待请求组成一个调度波，跑一次完整 pipeline `forward()`（静态批）。设计动机：不把多个逻辑请求耦合进一个 request 对象——请求身份、abort/错误处理、逐请求元数据保持清晰，同时对突发并发流量仍只发一次融合前向。每个 `OmniDiffusionRequest` 仍是单 prompt + 单 request_id。
- **continuous batching（实验）**：叠在 `step_execution=True` 之上——step 化把长 denoise 循环拆成调度器可见的单元，运行时得以在 denoise step 之间接纳其他兼容请求、共享同一 denoise 前向。收益在低 MFU/突发场景（吞吐与设备利用率）；**不保证单请求延迟收益**。基础 step 合同不变，改动集中在 scheduler 与 runner 层（`vllm_omni/diffusion/sched/`、`worker/`）。
- request mode 的 `max_num_seqs>1` 要求 pipeline 显式声明 `supports_request_batch=True`，否则 engine 初始化失败（DLO DP concurrent 保留已有例外）。`request_batch_max_wait_ms` 的具体启停、stable window 与 deadline 已归 `RequestScheduler`；见 [[rules-admission-wait]]（admission wait rules）。它用首请求延迟换 batch formation。

### step capability 必须验证 grouped contract

- `supports_step_execution=True` 只证明四段 stateful contract（`prepare_encode`、`denoise_step(input_batch, *, states=...)`、`step_scheduler`、`post_decode`）存在，不证明 `denoise_step` 能处理多个 state。Qwen-Image 支持 grouped step；HunyuanImage3 只有 resolved self-attention backend 为 `TORCH_SDPA` 时支持 grouped step；
  - Helios 会拒绝 `len(states) != 1`，因此必须使用 `--step-execution --max-num-seqs 1`。新增 pipeline 不能只凭 capability flag 宣称 continuous batching，须用两个重叠且兼容的真实请求覆盖 state 隔离、abort 与输出归属。
- step mode 当前拒绝所有 diffusion cache backend，但这不等于拒绝 inter-stage KV transfer：runner 对新 admission 先调用 `receive_multi_kv_cache_distributed()`，再 `prepare_encode()`，且有顺序测试。限制描述必须区分这两个机制。

### [DIFF-1af] BAGEL image step wave 是模型专有的 packed-state 合同

- **适用范围**：BAGEL 的 image-only step execution，不向其他 pipeline 推导 geometry、CFG 或 schedule 语义；模型侧完整合同见 [[bagel-rules]]（BAGEL-3；源锚点 #bagel-3step-image-wave-必须保持请求局部状态与兼容边界）。
- **合同**：BAGEL 的四段 step lifecycle 可将多个兼容 image state 打成一波 DiT forward，但每个 request 的 latent、timestep/scheduler、KV/CFG context、renormalization 和 output/trajectory 保持局部；packed token indexes 要按 request rebase，结果也要按 request split。
  - admission 先为 img2img 求 effective geometry，且仅 geometry 与 BAGEL CFG/renormalization 设置均相同者可同 wave。two-stage topology 只让 diffusion Stage 参与，single-stage 显式 text output 保持 complete-request forward；BAGEL step mode 拒绝 SP 和 diffusion cache backend，但可保留 inter-stage KV transfer。
- runner 在 finished/aborted step state 后若切到 full-forward wave，必须先清理 state cache、paged diffusion-KV 与 stale `InputBatch`。BAGEL schedule 以当前模型实现为准：#7049 已将 #6359 的临时语义恢复为 `N` schedule points 对应 `N - 1` Euler updates，image path 拒绝 `N < 2`；不要将该模型历史 benchmark 或“exactly N updates”泛化成 shared step contract。
- **验收**：至少两条兼容 image request 覆盖 packed-state isolation、CFG3、index rebasing 与逐请求 output；再覆盖 geometry/CFG 不兼容不合批、SP/cache rejection、以及 step finish/abort → explicit text full-forward cleanup。^[PR #6359] ^[PR #7049]

### 多 document packing 是模型能力，不是 continuous batching 的默认语义

- 通用 step contract 只要求 scheduler 能交付一组 state；是否能把它们塞进**一次** DiT forward，取决于所有 resolved attention consumer 是否实际支持并消费 multi-document `cu_seqlens`。不支持、Ring attention 或 task-specific DiT 不同都应退回逐 request forward，且不可通过 backend 名称或 `max_num_seqs` 推断安全。
  - MiniMax-H3 的 64-row tail、video/audio row split、Cache-DiT/DLO/multi-output 限制和 rank-0 prepare broadcast 是其模型 owner 合同，不应泛化给其他 pipeline。target runner 的 `_dit_any_rank_failed()` 因缺失 DiT-group accessor 而只返回 local failure，且未按 group backend 选择 signal device；
  - 在补齐并以多 rank 负向用例证明前，通用 runner 不提供 failure synchronization 保证。^[PR #5810]

### output stream 是统一生命周期

- streaming 与 non-streaming caller 都消费 `DiffusionEngine.step_streaming()` 对应的 per-request queue；前者转发每个 chunk，后者 drain 后只返回最终结果。terminal scheduler result 负责完成 request state；consumer cancel/disconnect 删除 delivery queue，但 scheduler 仍须完成清理；shutdown 给剩余 stream 发送 error。
  - 兼容 wrapper `step()` 与 `async_add_req_and_wait_for_response()` 已 deprecated，新集成应使用 streaming API。

### 相关

- 噪声调度/采样归 [[diffusion-overview]]（Diffusion 组件）；请求级排队语义见 [[scheduler-overview]]（Scheduler 组件）（AR 侧对照）。
