---
name: rules-output-lifecycle-1
description: Diffusion output 与 multiprocess runtime 规则（1/2）DIFF-1aa、1d、1g、1h、1j、2k、1i、1q、1r、1ab：Diffusers adapter 与 native checkpoint identity、async output 的 compute-done/output-ready 两阶段、per-worker result queue 唯一 pump 与 SHM owner、request-mode shutdown 时限、Engine 构造失败清理、DLO AllGather DP wave、AAC mux pts=0、VLLM_OMNI_ASYNC_OUTPUT_TIMEOUT、共享 Future 取消竞态、StageDiffusionProc 插件重载
metadata:
  scope: 只收本页 sources 清单与 DIFF-1aa、1d、1g、1h、1j、2k、1i、1q、1r、1ab；DIFF-1s 及之后（output type、reply owner、PyAV mux、uni executor、interaction、typed media、SIGKILL shutdown、stream close）见 rules-output-lifecycle-2，IPC 发送与 client status 归 rules-ipc-errors
---
# Diffusion output 与 multiprocess runtime 规则（1/2）

## 关键事实

- 拆分说明：本页是源页 `rules-output-lifecycle.md` 的第 1/2 部分；第 2 部分 [[rules-output-lifecycle-2]]
- 源页：`knowledge/repos/vllm-omni/components/diffusion/rules-output-lifecycle.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, diffusion；created: 2026-09-02；updated: 2026-10-14
- 来源（sources）：PR #5550；PR #5864；PR #5885；PR #5978；PR #6750；vllm_omni/diffusion/diffusion_engine.py；vllm_omni/diffusion/executor/multiproc_executor.py；vllm_omni/diffusion/inline_stage_diffusion_client.py；vllm_omni/diffusion/io_support.py；vllm_omni/diffusion/model_metadata.py
  - vllm_omni/diffusion/output_formatter.py；vllm_omni/diffusion/ipc.py；vllm_omni/diffusion/sched/request_scheduler.py；vllm_omni/diffusion/stage_diffusion_proc.py；vllm_omni/diffusion/utils/media_utils.py；vllm_omni/diffusion/worker/diffusion_worker.py
  - tests/diffusion/test_async_output_timeout.py；tests/diffusion/test_async_output_worker.py；tests/diffusion/test_diffusion_engine.py；tests/diffusion/test_diffusion_engine_cleanup.py；tests/diffusion/test_diffusion_ipc.py；tests/diffusion/test_inline_stage_diffusion_client.py
  - tests/diffusion/test_ipc_async.py；tests/diffusion/test_multiproc_engine_concurrency.py；tests/diffusion/test_result_pump.py；tests/diffusion/test_stage_diffusion_proc.py；tests/entrypoints/openai_api/test_video_server.py；PR #6023；PR #5983；PR #4222；PR #6094；PR #6255；PR #6288；PR #6308
  - PR #6499；PR #6749；PR #6847；PR #6953；vllm_omni/diffusion/data.py；vllm_omni/diffusion/registry.py；vllm_omni/diffusion/models/diffusers_adapter/pipeline_utils.py；tests/diffusion/test_diffusion_output_formatter.py；tests/diffusion/test_diffusion_plugin_hooks.py
  - tests/entrypoints/openai_api/test_video_pipeline_capability.py；PR #6294；PR #6615；PR #7126；PR #7198；PR #7986；PR #6989；PR #8513
- 置信度（confidence）：high
- [DIFF-1aa] Diffusers execution backend 不得冒充 native checkpoint identity
  - 触发：修改 `diffusion_load_format`、custom pipeline 选择、checkpoint `model_class_name`、pre/post-process hook、request batching 能力或 frame interpolation。
  - 强制：`uses_diffusers_adapter()` 只表示实际 execution backend；存在 `custom_pipeline_args` 时 custom pipeline 优先并令其为 false，即使 load format 是 Diffusers。checkpoint 的 native `model_class_name` 继续承载 modality/capability metadata，但 effective Diffusers adapter 不运行 native pre/post hooks。
    - batch capability 必须从实际 executor 派生：先 custom pipeline，再 `DiffusersAdapterPipeline`，否则才查 native class。Diffusers adapter 收到 frame interpolation 必须 fail fast，因为它交付的 frame 已完成 post-process。
  - 验收：组合覆盖 native、Diffusers adapter、Diffusers load format + custom pipeline 三类配置，断言 class identity 保留、hook 选择和 batch capability 跟随实际 executor；另验证所有 Diffusers pipeline 对 interpolation 抛出明确错误。PR #6749 的自动化测试覆盖这些选择边界，但不证明任意第三方 custom pipeline 或未来 Diffusers 版本兼容。^[PR #6749]
- [DIFF-1d] async output 的 compute 与 output-ready 必须分成两个可观察阶段
  - 触发：把 diffusion D2H/SHM packing 移到 worker 后台线程，或修改 result pump、`collective_rpc`、batch output split。
  - 强制：GPU compute 完成只释放下一次 forward；最终输出必须等 side-stream event、D2H 和 SHM packing 完成后再 resolve。每个 worker-owned result queue 由唯一 pump reader 分发，batch 结果按 request 映射拆分；step-mode 保留同步路径。
  - 验收：覆盖 compute-done、output-ready、RPC error、batch split、queue cleanup 与非 CUDA/step-mode fallback。^[PR #5864]
- [DIFF-1g] 每个 worker result queue 必须有唯一 reader 与显式 SHM owner
  - 触发：request-mode worker result queue、async pump、multi-rank reply 或 tensor/NumPy SHM serialization。
  - 强制：每个 worker 创建独立 result queue，executor 为每个 queue 建唯一 pump；RPC/output future 按 envelope ID 路由，DP reply 保留 rank tag。递归 pack/unpack 必须覆盖 tagged/RPC envelope、nested dict/list/tuple、tensor 与大于 1MB 的 non-object ndarray；reader copy 后 close+unlink segment。
  - 验收：真实 spawn workers 各建 queue，传 nested tensor/video/audio ndarray，验证 tag/order/dtype/value，所有 pump 停止、queue 关闭、SHM name 不再可 attach。当前测试覆盖成功 round-trip；partial pack、unpack/copy 异常时已创建 segment 的回收仍缺 fault-injection。^[PR #5864]
- [DIFF-1h] request-mode shutdown 必须幂等、有界且按 engine→task/IPC 顺序完成
  - 触发：worker async-output thread、executor process cleanup、inline client 或 orchestrator pre-mark shutdown。
  - 强制：worker 用 sentinel 停 async thread，并证明 thread 已停止后才 teardown 它仍可能访问的 model/queue/SHM；executor 以全局 deadline join 全部 workers，统一 terminate survivors，再 join pumps/fail futures。inline client 区分 shutting-down 与 shutdown-complete，在 lock 内先 close engine 再等待 thread-pool；
    - 调用方复用 sampling params 时在 task 启动前同步 clone。
  - 验收：normal、worker shutdown exception、premarked、concurrent/repeated shutdown、blocked RPC、async output active 与 forced termination 都验证无 live thread/process/queue/SHM，future 到达终态。目标常量为 worker 15s 全局 join、5s terminate grace、async thread 10s、pump 2s；
    - async thread 超时仍存活时虽保留 result queue，却仍先调用 `worker.shutdown()`，model teardown 可能与 live output thread 竞态，且没有后续强制 thread/SHM/queue 回收证明。final 2×B300 rerun提供一次普通 TP2 与 DLO DP2 clean exit，但不替代 fault matrix。^[PR #5864]
- [DIFF-1j] Engine 构造失败必须释放已启动的 Executor
  - 触发：`DiffusionEngine.__init__` 在 executor 已启动后初始化 Scheduler、runtime state、execute function 或 logging。
  - 强制：任一步失败都 best-effort 关闭已赋值 Scheduler、shutdown executor，再原样重抛根因；cleanup 异常只能记录。此时同步状态可能尚未建立，不能调用完整 `close()`。
  - 验收：注入 Scheduler initialization failure，断言 close/shutdown 各一次且异常 identity 不变；另覆盖 cleanup 自身失败不遮蔽根因。^[PR #5550]
- [DIFF-2k] DLO AllGather DP wave 必须完整兼容或不可复用地 fail closed
  - 触发：DLO+AllGather、DP>1 允许 concurrent request，或修改 multi-rank `execute_model` RPC。
  - 强制：只在 DLO+AllGather+DP>1 放宽 single-request pipeline admission；preflight 复用完整 `RequestBatchSamplingParamsKey`，另比较 canonical `extra_args` 并拒绝空 prompt。shape、CFG、denoise schedule、output count、LoRA 与任何 future control-flow 字段必须相同；prompt/token length 和 seed/generator 可不同。
    - multi-rank reply 按 `dp_rank` tag 排序，step mode 从 `dp_rank * (TP*SP*PP*CFG)` 选择 replica primary result queue。
  - 验收：完整/partial wave、mismatch shape/CFG/steps/output/LoRA/extra_args、空 prompt、不同 seed/token length、rank tag 重排与 primary-rank topology 都覆盖；timeout 必须将 engine 标记失败、同步 shutdown 并通知 failure callback。timeout 默认 600s 且在 import 时从 env 读取，不是 request deadline。
    - final 2×B300 evidence 覆盖 ordinary TP2 与 H3 DLO DP2 的错误 wave→同 engine recovery→无 active child；仍只绑定 eager+CUDNN exact topology，不能推广到一般 DP/SP 或替代 per-replica SP/mmap redesign。^[PR #5864]
- [DIFF-1i] AAC mux 必须显式标记输入时间零点
  - 触发：修改共享 mux 的 audio-frame timestamp、codec/container 或 video API 输出。
  - 强制：共享 `mux_video_audio_bytes()` 在构造 AAC frame 时设 `pts=0`、`time_base=1/sample_rate`，让 MP4 以负 priming timestamp 表达 encoder delay，避免把 delay 暴露成前导静音。这是共享 mux caller 的 blast radius，不是 MiniMax H3 专属。
  - 验收：目标 focused test 解 mux 后断言第一个有 PTS 的 AAC packet `PTS<0`；样本和 A/V 对齐结论仍需独立的端到端波形/时序验收。^[PR #5978]
- [DIFF-1q] request-mode async output 交付必须覆盖传输、竞态与生命周期
  - 触发：修改 request-mode diffusion 的 async D2H/SHM output、`MessageQueue` 写入、batch split、result pump、future bookkeeping，或 worker 的 sleep/内存释放生命周期。
  - 强制：per-request tensor view 的 IPC packing 必须按 `max(view_bytes, storage_bytes)` 判断并只把 view 内容放入 SHM；`execute_batch` 注册 split map 时必须在同一锁下接管早到的 batch output；`result_mq` 的 `COMPUTE_DONE` 与 `OUTPUT_READY` 写入必须串行化；
    - result pump 必须先完成 SHM unpack，再在 `_futures_lock` 下原子 resolve waiter 或缓存 completed output；worker 执行 `sleep`/`handle_sleep_task` 和本地 sleep task 前必须等待 `drain_async_outputs()`。两个 `DiffusionEngine` wait 路径必须逐次解析 `VLLM_OMNI_ASYNC_OUTPUT_TIMEOUT`：正数 float 可覆盖 600s 默认值；无效值告警后回退默认值；
    - 超时日志必须给出可调的变量名与 executor bookkeeping。
  - 验收：覆盖 per-request shared-storage wire-size regression、早到和晚到的 batch `OUTPUT_READY`、已有 waiter 与缓存 future 的原子 resolution、并发 result queue writer 无 overlap、pending output 的 drain/timeout 及 sleep-before-drain 顺序；
    - 同时验证 non-sleep RPC 不 drain、SHM unpack/error path、超时诊断状态和 worker shutdown cleanup，以及两个 wait 路径的默认值、正数 integer/float override、逐次重读与非数/非正值的 warning+fallback。^[PR #6023] ^[PR #6255]
- [DIFF-1r] 共享 Future resolve 必须对取消竞态 fail-safe
  - 触发：修改 diffusion result pump、共享 `_rpc_futures`/`_output_futures`、`asyncio.wait_for()` 超时、请求 abort 或 shutdown future cleanup。
  - 强制：共享 Future 在 `done()` 检查后仍必须通过 `try_set_result`/`try_set_exception` 解析，并在 helper 内捕获 `concurrent.futures.InvalidStateError`，丢弃取消或已完成 Future 的晚到结果/异常，使 singleton pump 继续运行；仅 freshly-created 且尚未共享的本地 Future 可直接解析。
  - 验收：用 `done()` 固定返回 false 但实际已取消的 racy Future 覆盖 `COMPUTE_DONE`、`OUTPUT_READY`、batch split 与 shutdown cleanup，断言 pump 不抛 `InvalidStateError`、取消 Future 保持取消、同批健康 Future 仍完成，并回归相邻并发测试。\n^[PR #5983]
- [DIFF-1ab] spawned StageDiffusionProc 必须在 engine 前重载通用插件
  - 触发：修改 `StageDiffusionProc.run_diffusion_proc`、spawned diffusion engine startup 或 general plugin loader。
  - 强制：child 先安装 parent-death signal 与 SIGTERM/SIGINT handlers，再 `load_omni_general_plugins()`，最后构造 engine/proc；spawn fresh interpreter 不继承 parent plugin side effects。
  - 验收：mock parent-death signal、SIGTERM/SIGINT handlers、plugin reload 与 construction 的精确顺序；plugin failure 必须在 engine construction 前原样传播。GGUF child reload 仍须独立 full-model proof。^[PR #6750]

## 决策与踩坑

- [DIFF-1aa] 禁止：从 checkpoint metadata 或 load format 单独推导 execution backend、native hooks 或 batching；custom pipeline 已接管时仍套 adapter hook；对 adapter output 静默二次 interpolation。
- [DIFF-1d] 禁止：在 compute-done 时把未完成 device tensor 当最终 artifact；让多个线程同读一个 result queue；用同步 `.cpu()` 掩盖 stream ordering 或让下一 step 重写源 buffer。
- [DIFF-1g] 禁止：多个 worker 共写一个 queue 后假设 reply 不冲突；pump 与同步 caller 同读；object ndarray 进入 raw SHM；只释放顶层 handle 而泄漏 nested segment。
- [DIFF-1h] 禁止：把 orchestrator 的 pre-mark 当作 teardown 已完成；每 worker 单独耗完整 timeout；先等待可能阻塞在 engine RPC 的 executor 再 close engine；二次 shutdown 重复释放。
- [DIFF-1j] 禁止：构造异常直接逃逸并遗留 worker/monitor/GPU allocation，或用 cleanup 异常遮蔽初始错误。
- [DIFF-2k] 禁止：为凑 wave 静默改变用户 wait 配置；用 step count+extra_args 代替完整 key；partial collective timeout 后复用 process group。少于 DP 个 request 时 rank 以 `dp_rank % len(reqs)` 重复执行已有 request，只消费前 request-count 个排序输出；这是 correctness fallback 与额外计算，不得称为满 DP throughput。
- [DIFF-1i] 禁止：从负 AAC packet PTS 外推其他 codec/container、audio sample/duration/content、唇音同步或完整 A/V alignment。
- [DIFF-1q] 禁止：按 view 大小判断而让共享 batch storage 被 pickle 重复发送；在 split map 建立前缓存一个无人消费的 batch-level output；让多个线程并发写单写者 `MessageQueue`；SHM unpack 期间释放 future 锁导致 waiter orphan；释放 device memory 时仍允许后台 D2H/SHM 线程读取源 tensor；
  - 把单 tensor storage-aware packing 当作 aggregate serialized message 已不会溢出的证明，也不得据此推断外部 HTTP 视频传输已优化；不得在 request path 因无效 timeout 环境值抛出异常，也不得只修改其中一个 wait 路径。
- [DIFF-1r] 禁止：把 `not fut.done()` 与 `set_result()`/`set_exception()` 当作原子操作；在共享 Future 上保留未保护的 resolve 调用；让取消竞态异常逃逸并杀死 result pump，随后仍以健康检查通过推断任务会完成。
- [DIFF-1ab] 禁止：在 parent import/pin 后假定 child 已注册 loader hook，或将此 ordering 外推为任意 plugin 或完整模型 startup 成功。
