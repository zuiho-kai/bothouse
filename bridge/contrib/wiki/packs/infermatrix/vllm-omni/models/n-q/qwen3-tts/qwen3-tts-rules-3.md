---
name: qwen3-tts-rules-3
description: "Qwen3-TTS 规则（三）：Q3TTS-4a silence codec ban 按 checkpoint 词表与 x-vector-only 生效（PR #5048）、4b Base codec token exhaustion 丢弃不完整音频（PR #6728）、5a 共享 code predictor 的 FP32 fallback 排除 NPU（PR #6639），以及 VLLM-OMNI-PR8837-HUB-SNAPSHOT、PR8674-Q3TTS-MRV2-GATES、PR9320-ROCM-SELECT-PREFLIGHT"
metadata:
  scope: 只收 Q3TTS-4a、4b、5a 与三条 VLLM-OMNI-PR 规则；Q3TTS-1a 至 2a 归 qwen3-tts-rules-1，Q3TTS-3a 至 3e 归 qwen3-tts-rules-2
---
# Qwen3-TTS 规则（3/3）

## 关键事实

- 拆分说明：本页是源页 `rules.md` 的第 3/3 部分；第 1 部分 [[qwen3-tts-rules-1]]；第 2 部分 [[qwen3-tts-rules-2]]
- 源页：`knowledge/repos/vllm-omni/models/qwen3-tts/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, serving, qwen-omni；created: 2026-07-20；updated: 2026-10-24
- [Q3TTS-4a] silence codec ban 必须按 checkpoint 词表和 x-vector-only mode 生效
  - 触发：修改 Qwen3-TTS Base voice-clone 的 leading silence 行为、`silence_ban_frames`、talker codec mask 或 x-vector/ICL mode resolution。
  - 强制：默认 `silence_ban_frames=0`；加载 checkpoint 后通过 `_encode_ref_audio_batch` 编码多种静音样本并只收集 codebook-0 ids，词表为空、越界或明显过大时记录 warning、清空启用值并禁用功能。decode 时只对 Base 的 x-vector-only request 在前 N 个 history steps 屏蔽派生 ids；mode resolution 必须与 prompt builder 一致，`voice_clone_prompt.icl_mode` 覆盖和未记录 mode 都要正确处理。
  - 验收：覆盖默认关闭、有效派生、空/越界/ oversized 派生和 encoder failure；覆盖 step 边界、mixed x-vector/ICL batch、ICL 与非目标请求保持未修改，以及实际 stage 配置能到达 talker。^[PR #5048]
- [Q3TTS-4b] Base codec token exhaustion 必须丢弃不完整音频
  - 触发：修改 Qwen3-TTS Base 的 codec token budget、Stage-0 finish metadata、speech generation validation、非流式 retry 或 streaming terminal/error 语义。
  - 强制：caller 未显式给 `max_new_tokens`、task 为 Base 且 text token count>0 时，自动上限为 `min(configured_cap, max(192, 12*text_tokens))`（无 configured cap 时取 dynamic cap）；tokenizer 不可用或计数失败时保留 configured cap，非 Base 也不套 text-scaled ceiling。
    - 无论上限来自 caller、config 或动态计算，只在 request metadata 记录了 effective cap、task 为 Base 且 Stage 0 实际 `finish_reason="length"` 时判为 budget exhaustion；不能从 token 数接近上限自行猜测。
  - 强制：exhausted generation 的音频不完整，non-streaming 只能在 caller 同时未指定 seed 与 `max_new_tokens` 时，用新 request id 和 fresh seed 重试恰好一次；不得修改原 request。raw audio、SSE 与 WebSocket 等 streaming 路径不重试：若已经发出 delta，terminal error 必须标记 `partial_audio=true, action=discard`，且不得发 success/done；错误发生在首个 audio 前则不伪造 partial。
  - 验收：覆盖 short/long text、configured cap、显式 max、token-count failure 与非 Base；分别验证 EOS/非 length 正常通过、length+recorded-cap 拒绝、非流式一次 retry 及显式 seed/max 不 retry；raw/SSE/WebSocket 均携带 terminal metrics，并覆盖 partial/no-partial error。目标回归证明控制流和丢弃语义，不证明任意 prompt 必达 EOS、音频质量或最佳 cap 比例。^[PR #6728]
    - Ready CI 的 dummy-weight Base 即使到 192 tokens 仍可无 EOS 并返回 500，因而不是该 guard 的 Ready oracle；此事实不改变 runtime、YAML、EOS 或音质合同，也没有 real-weight merge pass log。^[PR #6861] ^[issue #6855]
- [Q3TTS-5a] 共享 code predictor 的 FP32 fallback 排除 NPU，且禁止外层 capture 时重放内层图
  - 触发：修改 `qwen3_code_predictor` 的 FP16→FP32 stability fallback、NPUGraph/`_device_graphs` replay，或 Qwen3-TTS/Qwen3-Omni Talker 在 `enforce_eager=False` 下的外层 `talker_mtp` capture。
  - 强制：`use_fp32` 仅当 `input_dtype == float16` 且 `device.type not in ("cpu", "npu")`；CUDA/XPU/MUSA 等其它 accelerator 保留既有 FP32 upcast。Ascend fused RMSNorm 要求 activation 与 weight dtype 一致，不得在 NPU 上形成 FP32 activation + FP16 gamma。
  - 强制：每个 forward 采样一次 `is_npu_capturing = current_omni_platform.is_npu() and torch.npu.is_current_stream_capturing()`；存在 device graph 时，仅当**未**在外层 NPU capture 中才 `replay()`，capture 期间走普通/`compiled` forward 让外层图录制。无外层 capture 时仍使用内层 replay 快路径。
  - 验收：参数化断言 cpu/npu 不 upcast、cuda/xpu/musa upcast；`is_capturing` true/false 分别断言 skip/do replay。该合同属于共享 predictor，不证明每个 Qwen3 stage 已全图安全。^[PR #6639]
- [VLLM-OMNI-PR8837-HUB-SNAPSHOT] 引擎初始化前先把 Hub repo ID 解析成单一本地 snapshot
  - 触发：修改 Qwen3-TTS e2e 测试（如 `tests/e2e/features/prefill_phase/test_chunked_prefill_tail.py`）中把 Hugging Face repo ID 同时交给 tokenizer/config 加载与多次 engine 构建的代码。
  - 强制：进入 tokenizer/config/engine 加载前，若路径不是本地目录，先用 `vllm_omni.transformers_utils.repo_utils.hf_api().snapshot_download(repo_id=...)` 解析一次，并把返回的 snapshot 路径复用于后续全部加载与每一次 engine run；`MODEL_PREFIX` 指向的既有本地目录必须继续零下载直通。
  - 验收：本地目录输入不触发下载；Hub ID 只解析一次，tokenizer/config 与每次 engine run 均复用同一 snapshot 路径，engine 初始化阶段不再有重复的远端 metadata 查询（消除 Build 17081 那类每次 init 重复请求 repository-tree API 而撞 429 的模式）；chunked/unchunked 音频不变量断言原样保留。仅有的一次 snapshot 下载仍可能因 Hub/网络错误而失败，这是已知残余依赖，不得宣称修复后对 Hub 故障免疫，也不得把该残余失败判为回归。^[PR #8837]
- [VLLM-OMNI-PR8674-Q3TTS-MRV2-GATES] Qwen3-TTS fused MRv2 各优化路径的已验证 gate 与 stock 回退
  - 触发：修改 Qwen3-TTS 高并发 fused 单 stage（`qwen3_tts_fused_single_gpu.yaml`）的 CUDA MRv2 优化路径：Talker sampler 注册、PDL code prediction、projected text embedding table、codec graph 输入直写与 staged writes、EagerMTPState 与 preemption replay。本规则逐项固定 PR #8674 已验证的启用条件与回退行为，不外推为「每项新增优化都必须有能力 gate」的通用要求。
  - 强制：fused Talker sampler 仅在平台与实际 processor list（含 plugin logits processor）受支持时注册；禁用/不受支持时返回 None，保留 stock sampler、rejection sampling 与 watermark 设置及立即写排序。PDL code prediction 的启用由设备类型、GPU capability 与 Triton 支持共同判定，用于受支持的 NVIDIA（Hopper 及以上）batch ≤64；
    - 容量大于 64 的 predictor 必须保留 cuBLAS 权重并在 batch >64 时选择 cuBLAS（H100 测试以一个 max128 predictor 覆盖 B64/B65/B128）。约 0.6 GB 的 projected text embedding table 只在 single-stage fused、NVIDIA 的 V2 streaming prefill 路径于 KV profiling 前构建，V1、two-stage 与非 NVIDIA 部署不得分配。
    - reference/speaker encoder 精度与默认 attention backend 保持 upstream（reference encoding 走主 BF16 路径）；codec 词表 mask 在共享 `compute_logits` 中对 sampling 与 prompt logprobs 都保留。一帧 codes 直写选中的 codec graph 输入（含 slot/position/padding），PCM readers 完成前必须 fence；reference priming 因需重放同一 graph 保留 copy 路径。
    - EagerMTPState 保存真实 conditioned Talker embeddings 以支持 preemption replay；空 staging 不占用 ring slot。
  - 验收：gating 测试覆盖启用与 unsupported-platform fallback 两个分支（如 projected-table GPU test）；sampler 注册/回退与 processor gating（含 plugin）；PDL 在 B64/B65/B128 边界的路径选择；codec mask 对 sampling 与 prompt logprobs 均保持；staged write 的 scoped context 选择与 PCM reader fence；
    - 部署 YAML 为 per-request conditioned embeddings 预留 headroom 并与 `docs/design/qwen3_omni_tts_performance_optimization.md` 的 serving boundaries 同步。^[PR #8674]
- [VLLM-OMNI-PR9320-ROCM-SELECT-PREFLIGHT] AMD CI GPU lane 必须用显式 ROCm 选择器并预检精确收集数
  - 触发：修改 `.buildkite/amd/test-amd-ready.yml` / `test-amd-merge.yml` 的 GPU lane pytest 选择器、`.buildkite/amd/scripts/assert-pytest-collection.sh`、`tests/buildkite/` 的 lane 断言，或测试文件上的 `rocm`/`cuda`/`nvidia_only`/`MI325`/`cards_N` 平台标记与 `tests/helpers/tests/test_check_test_marks.py` 的静态标记检查。
  - 强制：AMD READY/MERGE GPU lane 用显式 `rocm and MI325 [and cards_N] and not nvidia_only` 表达式选择测试，不用裸 `cuda`；原有 card-count 排除（如 one-GPU lane 的 `not (cards_2 or … or cards_8)`）随迁移保留。
    - `rocm` 标记只加到有 AMD 运行证据的 variant，且保留全部既有 CUDA 资格：共享 CPU 测试保持 CPU-only（R2-01 因此移除 3 个 CPU-only OmniVoice 测试），Qwen3-TTS MRV2 variant 保持 CUDA-only，#9171 的 Wan CUDA/L4 sentinel 不变。
    - 每条迁移 lane 在启动 GPU 负载前先以同一组 pytest 参数运行 `assert-pytest-collection.sh EXPECTED_COUNT`，断言**精确且非零**的收集数（Diffusion 117、R2-01 1,400、R2-02 3、Diffusion LoRA 1、Wan22 offline 2 / online 1、Qwen3-Omni 16、Qwen3-TTS Base 3）；
    - 预期计数变化必须用 manifest diff 逐项说明——build #14536 的首个精确计数守卫曾在 GPU 执行前暴露 1,399 的临时值，diff 定位到唯一一个有意新增项。AMD lane 以 `rocm` 为准，不引入单独的 `amd` marker；该 PR 不改 GitHub ruleset。
  - 验收：迁移 lane 的 YAML 同时携带预检命令与同参数的 pytest 命令；`tests/buildkite/test_amd_pipeline.py` 与 `tests/buildkite/test_amd_ready_r2_01.py` 锁定迁移后的选择器与收集数；静态检查断言 rocm+nvidia_only 的有效组合（含参数化叠加）被拒。边界保持：Qwen3-TTS Base lane 恰好收集 3 个非 MRV2 variant 且 MRV2 不被 `rocm` 选择器收集；
    - Qwen3-Omni lane 新纳入的 7 个 variant 必须在 current-head AMD CI 上真实通过，不得只凭选择器变更即宣称已覆盖。^[PR #9320]

## 决策与踩坑

- [Q3TTS-4a] 禁止：硬编码当前 checkpoint 的 12 个 token、把 mask 施加到 ICL 或非 Base 请求、对不可信派生词表只做部分 masking，或把经验值 `N=3` 当成跨 checkpoint 的固定最优参数。
- [Q3TTS-4b] 禁止：把长度终止的 Base 音频当成功结果；用 fresh seed 覆盖显式可复现请求；在 streaming 中隐式重放造成重复音频；把该 guard 外推到所有 TTS adapter 或声称 dynamic cap 保证 EOS。
- [Q3TTS-5a] 禁止：把“非 CPU 即 FP32”重新扩到 NPU；在外层 capture 中嵌套 replay 内层 NPUGraph；或仅靠 stage 级 `PIECEWISE` workaround 声称已修复嵌套 replay 根因。
- [VLLM-OMNI-PR8837-HUB-SNAPSHOT] 禁止：让每次 engine init 都用 repo ID 重复查询远端 metadata——共享 CI token 会撞 repository-tree API 的 HTTP 429，使测试在 engine 初始化阶段失败；也不得借稳定化之名删除既有 audio/prefill 断言。首次 snapshot 下载本身仍可能遇 Hub/网络错误，不得声称该测试对 Hub 故障免疫。
- [VLLM-OMNI-PR8674-Q3TTS-MRV2-GATES] 禁止：在不受支持的 sampler/processor 组合下安装 fused sampler 或改变立即写排序；
  - 把 Hopper 条件扩大到 sampler 或 table，或在任一路径自身条件之外启用它——三条路径的门槛各自独立：PDL 要求 NVIDIA Hopper 或更新且 batch ≤64（更大 batch 走 cuBLAS），projected table 仅限 single-stage fused、NVIDIA、V2 streaming prefill 且在 KV profiling 前构建，sampler 按平台与实际 processor list（含 plugin）判定；
  - 在共享 GPU 测试中只断言 NVIDIA-only 行为而不覆盖 unsupported-platform fallback 分支；PCM readers 完成前复用直写的 codec graph 输入；未保存真实 conditioned embeddings 却宣称支持 preemption replay；改变 reference/speaker encoder 精度或默认 attention backend。
- [VLLM-OMNI-PR9320-ROCM-SELECT-PREFLIGHT] 禁止：把 AMD GPU lane 回退到裸 `cuda` 选择器（会静默收集 NVIDIA-only variant 或丢失 ROCm 覆盖，绿灯不再有意义）；给没有 AMD 证据的 variant 加 `rocm`；删除或放宽收集数预检、把精确相等断言改成下界或 0 来掩盖 marker drift；为凑计数删测试或改 run-level；引入第二套平台 marker（如 `amd`）。
  - 静态合同：任一有效 test item 不得同时带 `rocm` 与 `nvidia_only`，包括 class-level 标记与 stacked function parametrization 叠加出的组合。
