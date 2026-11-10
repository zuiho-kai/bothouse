---
name: bagel-architecture
description: BAGEL 架构（main @ 5d44868e）：专有 AR 侧（继承上游 BagelForConditionalGeneration 并安装 MoT 生成分支权重以产出位级兼容 KV）与 DiT 侧的边界、三个冻结 PipelineConfig 的差异、两 stage 变体的主流程（expand_cfg_prompts 把 3 路 CFG 做成伴随 AR 请求、position id 重写、NaiveCache 重建 KV）、image step execution 与 wave 边界（#7049 恢复 N 个 schedule points / N-1 次 Euler update）、验证入口与已知未决
metadata:
  scope: 只收 BAGEL 的数据流、KV / CFG 合同和 step wave 边界说明；入口与变体速览归 bagel-overview，可执行验收合同归 bagel-rules
---
# BAGEL 架构

## 现状

- 事实在 `main @ 5d44868e` 复核;行号随源码漂移,改代码前以当前版本为准。本页只写数据流与合同,入口/变体速览见 [[bagel-overview]]（BAGEL index）;多 stage 共卡显存预算见 [[configuration-rules-1]]、[[configuration-rules-2]]、[[configuration-rules-3]]（Config 规则 CONF-1a）。

### 模型专有部分与共享模块的边界

- 专有 AR 侧（`model_executor/models/bagel/`）：`OmniBagelForConditionalGeneration` **继承上游 vLLM 的 `BagelForConditionalGeneration`**,加 VAE 编码器、`vae2llm`、时间嵌入,并给每个 decoder 层安装 MoT 生成分支权重（`_install_mot_modules`：`qkv_proj_moe_gen` 等）——目的是让 AR stage 产出与单 stage DiT **位级兼容的 KV**。
- 专有 DiT 侧（`diffusion/models/bagel/`）：`pipeline_bagel.py`（`BagelPipeline`, 自带 Qwen2-MoT LLM/SigLIP-NaViT/tokenizer）、`bagel_transformer.py`（移植核,`NaiveCache`/`PackedAttentionMoT`/`Bagel`）、`autoencoder.py`（FLUX 风格 `DistributedAutoEncoder`）。
- 共享依赖：`CFGParallelMixin`、VAE patch-parallel、[[diffusion-overview]]（Diffusion 组件）;连接器 SharedMemory（阈值 65,536 字节）/ Mooncake RDMA。

### 配置、checkpoint 和兼容范围

- 三形态差异（`bagel/pipeline.py` 三个冻结 `PipelineConfig`）：
  - `bagel`：thinker（LLM_AR,`final_output=True` 文本,KV `need_send_cache`, **prefill 完即传**）→ dit（DIFFUSION,`input_sources=(0,)`, `need_recv_cache`,`final_output=True` 图像）——两 stage 都是 final output(文本+图像双交付)。
  - `bagel_think`：同拓扑,但 companions 用 `expand_cfg_prompts_think`（`max_tokens=1`）且 **omni_kv_config 去掉 `kv_transfer_criteria`**——KV 在 EOS 后才传,给 `<think>` 解码留时间。
  - `bagel_single_stage`：单 DIFFUSION stage,仅图像输出;`model_arch` 是 HF 名 `BagelForConditionalGeneration`,按源码推断经 `resolve_model_class_name` 从 checkpoint config 解析到 `BagelPipeline`（自足:t2i/i2i/i2t/t2t/think）——该解析链未 live 验证。
- 去噪不用 diffusers scheduler（`self.scheduler=None`,timestep-shift flow, 默认 `num_timesteps=50, shift=3.0, cfg_text 4.0 / cfg_img 1.5`）。

### 从输入到输出的主要流程

- 以下 2–4 步描述**两 stage 变体**（`bagel`/`bagel_think`,think 变体的差异仅在 companions 用 `expand_cfg_prompts_think` 且 KV 延后到 EOS）; `bagel_single_stage` 不走 CFG 伴随请求与 KV 传输,理解+生成全在 `BagelPipeline` 内部完成。
1. `model_extras/bagel.py` 的 prompt builder 组 `<|im_start|>…` / `<|fim_middle|>`（i2i）请求。
2. `stage_input_processors/bagel.py::expand_cfg_prompts`：3 路 CFG（gen/cfg_text/cfg_img）实现为**伴随 AR 请求**（`__cfg_text`/`__cfg_img` 后缀）。t2i：只建一个 cfg_text 伴随（无负向 prompt 时整个跳过）,cfg_img 复用 gen KV;i2i：cfg_text（`<|fim_middle|>`+负向,保留图像）与 cfg_img（去 `<|fim_middle|>`,丢图像）两个伴随都建。
3. thinker 前传;img2img 时 VAE-latent token 走 `*_moe_gen` 复权重路径,并重写 position id（VAE token 与分隔符都在 M、ViT token 在 M+1、后续文本 M+2…）——**必须与单 stage DiT 的 rope 方案一致,否则传过去的 KV 不可用**。
4. DiT stage 用 `NaiveCache.from_object` 重建主 KV,`collect_cfg_kv_caches` 收伴随 KV;`Bagel.generate_image` 去噪;可选轨迹记录（`return_trajectory_latents`,RL 用）→ PIL Image。
- 顺序 CFG 把各分支 query/cache 合并为一次 LLM forward 时，position ID 的拼接轴取决于表示秩：BAGEL 标量 RoPE 的 `(S,)` 沿 dim 0 拼；Lance mRoPE 的 `(3,S)` 沿 dim 1 拼。可执行验收见 [[bagel-rules]]（BAGEL 规则 BAGEL-1）。
- RNG 陷阱：`_regen_init_noise_on_device` 按请求在 CUDA 上重播 init noise（对齐 Lance 噪声流）;`forward` 单 prompt（多了只取第一个并告警）;分辨率超 `max_latent_size × latent_downsample` 直接 raise。

### Image step execution 与 wave 边界

- `prepare_encode` 为单 image request 留下 request-local state，`denoise_step` 可以将兼容 state pack 为一次 DiT forward，`step_scheduler` 推进各自进度，`post_decode` 逐 request 产出。有效 img2img geometry 必须在 admission 前从输入图像解析；只有 geometry 与 BAGEL CFG/renormalization 设置一致的请求可共用 wave。
  - packing 后 CFG3 的分支 KV、token index、scheduler state 和可选 trajectory 仍须逐 request 还原，不能把波内状态当成一个逻辑 request。
- `bagel`/`bagel_think` 仅 diffusion Stage 1 接入该 lifecycle，AR Thinker 不变；`bagel_single_stage` 的 image request 可接入，而显式 text2text/img2text 保持完整 `forward()`。Step mode 拒绝 SP 与 diffusion cache backend。完成/abort step request 后，runner 须先清掉 state 和 paged diffusion-KV，才可切换到完整 text fallback。
  - 详细可执行合同见 [[bagel-rules]]（BAGEL-3；源锚点 #bagel-3step-image-wave-必须保持请求局部状态与兼容边界）。
- 不要从 #6359 的历史文档继承 denoise count 或 benchmark 结论：#7049 已恢复 BAGEL 的 `N` schedule points / `N - 1` Euler update 约定，并拒绝 `N < 2` 的 image request。

### 怎样验证功能、精度和性能

- 单元：`tests/diffusion/models/bagel/`（`test_naive_cache`、`test_combine_cfg`、`test_bagel_lora`、`test_trajectory_recording`）; 连接器：`tests/distributed/omni_connectors/test_bagel_*_connector.py`。
- e2e：`tests/e2e/{offline_inference,online_serving}/test_bagel*.py`（含 expansion 与 multi_replicas）;perf 定义 `tests/dfx/perf/tests/test_bagel_vllm_omni.json`;recipe `recipes/Bagel/BAGEL-7B-MoT.md`。
- 已知未决：`GEN_THINK_SYSTEM_PROMPT`/`VLM_THINK_SYSTEM_PROMPT` 在 pin 上无引用（疑似死代码）;single_stage 的 arch→类解析链未 live 验证。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/bagel/architecture.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: vllm-omni, models, diffusion；created: 2026-07-21；updated: 2026-09-05
- 来源（sources）：PR #6359；PR #7049；vllm_omni/model_executor/models/bagel/bagel.py；vllm_omni/diffusion/models/bagel/bagel_transformer.py；vllm_omni/diffusion/models/bagel/pipeline_bagel.py；vllm_omni/model_executor/stage_input_processors/bagel.py
