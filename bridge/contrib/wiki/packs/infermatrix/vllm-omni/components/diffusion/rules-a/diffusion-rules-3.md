---
name: diffusion-rules-3
description: Diffusion 共享规则（3/3）DIFF-1x、1y、3a、4m、4n、4r、6a、10a、10b、10c 与 VLLM-OMNI-PR8510-MHC-FP32-MUSA：FLUX.2-Klein position ids、MUSA SwiGLU fused op、质量阈值 exact case、worker spawn 线程数、SHM overflow 配对接收、_DiffusionVllmModelConfig shim、request-level batching 兼容键、regional compile 与 HookRegistry、稀疏 video attention、custom op mutable 参数、MAGI-2 mHC FP32
metadata:
  scope: 只收 DIFF-1x、1y、3a、4m、4n、4r、6a、10a、10b、10c 与 MAGI-2 mHC 的 MUSA 规则；路由表归 diffusion-rules-1，DIFF-1a 至 1p 归 diffusion-rules-2，Wan VAE spatial shard 的 DIFF-3b 归 rules-wan-spatial-shard，request batch 的 pipeline 合同 DIFF-6b 归 rules-request-batch
---
# Diffusion 共享规则（3/3）

## 关键事实

- 拆分说明：本页是源页 `rules.md` 的第 3/3 部分；第 1 部分 [[diffusion-rules-1]]；第 2 部分 [[diffusion-rules-2]]
- 源页：`knowledge/repos/vllm-omni/components/diffusion/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, diffusion；created: 2026-07-20；updated: 2026-10-09

### 质量阈值与资源辅助

- [DIFF-1x] 预拼接 image position ids 不能在 denoise 分支重复拼接
  - 触发：修改 FLUX.2-Klein 图像编辑输入准备、`latent_ids`/`image_latent_ids` 拼接或 denoising loop 的 position-id 传递。
  - 强制：若输入准备阶段已将 `image_latent_ids` 拼接进 `latent_ids`，后续 image-edit 分支必须直接复用已组装的 `latent_ids`；position-id 序列长度必须与 `torch.cat([latents, image_latents], dim=1)` 的 hidden-states 长度一致。
  - 验收：对 FLUX.2-Klein 4B 与 9B 的图像编辑 warm-up/dummy run 和完整推理分别验证 position-id 长度等于 hidden-states 长度，并覆盖 image-edit、reference-image 分支及无图像输入路径。^[PR #6130]
- [DIFF-1y] MUSA 默认兼容路径的 SwiGLU 必须保留 fused op
  - 触发：修改 `vllm_omni/diffusion/layers/activation.py` 的 `SiluAndMul` device guard、`forward_cuda`/`forward_musa` 分派，或 MUSA 的 packed SwiGLU fused op。
  - 强制：`forward_cuda` 只在 `x.device.type == "cpu"` 时回退 `forward_native`；非 CPU 输入必须保留 packed `[gate, up]` 合同并进入 fused 路径。由于默认 `forward_musa` 转发到 `forward_cuda`，已提供兼容 op 的 MUSA 路径必须能够调用 `torch.ops._C.silu_and_mul`，同时保持输出 shape、dtype 和 device。
  - 验收：CPU 测试断言 native fallback；MUSA mock/硬件测试断言 `forward_musa` 到达 fused op，并核对 packed 输入对应的输出 shape、dtype、device 和有界数值误差；另覆盖无 op 注册时的构造行为。该证据不能替代目标 MUSA 硬件上的完整模型 parity 或性能验证。^[PR #6364]
- [DIFF-3a] 质量阈值必须由完全相同的测试 case 产生
  - 触发：新增 LPIPS/PSNR/相似度阈值，或用 CPU offload 等资源选项支撑量化质量测试。
  - 强制：阈值证据与测试中的 step、seed、size、guidance、checkpoint 和量化组件完全一致；仅为避免 OOM 的 offload 必须在 baseline/candidate 对称启用并说明它不属于待比较变量。
  - 当 case 声称使用 recipe default，必须让该 request key 真正缺席（不能以空值代替），并用 capturing unit test 同时断言 prompt 和 sampling 参数都没有重新注入 override；若目标只是量化，baseline/candidate 的 eager/compile mode 也必须保持相同。
  - 验收：运行测试文件中的 exact case，并在规则/配置旁保留最短资源原因；对称 baseline 证明质量差异来自目标量化变量。低 steps smoke 只能证明 runtime compatibility，不得声称 BF16 quality parity。 ^[PR #5136] ^[PR #6279] ^[PR #5831]
- [DIFF-4m] diffusion worker spawn 前必须限制继承的线程数
  - 触发：修改 `MultiprocDiffusionExecutor._launch_workers`、worker spawn 流程或 diffusion 多进程的 OMP/Torch 线程环境。
  - 强制：在设置 multiprocessing start method 并创建 worker 进程前调用 `set_multiprocessing_worker_envs()`；未设置 `OMP_NUM_THREADS` 时沿用其线程上限策略，显式用户值必须保留。
  - 验收：在固定镜像中验证环境未设置时 worker 的 `OMP_NUM_THREADS` 与 `torch.get_num_threads()` 均为 1，并验证显式线程值仍生效；多 GPU 启动不得因每个 worker 继承全部可见 CPU 线程而产生 N 倍过量线程。^[PR #6165]
- 相关执行流见 [[diffusion-architecture]]（Diffusion architecture）；benchmark 证据合同见 [[performance-evidence-1]]、[[performance-evidence-2]]（performance evidence）。
- [DIFF-4n] 大体积广播溢出消息必须无损配对接收
  - 触发：修改 `WorkerProc` 忙循环、`MessageQueue` 广播接收或 SHM overflow marker 与 socket multipart 的配对逻辑。
  - 强制：消费 overflow marker 后必须通过 `recv_message()` 调用 `self.mq.dequeue(indefinite=True)`，等待对应的完整 socket payload 到达后才能继续接收下一条消息，并保持 FIFO 顺序。
  - 验收：单测断言接收调用使用 `indefinite=True`，并让 overflow payload 延迟超过任何有限超时后再发送 inline 消息，断言 worker 按 `overflow-1`、`inline-2` 顺序处理。当前 PR 的 0.1 秒延迟仍在旧 1 秒超时内，且 monkeypatch 的模块变量未被生产代码读取，不能单独证明旧实现会失败。^[PR #4845]
- [DIFF-4r] diffusion vLLM 配置 shim 必须覆盖内嵌组件字段
  - 触发：修改 `_DiffusionVllmModelConfig`，或在 diffusion pipeline 中初始化会读取 `current_vllm_config.model_config` 的 vLLM 内嵌模型组件。
  - 强制：配置 shim 必须覆盖真实 upstream consumer 读取的模型字段；对于 `LogitsProcessor` 等组件，`head_dtype` 必须显式存在，默认值 `None` 表示沿用模型 dtype，并在组件构造前置于当前 `VllmConfig` 上下文中。
  - 验收：在 `_DiffusionVllmModelConfig` 包装的 `VllmConfig` 下构造最小 SenseNova LLM，断言 `model.logits_processor.head_dtype is None`，并对 upstream consumer 做字段 census；真实 diffusion 初始化与非 SenseNova 路径仍须回归。^[PR #5877]
- [DIFF-6a] request-level batching 必须由结构兼容键和请求隔离共同约束
  - 触发：diffusion pipeline 宣布支持 request-level batching，或 scheduler/admission 增加模型条件、`extra_args` 结构与 request-level output split。
  - 强制：预处理必须为影响物理 batch 兼容性的 pipeline condition 写入 `batch_compatibility_key`；`RequestScheduler` 必须将显式 `sample_solver` 规范化为去空格小写、将 `flow_shift` 转为 `float`，并保留未指定值为 `None`，再与现有 batch-wide sampling key 一起决定 admission。
    - pipeline 只能批处理兼容 key 相同的请求，按 `num_outputs_per_prompt` 合并 prompt/embedding、latents、request-local generators 和条件，并拆回每个原始请求一个 `DiffusionOutput`；S2V 等 request-local metadata 不得为输出数重复物化。
  - 验收：scheduler 测试必须区分不同 `sample_solver`、`flow_shift` 和 condition key，并证明等价显式值可归一化合批；
    - Wan2.2 T2V/I2V/VACE/S2V 测试覆盖 generators、latents、prompt embeddings、output split 以及 image shape、last-image presence、VACE condition/reference count、S2V `init_first_frame`/`num_repeat`/audio time length/raw shape/sample rate 的拒绝路径。真实验证还必须分别检查同批请求的身份、prompt、条件、顺序和请求级 RNG 隔离；
    - Wan2.2 BF16 的 batch-1 与 batch-2 轨迹可能不同，未经固定精度策略和 exact case 验证不得声称 bitwise 或生产级等价。^[PR #5676]
- [DIFF-10a] regional compile 必须把 HookRegistry dispatcher 留在图外
  - 触发：修改 regional `torch.compile`、DLO/普通 layerwise offloader 的 `HookRegistry` wrapper、重复 block 编译或依赖原始 callable 的 hook（如 MagCache）。
  - 强制：发现 `submod._omni_original_forward` 时只编译该原始 compute callable；保留 `submod.forward` 作为 hook dispatcher，将 `_omni_original_forward` 重绑定到 compiled callable，并更新仍指向编译前 callable 的 hook `fn_ref.original_forward`。
  - 验收：测试断言 `torch.compile` 收到原始 callable、`forward` 仍为 wrapper、hook reference 指向 compiled callable，且 block 调用使用编译结果；DLO+regional compile smoke 还须覆盖有限输出与首次 lazy denoise 不崩溃。^[PR #6073]
- [DIFF-10b] 稀疏 video attention 必须先证明 kernel 前提，否则可观测地回退
  - 触发：新增或修改 video DiT sparse-attention backend、tile metadata、kernel custom op 或其 compile boundary。
  - 强制：backend 必须验证 CUDA、FP16/BF16、self-attention `[B,S,H,D]`、相同 Q/K/V shape/dtype、无 mask/GQA/SP、合法 softmax scale，以及 `vsa_dit_seq_shape` 与 flattened sequence 的乘积一致；block geometry 必须是 kernel 支持的 256 tokens，Top-K 不得超过 runtime block count。外部 CUDA op 以 custom-op 边界留在 `torch.compile` 图外。
  - 验收：unit 覆盖每个关键拒绝条件及 SDPA fallback，并以真实 Wan grid metadata 覆盖 tile/untile 回排。`topk == num_blocks` 的 native Wan 走 SDPA，FastVideo DMD checkpoint 可显式保留 all-block VSA；两条路由都须在日志或测试中可辨。^[PR #4820]
- [DIFF-10c] custom op 的可选 mutable 参数必须兼容 CI dispatcher
  - 触发：共享 diffusion custom op 声明可选 mutable tensor、staging buffer，或在 `adinplaceorview_impl` 的 `increment_version(args[idx])` 出现越界。
  - 强制：核对注册 schema 的默认值与 `mutates_args`。dispatcher 可裁掉等于默认值的尾部参数；若支持的 Torch mutation handler 不补齐 defaults，则将相关尾部 schema 参数设为必传，caller 显式传 `None`/开关/偏移，保留真实 mutation 声明。
  - 验收：schema 回归断言 mutable 参数无默认值；staging 关闭/开启均执行 eager 与 `fullgraph=True`。验证 tensor 内容变化不重编译时固定 host scalar 和 history phase，将空历史→满历史引发的合法 scalar specialization 与 tensor recompile 分开。 ^[PR #7648]

### [VLLM-OMNI-PR8510-MHC-FP32-MUSA] MAGI-2 mHC 收缩的 MUSA 形态必须保留 einsum 回退、误差界与 stream-major 布局

- 触发：修改 `vllm_omni/diffusion/models/magi2/layers.py` 中 `MHCHandler` 的 `apply_pre`、stream mix（`hyper_connect`）、`compute_logits`、`_stream_major_normed` 或 `__init__` 里的平台分派；或改动 mHC stream contraction 的精度、dtype 与内存布局。
- 强制：MUSA 分派只在 `MHCHandler.__init__` 判定一次（`fp32_stream_contractions`）。仅 MUSA 上 `apply_pre` 与编译态 stream mix 使用 FP32 逐元素乘加，`apply_pre` 输出保持流的输入 dtype；
  - `compute_logits` 按流拆 K 为分批 matmul（`bmm`）加求和，其 dtype 跟随操作数：`_stream_major_normed` 把归一输出 cast 到 `self.dtype`，`bmm` 使用的 `phi_fused` 不做额外 FP32 cast，因此只有这些操作数本身是 FP32 时该 matmul 才是 FP32，不得写成无条件 FP32 matmul。FP32 逐元素形态只接受 exact-shaped `[T, N]` 系数、流 dtype（fp32/bf16/fp16）且不在 autocast 中；
  - 该准入不含流数条件，exact-shaped `[T, 1]` 单流系数同样满足 FP32 分支。broadcast 系数、float64、mixed-dtype、autocast、额外 rank 输入必须继续走 einsum 路径并保留其原有错误（mixed-dtype/额外 rank 抛 RuntimeError）。非 MUSA 平台必须与 einsum/matmul 形式逐位一致（rtol=0、atol=0）；
  - 共享层 `vllm_omni/diffusion/layers/mhc.py` 不得为此改动，eager MUSA 的 mix 仍走 #7261 的 Triton kernel。
- 强制：编译态下 `_stream_major_normed` 在 `[tokens, streams, hidden]` 视图上做 norm，并以 `as_strided` 钉住 stream-major buffer 的 strides，让 fused norm kernel 自己写出稠密 `[streams, tokens, hidden]` 布局、`bmm` 原地读取；
  - 数值型 compile 测试必须钉住 Inductor 确定性（`torch._inductor.config.deterministic` 与 `test_configs.force_filter_reduction_configs`），否则每次编译 benchmark reduction config 会改变位数。
- 验收：CPU 测试 monkeypatch `current_omni_platform.is_musa` 构造两种形态：非 MUSA 三种流 dtype 下 `apply_pre` 与 einsum、`compute_logits` 与 `flattened @ phi` 参考逐位一致；`is_compiling()` 下 MUSA 的 mix 走 `_mhc_mix_fp32`、其他平台走 `forward_native`；
  - MUSA `apply_pre` 对 FP64 参考满足“一次输出舍入 + 2×项数×2^-24×幅值 + tiny”的界，且与先 round 再求和的结果不逐位相等；broadcast/float64 保持 einsum 数值，单流结果与 einsum 完全一致（仅数值断言，不断言分支），mixed-dtype/额外 rank 仍抛 RuntimeError；`_mhc_mix_fp32` 保留 float64；`compute_logits` 在 FP32 操作数下按流拆 K 并满足同类 FP64 误差界。
  - CPU+monkeypatch 只证明形态与误差界，不构成真实 MUSA 硬件上的性能或 parity 证据。^[PR #8510]

## 决策与踩坑

- [DIFF-1x] 禁止：在 denoising loop 再次执行 `torch.cat([latent_ids, image_latent_ids], dim=1)`，或仅凭张量可构造而忽略 image block 被重复计数导致的 shape mismatch。
- [DIFF-1y] 禁止：使用 `x.device.type != "cuda"` 排除 MUSA；把通用 vLLM `SiluAndMul` 当作 diffusion 本地合同；或在 MUSA 构造阶段无条件 eager 解析可能不存在的 fused op。
- [DIFF-3a] 禁止：用 50-step A/B 数字为 10-step 测试阈值背书；只写“需要 offload”而不说明是资源前提还是功能行为。
- [DIFF-4m] 禁止：worker 已 spawn 后才设置线程环境；覆盖用户显式的 `OMP_NUM_THREADS`；把默认线程值 1 宣称为所有 diffusion host-side work 的最优值。
- [DIFF-4n] 禁止：对已消费 marker 的 multipart 使用有限超时；超时后重新 `dequeue` 并把后续 marker 或 inline 消息与迟到 payload 配对；仅把有限超时调大作为修复。
- [DIFF-4r] 禁止：依赖 `SimpleNamespace` 或缺失属性后捕获 `AttributeError` 继续；只为单个模型补字段却不检查共享 diffusion 配置 shim 的其他内嵌 vLLM consumer；把一次初始化成功描述成跨平台兼容。
- [DIFF-6a] 禁止：只按原始 `extra_args`、第一条请求或 pipeline 名称决定兼容性；把不兼容的 image/last-image、VACE 或 S2V 条件混入同一 batch；共享全局 RNG；返回无法按请求对应的聚合输出；把请求隔离和 output split 误当成不同物理 batch shape 的数值等价。
- [DIFF-10a] 禁止：把 `HookRegistry` dispatcher 或其 stream/event/storage/offload 控制流编译进 regional graph；直接覆盖 `forward`；让 hook 保留过期的 eager callable。
- [DIFF-10b] 禁止：仅凭选择了 backend 就声称走稀疏 kernel；从 flat sequence 猜三维 grid；在不支持时静默改变 shape、dtype 或 attention 语义。
- [DIFF-10c] 禁止：以 Python caller 已显式传参证明 dispatcher 参数完整；移除 mutation 声明绕过错误；用已补齐 defaults 的新 Torch 本地成功替代失败 CI 版本的兼容证据。
- [VLLM-OMNI-PR8510-MHC-FP32-MUSA] 禁止：把 MUSA 形态做成唯一路径或改变非 MUSA 数值；把 `compute_logits` 声称或审成无条件 FP32 matmul——其 dtype 由 `self.dtype` 的归一输出与未 cast 的 `phi_fused` 决定；eager 中先把乘积 round 到流 dtype 再求和（乘积必须在 FP32 中形成）；吞掉 einsum 路径对非法输入的报错；给 FP32 分支加入流数排除，或声称/要求单流输入走 einsum 路径——单流只受数值约束，测试不断言其走了哪条分支；
  - 用裸 `.contiguous()` 声称已消除 Inductor 下的拷贝（clone 会融合进 reduction 并保持 token-major 布局）；声称端到端 bitwise 一致——生成结果相对 einsum 形态确有差异（视频 PSNR 24.9 dB、音频 37.4 dB），幅度与无关的 SP4xCFG2→SP8xCFG1 切换（24.0 dB、38.0 dB）相当，只能按此格式论证差异可接受。
