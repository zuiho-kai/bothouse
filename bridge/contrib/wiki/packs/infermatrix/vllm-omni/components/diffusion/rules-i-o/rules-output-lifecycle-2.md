---
name: rules-output-lifecycle-2
description: Diffusion output 与 multiprocess runtime 规则（2/2）DIFF-1s、4z、9a、11a、1ag、1ai、1aj、1ai2、1ak、VLLM-OMNI-PR8513-STREAM-CLOSE-CLEANUP：final_output_type 从 metadata 到 formatter 闭合、全 rank RPC 仅 reply owner 留输出、mux_av_video_audio_bytes 资源闭合、单 GPU `uni` executor、InteractionCoordinator chunk 边界与原子入队、typed DiffusionOutput.media、worker shutdown 升至 SIGKILL、init_device 后失败先 shutdown、_out_streams 按 identity 释放
metadata:
  scope: 只收 DIFF-1s、4z、9a、11a、1ag、1ai、1aj、1ai2、1ak 与 VLLM-OMNI-PR8513-STREAM-CLOSE-CLEANUP；DIFF-1aa 至 DIFF-1ab 见 rules-output-lifecycle-1，视频 IPC 传输规则 DIFF-VIDEO-IPC-1a、1b 归 rules-video-transport
---
# Diffusion output 与 multiprocess runtime 规则（2/2）

## 关键事实

- 拆分说明：本页是源页 `rules-output-lifecycle.md` 的第 2/2 部分；第 1 部分 [[rules-output-lifecycle-1]]
- 源页：`knowledge/repos/vllm-omni/components/diffusion/rules-output-lifecycle.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, diffusion；created: 2026-09-02；updated: 2026-10-14
- [DIFF-1s] diffusion output type 必须从模型声明闭合到 topology 与 formatter
  - 触发：diffusion pipeline 产生 image/video/audio/action 等输出，或修改 model metadata、registry alias、topology `final_output_type`、formatter/post-process 与 multiprocess 传递路径。
  - 强制：metadata 按 direct class → metadata alias → registry architecture class/alias → default 的顺序解析；model class 与 registry alias 必须解析到同一 canonical output metadata。默认单 stage config、multi-stage final stage、video endpoint capability 与 `OmniRequestOutput` formatter 必须传播同一类型。未知模型才回 image；
    - 非媒体输出使用稳定的 `DiffusionOutput.output` key，并注册可跨 orchestrator multiprocess 边界解析的 module-level post-process callable。SANA 的 `SanaVideoPipeline` 与 `SanaImageToVideoPipeline` 都必须 direct metadata 声明 `final_output_type="video"`；这是 serving metadata 分类，非 I2V input schema、denoise、topology 或 VAE 合同变更。
    - LTX 的 `LTX2DistilledOneStagePipeline` 与显式 `LTX2DistilledTwoStagePipeline` 必须都经 metadata alias 收敛到 canonical `LTX2DistilledPipeline` 的 video metadata；同一结论还必须在 registry architecture→pipeline class 解析路径成立。
  - 验收：逐个 canonical class/alias 断言 default 与 multi-stage final type，video/image endpoint 正负 capability 及最终 output type；action 另验证 post-process callable 可跨目标进程边界使用，最终 output 保留 stable key、shape、dtype 和有限性。PR #6953 的 CPU metadata unit test 只断言两种 SANA class 均分类为 video；
    - PR #6847 的同类 CPU metadata test 只覆盖显式 LTX distilled two-stage alias 分类。两者都不是新的 endpoint、真实模型或 online/offline E2E 证据。^[PR #4222] ^[PR #5885] ^[PR #6847] ^[PR #6953]
- [DIFF-4z] 全 rank RPC 必须执行，但仅 reply owner 保留输出
  - 触发：RPC 在所有 rank 执行，而 `output_rank` 或 DP replica primary 决定唯一回复者；结果可能携带 device-resident diffusion 输出。
  - 强制：所有应执行 rank 都调用目标方法以维持 collective 语义；`should_reply=false` 时在 `_worker_busy_loop` 绑定返回值之前返回 `(None, False)`，只有回复 rank 保留并 enqueue 原结果。
  - 验收：非回复 rank 断言目标方法确实执行且返回 `None, False`；回复 rank 断言返回同一对象。测试必须覆盖实际采用的 reply-selection 形式。当前证据只覆盖 CPU 单元级返回所有权，不证明 GPU 显存下降或真实多进程回收时序。^[PR #6989]
- [DIFF-9a] 共享 PyAV 预构造帧 mux 必须闭合资源与音频时间零点
  - 触发：修改共享 diffusion 的预构造 PyAV 视频帧 mux、可选音频 mux、container cleanup 或编码器异常传播。
  - 强制：`mux_av_video_audio_bytes()` 必须在 context manager 内打开并配置 MP4 video/audio streams，消费 `Iterable[av.VideoFrame]` 后 flush video encoder；音频按 `fltp` 和 mono/stereo layout 构造，并以 `pts=0`、`time_base=1/sample_rate` 标记输入时间零点。
    - `audio_sample_rate` 可为 `None`：仅在 audio waveform 存在时内部解析为 44.1 kHz，video-only 不创建 audio stream，也不需要采样率。成功和 generator、encoder、mux 异常都必须退出 context 关闭 container，同时原样传播原始错误。
  - 验收：测试覆盖预构造 `gbrp` 帧的 H.264 mux、无音频/mono/stereo 音频、`None` rate 的 video-only 与 audio 44.1 kHz default、AAC 首个有效 packet 的负 priming PTS、video flush 和 container close；让 frame generator 在中途抛错并断言 container 已关闭且异常 identity 保持，再用固定媒体输入执行 ffprobe 与完整 FFmpeg 解码。^[PR #6288] ^[PR #6499]
- [DIFF-11a] 单 GPU diffusion executor 必须保持进程内故障与生命周期语义
  - 触发：新增或修改单 GPU diffusion executor、inline worker RPC、设备故障处理或 executor shutdown 生命周期。
  - 强制：单 GPU 的 `uni` 路径必须在 engine 进程内构造并驱动 `WorkerWrapperBase`，仍初始化一个 rank 的 distributed environment，但不得创建 worker subprocess、`MessageQueue` 或 IPC 输出段；
    - `collective_rpc` 直接调用 worker，保留 reply-rank 的返回形状，recoverable request error 留在请求级，sticky accelerator fault 必须 latch executor failure、只触发一次 failure callback，并让 `check_health()` 抛出 `EngineDeadError`。
  - 验收：覆盖 omitted/显式 backend/多 GPU 的选择矩阵、直接 RPC 与返回形状、recoverable error、CUDA/NPU sticky fault、callback once、health failure、部分构造 cleanup 和幂等 shutdown；
    - 真实单 GPU smoke 还须验证一 rank group、`InlineStageDiffusionClient`、真实 `DiffusionOutput` 流程、worker shutdown，以及固定 seed 下与 pinned `mp` 的输出一致性，mock 不能替代这些证据。 ^[PR #6308]
- [DIFF-1ag] mid-stream interaction 必须经 modality handler 在 chunk 边界应用
  - 触发：修改 `InteractionCoordinator`、`InteractionMixin`、`SupportsInteractionApply`、prompt/camera 等 interaction handler、chunk-boundary apply，或试图恢复 `PromptUpdateMixin`/`prompt_update.py`。
  - 强制：runner 与 pipeline 共有同一 `InteractionCoordinator`；仅对已注册 modality 构造 handler；`enqueue` 按 modality 路由；`apply_at_chunk_boundary` 以稳定顺序推进（prompt 优先，再及其他 modality）；per-request session 落在 `StepRequestState.interaction_sessions`，chunk ACK 元数据写入 `interaction_chunk_metadata`。
    - 未注册 modality 必须 fail closed。当前公开行为保持 prompt-only，直到另有 PR 注册并验收非 prompt handler。
  - 验收：覆盖 prompt enqueue→chunk-boundary apply→ACK event id、未注册 modality 拒绝，以及无 session 的 modality 跳过；不得用本框架落地证明 camera/MM 路径已可用。^[PR #6294]
- [DIFF-1ai] 迁移后的视频输出必须以 typed `media` 为唯一能力信号
  - 触发：修改 `DiffusionOutput`、device-side video postprocess、`video_output_transport`、runner 预 D2H 准备、worker IPC media envelope 或 engine finalizer 路由。
  - 强制：迁移动画输出以 `DiffusionOutput.media`（`DiffusionMediaOutput`）为唯一能力信号，与 legacy `output` 以及 model-specific `post_process_func` 互斥。runner 在 normalize/request-split 之后、异步 D2H 之前完成 request-owned 准备：合格视频转 contiguous uint8 `BTHWC`，或按策略保留已标 transport-ready 的 float；
    - IPC 只接受 transport-ready 的版本化 `diffusion_media_v1` envelope；engine 走通用 media finalizer，绕过 legacy model postprocessor。`to_cpu=True` 前 media 必须已 prepared。feature 默认关闭，经 `video_output_transport.enable_device_postprocess` 显式开启。合同违规 fail loud；OOM 可回退到 owned float 并告警，其他 runtime 错误仍传播。
    - 未迁移模型保持 legacy path。
  - 验收：正负覆盖互斥字段、未 prepared `to_cpu`、IPC 拒收未就绪 media、opt-in 开关与 OOM float fallback；至少一条迁移模型（如 WAN2.2 非 latent）走 typed path，一条未迁移模型仍走 legacy。^[PR #6615]
- [DIFF-1aj] multiproc worker shutdown 必须升至 SIGKILL 并保留幸存者供重试
  - 触发：修改 `_ExecutorShutdownCleaner`、diffusion worker process join/terminate/kill、worker monitor 与显式 `shutdown()` 的竞态，或 cleaner 持有的 process 引用生命周期。
  - 强制：cleanup 按有界三阶段推进：cooperative join → `terminate`+join → `kill`+join；信号/join 的 `OSError` 不得中断 peer cleanup。最终仍存活的进程必须记 error（含 name/pid）并保留在 cleaner 上，供下一次显式 shutdown 重试，不得在第一次失败后丢弃引用。cleaner 用非阻塞锁，防止 monitor 与显式 shutdown 并发操作同一批 `Process`；二次进入直接返回。`broadcast_mq` 在 enqueue 成败后都要清空；
    - result-pump/pending-future 清理仍在 `finally`。
  - 验收：真实 CPU child（含忽略 SIGTERM）在 queue 失败时经 SIGKILL 退出并被 reap；合作退出路径 exit 0；覆盖 shared deadline、signal/join OSError 续跑、幸存者保留与并发 cleaner。^[PR #7126]
- [DIFF-1ai2] 复合 mid-stream interaction 必须原子入队，非懒会话在 chunk0 前物化
  - 触发：修改 `InteractionCoordinator.enqueue_parts`、`lazy_initialize_session`、camera/`multi_modal_data` 与 prompt 同事件入队、`synchronized_monotonic_time`，或 chunk-boundary apply 的 media/latent 计数。
  - 强制：含多 modality 的同一事件先全部 `validate_payload`，再入队；任一路不支持或非法不得部分改队列。`received_at`/boundary 时钟经 rank 同步，使 USP/SP 分片共享同一到达时刻。`lazy_initialize_session=False` 的 handler（如 camera）必须在首个 denoise chunk 前 `maybe_prepare_initial_session`，即使尚无 client enqueue。
    - chunk apply 区分 `num_media_frames` 与 `num_latent_frames`，需要者才 `peek_chunk_media`。
  - 验收：复合 prompt+camera 原子成功/失败、未注册拒绝、非懒会话在 chunk0 前存在、介质计数字段传播。^[PR #7198]
- [DIFF-1ak] inline DiffusionWorker 在 init_device 之后失败必须先 shutdown 再抛出
  - 触发：修改 `DiffusionWorker.__init__` / `shutdown`、`WorkerWrapperBase` 自定义 pipeline 再初始化，或同一进程连续构造 sleep-enabled `uni`/`mp` worker。
  - 强制：`init_device()` 已占用 process-global distributed / CuMem 后，runner 解析、load、LoRA 或 wrapper 再初始化失败必须调用幂等 `shutdown()` 再重抛**原始**异常。
    - `shutdown` 先断开 model/LoRA/profiler/sleep-buffer/request-state 引用，再停 offloader 与 KV-transfer，best-effort 清 connector、A2A workspace 与 distributed state，只释放本 worker `_owns_sleep_pool` 的池，并同步/回收后检查 allocator。cleanup 自己失败不得遮蔽原始 init 异常。
  - 验收：覆盖 init-after-`init_device` 失败、wrapper 再初始化失败、cleanup 异常不改写根因、shutdown 幂等与所有权；不得把单次 AMD custom-pipeline 变绿外推为所有平台已无 leftover mapping。^[PR #7986]
- [VLLM-OMNI-PR8513-STREAM-CLOSE-CLEANUP] 未启动即关闭的 output stream 也必须释放队列注册
  - 触发：修改 `vllm_omni/diffusion/diffusion_engine.py` 的 `_out_streams` 注册/释放、`get_output_stream()` 的签名与报错时机、`_ClosingOutputStream` wrapper，或 `async_add_req_and_stream_response` 返回流的关闭语义。
  - 强制：队列注册的释放不能只依赖底层 async generator 的 `finally`——未启动的原生 generator 被 `aclose()`/`athrow()` 时函数体（含 `finally`）不会执行。必须在 wrapper 的 `asend`/`athrow`/`aclose` 各自的 `finally` 中、且仅当底层 generator 已结束（`ag_frame is None`，用于区分已关闭与并发使用被拒绝）时触发一次性 release 回调（触发后置 `None`，使重复 `aclose()` 幂等）。
    - 释放以对象 identity（`self._out_streams.get(request_id) is queue`）为前提；流在 `get_output_stream()` 调用时即绑定当时的 queue，延迟迭代读取原 queue，request_id 复用后关闭旧流不得删除 replacement queue。`get_output_stream()` 保持同步函数并在调用点抛 missing-request `RuntimeError`；eager admission 不变——流返回时请求已进入 scheduler；
    - 关闭流只从 `_out_streams` 移除注册，不自动取消已调度请求。
  - 验收：覆盖未启动/已启动后关闭、重复 `aclose()`、对未启动流 `athrow()`、request_id 复用后关闭旧流（replacement 仍注册且不被消费）、延迟迭代取到原 queue 的内容、迭代进行中 `aclose()` 被拒绝（注册保留，取消挂起迭代后再次关闭成功释放）；并以 weakref 断言保留已关闭的流对象不再持有 queue 引用。^[PR #8513]

## 决策与踩坑

- [DIFF-1s] 禁止：只在 topology 标 video 但 formatter 仍发 image；要求每个 stage 都是 diffusion 才允许 video final；遗漏已注册 video alias 后静默回 image；用 ndarray 形状猜语义，或把局部 closure 作为跨进程 hook。
- [DIFF-4z] 禁止：因不回复而跳过执行，或把非回复 rank 的 device-resident 结果交回 busy loop 并保留到下次请求覆盖。
- [DIFF-9a] 禁止：在 generator 消费前或 context 外打开/使用 container；只在成功路径手工 close；吞掉帧生成或编码异常后静默改走其他 muxer；把 mock container cleanup 或单一 CPU 运行误认为完整跨硬件 A/V parity。
- [DIFF-11a] 禁止：单 GPU 默认继续走 `mp`，多 GPU 选择 `uni`，把 inline `timeout` 描述成可强制的 RPC deadline，或把所有 worker exception 都升级为 engine death；设备上下文已中毒后不得继续报告健康，也不得让部分构造失败或重复 shutdown 遗留 worker、callback、缓存或 device allocation。
- [DIFF-1ag] 禁止：在 denoise 中途旁路 coordinator 直接改 `prompt_embeds`；在非 chunk 边界静默应用 interaction；未注册就接受 camera/`multi_modal_data`；或把内部 handler 重构当成用户 API 已扩展。
- [DIFF-1ai] 禁止：对已迁移路径同时填充 `media` 与 legacy `output`；未准备就 D2H/to_cpu；把 HTTP sink、codec 策略或未迁移模型静默当作同一 Phase-1 合同。
- [DIFF-1aj] 禁止：只做 graceful+SIGTERM 后假定已退出；失败后清空 process 列表导致无法再 reap；把存活进程当作 GPU 内存已回收或 HWR/服务自动重启已完成。
- [DIFF-1ai2] 禁止：先入队再校验导致半更新；把未注册 camera 当已可用；懒会话与必须预创建会话混用同一 skip 逻辑；用未同步的 per-rank `time.monotonic()` 驱动跨分片时间线。
- [DIFF-1ak] 禁止：构造失败后留下非空 model-parallel state，让下一实例撞 `model parallel state must be empty`；shutdown 后仍让 CuMem 跟踪的模型分配活着，让下一 sleep worker 撞 `Sleep mode can only be used for one instance per process`；依赖 wrapper 不可达来做确定性 teardown。
- [VLLM-OMNI-PR8513-STREAM-CLOSE-CLEANUP] 禁止：把清理全部寄托在 generator `finally`；按 request_id 相等而非对象 identity 决定 pop；底层 generator 仍在执行（`aclose()` 抛 "already running"）时释放注册；让重复关闭二次执行回调或波及 replacement queue；把 missing-request 错误推迟回首迭代才抛出。
