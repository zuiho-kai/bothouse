---
name: configuration-rules-2
description: vLLM-Omni 配置开发门禁（2/3）：部署配置与资源预算前半，VOMNI-CFG-1j 至 1o（mamba_ssm_cache_dtype、attention_config、upstream 配置复用、silence_ban_frames、distributed_executor_backend、sampling_constraints）与 CONF-1a、CONF-2a、CONF-2b、CONF-2c（共卡 gpu_memory_utilization、kv_cache_memory_bytes pin、paged_scheduler KV sizing 与行上限）
metadata:
  scope: 只收 typed projection 类规则 VOMNI-CFG-1j 至 1o 与显存、KV 预算规则 CONF-1a 至 CONF-2c；入口表与 VOMNI-CFG-1a 至 1i 归 configuration-rules-1，CONF-3a 起的 deploy 解析、导入链与环境变量规则归 configuration-rules-3，CUDA graph 显存预留归 rules-cudagraph-kv-reserve
---
# vLLM-Omni 配置开发门禁（2/3）

## 关键事实

- 拆分说明：本页是源页 `rules.md` 的第 2/3 部分；第 1 部分 [[configuration-rules-1]]；第 3 部分 [[configuration-rules-3]]
- 源页：`knowledge/repos/vllm-omni/components/configuration/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, config；created: 2026-07-16；updated: 2026-10-09

### 部署配置与资源预算

- 只有 `CONF-数字字母` 是本节可审计规则 ID。
- [VOMNI-CFG-1j] hybrid-Mamba stage 的 SSM cache dtype 必须贯穿 typed projection
  - 触发：hybrid-Mamba stage 新增 SSM cache dtype，或同一模型提供普通与 async-chunk deploy 配置。
  - 强制：把 `mamba_ssm_cache_dtype` 同时声明在 typed shared/stage config 与最终 deploy stage，并投影到 vLLM `CacheConfig`；模型 `dtype` 与 SSM state dtype 分开验收，Nemotron thinker 默认保持 `float32`。
  - 验收：从 deploy/structured/legacy 入口读取非默认值，断言 sync 与 async thinker 的最终 stage config 和 vLLM cache consumer 均得到 `mamba_ssm_cache_dtype=float32`，并覆盖 bf16 模型、fp32 SSM state 的组合。^[PR #5842]
- [VOMNI-CFG-1k] 模型专用 attention 子配置必须贯穿 deploy 与 typed projection
  - 触发：模型 deploy profile 需要通过 vLLM 顶层 attention backend 下的 `attention_config` 控制具体 decode kernel，或新增该嵌套字段并要求 structured、legacy、typed 路径保持一致。
  - 强制：将 `attention_config` 纳入 `_ModelEngineOverrides` 与 `OmniStageModelConfig`，确保它从 deploy profile 投影到最终 stage engine args。Higgs CUDA profiles 的 Stage 0 保持 `FLASHINFER` 与 `use_trtllm_attention: false`；ROCm overlay 只将 Higgs V3 Stage 0 设为 `TRITON_ATTN`，Stage 1 保持不变。
  - 验收：配置 schema、structured/legacy projection 测试均能读回 `{"use_trtllm_attention": false}`；解析 Higgs CUDA profiles 及 ROCm V3 overlay，断言仅相应 Stage 0 backend 改动。ROCm collection/test evidence 不构成其它 stage、硬件、音质或性能声明。 ^[PR #6068] ^[PR #6422]
- [VOMNI-CFG-1l] upstream 配置复用必须保持 structured 边界与生命周期安全
  - 触发：修改 `VllmOmniConfig` 的 structured stage config、复用 upstream `LoadConfig`/`CacheConfig`/`SchedulerConfig`/`ParallelConfig`，或新增 `CompilationConfig`、`ProfilerConfig` 等 upstream value object 字段。
  - 强制：只有语义、配置归属、生命周期和 EngineArgs projection 均一致时才复用 upstream contract；继承的公开 structured config 必须 keyword-only，`stage.compilation_config` 与 `stage.profiler_config` 使用具体 upstream 类型并在构造期物化 mapping；保留 Omni 自有字段、延迟的 model/platform/rank/port/backend 初始化和显式 projection 边界。
  - 验收：覆盖 keyword-only 签名与 positional rejection、mapping 到具体 upstream object、预构造 object 的类型保留、scheduler/parallel 传输安全 derived fields 及 msgpack/asdict registration；用非默认字段证明最终 EngineArgs projection，且默认值不泄漏、未归属字段明确失败，legacy 与 structured 结果保持一致。 ^[PR #6050]
- [VOMNI-CFG-1m] 模型专用 stage 开关必须经 typed projection 且默认关闭
  - 触发：为某一模型新增控制推理行为的 stage/deploy 字段，并让 deploy、CLI、structured 或 direct factory 可设置。
  - 强制：把字段放在 `StageDeployConfig`、`OmniEngineArgs`、`OmniModelConfig`/`OmniStageModelConfig` 与 `_ModelEngineOverrides` 的同一 canonical projection；默认关闭（本例 `silence_ban_frames=0`），从最终 stage config 传到唯一模型 consumer，并同步更新 structured/legacy known-field inventory。
  - 验收：用 direct、structured、legacy 入口的非默认值追到最终 stage config 和真实模型 consumer；断言默认值保持关闭、其他模型不产生副作用，并覆盖字段集合与 projection parity。^[PR #5048]
- [VOMNI-CFG-1n] diffusion backend 的 omitted 语义必须留给运行时解析
  - 触发：修改 `distributed_executor_backend` 的默认值、配置 projection、Async stage 参数透传或 diffusion executor 选择逻辑。
  - 强制：省略值必须以 `None` 贯穿 `OmniDiffusionConfig`、`_DiffusionConfigProjection` 和 async stage config，由 `DiffusionExecutor.get_class()` 按 `num_gpus` 解析为单 GPU 的 `uni`、多 GPU 的 `mp`；显式 `mp` 或 `uni` 必须保持调用方选择。
  - 验收：direct、structured 和 async 路径均断言 omitted 值在最终 stage config 仍为 `None`；覆盖单 GPU→`UniProcDiffusionExecutor`、多 GPU→`MultiprocDiffusionExecutor`、显式 `mp` 和显式 `uni`，并确认已 pin `mp` 的 deploy 配置不变。 ^[PR #6308]
- [VOMNI-CFG-1o] pipeline sampling constraints 必须穿过 stage runtime 配置
  - 触发：新增或修改 pipeline 的 `sampling_constraints`、`StageConfig` 字段、deploy 合并或 dataclass→OmegaConf runtime 转换。
  - 强制：每个 stage 的 resolved `sampling_constraints` 必须从 `merge_pipeline_deploy()` 复制到 `StageConfig`，并由 `to_omegaconf()` 导出为可在 `engine.stage_configs` 读取的原生 mapping；不得与默认 sampling params 混为唯一保存位置。
  - 验收：从 pipeline/deploy 合并走到 `StageConfig.to_omegaconf()` 和 runtime extraction，断言每 stage 的非默认 constraint 可读回；再由 serving 侧验证它到最终 sampling consumer 的效果。^[PR #6182]
- [CONF-1a] 多 stage 共卡时 diffusion stage 必须显式设 gpu_memory_utilization
  - 触发：多 stage 模型 stage 共卡时，分布式测试在模型加载期 CUDA OOM。
  - 强制：检查并为所有 stage 显式设置最终展开后的显存预算；diffusion stage 内部可能同时加载 diffusion 模型与 LLM，不能沿用单 stage 默认比例。
  - 验收：源模板和生成配置一致，逐 stage 展开值之和不超过卡容量，并运行对应共享显存 connector 测试。
- [CONF-2a] 小显存机型对 KV 外分配模型 pin kv_cache_memory_bytes，不搞比例棘轮
  - 触发：小显存 GPU 上 prefill 完成、decode 静默后被 OOM/信号终止，且模型在 vLLM KV-cache 记账之外还有 solver、VAE 或 diffusion 分配。
  - 强制：先按 `max_num_seqs × max_model_len` 计算并固定 `kv_cache_memory_bytes`，再把剩余显存留给 KV 外路径；若仍 OOM，依次核对 pin 是否被 rebase 丢失、权重/激活基线、`max_num_seqs`、batched VAE 与 KV pin。
  - 验收：记录 pin、并发、长度与峰值，真实 decode 路径完成；任何吞吐交换都单独测量。
- [CONF-2b] paged_scheduler 的 KV sizing 字段必须归一化并保持 dense_legacy 惰性
  - 触发：为 diffusion stage 增加或修改 `kv_cache_memory_bytes`、`gpu_memory_utilization`、`max_num_batched_tokens`、`max_model_len`，或改变 `dense_legacy` 与 `paged_scheduler` 的配置投影。
  - 强制：这些字段必须经同一 diffusion owner 归一化；只有 `paged_scheduler` 才能传入 native `VllmConfig` 的 cache/scheduler 配置。正值 `kv_cache_memory_bytes` 固定 KV 预算，`None` 或 `0` 使用自动 sizing；`max_model_len=-1` 必须保留 native auto-fit sentinel，同时为 Scheduler 解析出正的 admission bound。
    - `kv_cache_memory_bytes` 不得为负，`gpu_memory_utilization` 必须在 `(0,1]`，`max_num_batched_tokens` 必须为正，`max_model_len` 必须为正或 `-1`。
  - 验收：structured、legacy 和 direct 配置路径覆盖默认、非默认、非法值与显式 `0`；paged 路径断言字段进入 native cache/scheduler consumer，`-1` 触发 auto-fit；dense 路径断言原有并行、显存和 token budget 保持不变。 ^[PR #6094]
- [CONF-2c] paged_scheduler 的请求行上限必须是正整数且贯穿配置投影
  - 触发：启用 `paged_scheduler`，或修改 diffusion KV 的请求行容量、native metadata builder 和 BlockTables 初始化。
  - 强制：`diffusion_kv_max_rows_per_request` 必须是严格的正整数，并在 `OmniDiffusionConfig` 与 `_DiffusionConfigProjection` 中统一校验；`paged_scheduler` 必须显式设置该字段，Worker 用它把一个 public request 的 sequence/context rows 容量传入 native cache 初始化。
  - 验收：direct、structured 与 deploy/config projection 分别覆盖缺省、正值和非法值，断言 paged mode 的最终 Worker/native consumer 读取行上限，dense mode 保持原有行为，并覆盖平台无关的配置构造。^[PR #6102]

## 决策与踩坑

- [VOMNI-CFG-1j] 禁止：只在 YAML 注释或模型内部设置 cache dtype；用 stage 的整体 `dtype` 替代 SSM state dtype；只验证 dataclass 能构造而不验证最终 runtime consumer。
- [VOMNI-CFG-1k] 禁止：把 `FLASHINFER` 视为原生 FlashInfer decode 的保证；依据八个 codebook 推断 attention 为 `q_len=8`；只修改一个 Higgs profile；或把 SM90/XQA capability 通过误认为 BF16 工作负载的性能结论。
- [VOMNI-CFG-1l] 禁止：用字段同名替代语义与 owner 审计；让 positional constructor 因 upstream 字段重排而静默改变含义；把继承字段的默认值当作显式 engine input；在 head process 执行终态初始化，或让 quantization 等未审计边界随 upstream contract 自动扩张。
- [VOMNI-CFG-1m] 禁止：用未注册 env var 或模型初始化时自行读取绕过配置 owner；只在 YAML/dataclass 声明但在 engine args 或最终 stage 丢失；把模型专用字段变成所有 talker 的通用行为，或把 absent 当成显式启用。
- [VOMNI-CFG-1n] 禁止：在配置 projection 或 `AsyncOmniEngine` 中把省略值预先改成 `"mp"`，把 `None` 当作显式 backend，或用 truthiness 合并吞掉显式 backend；不能以文档或原始 YAML 值代替最终 stage config 的传播证明。
- [VOMNI-CFG-1o] 禁止：只在 dataclass 或默认 params 上保留约束、让 OmegaConf runtime config 静默丢字段，或以测试直接注入 constraints list 代替真实序列化路径。
- [CONF-1a] 禁止：只修改生成后的 CI YAML 而不改源模板；把单个 stage 的默认值当作全卡预算。
- [CONF-2a] 禁止：继续按轮次“顺手减 0.05” `gpu_memory_utilization`；显式 KV pin 后该比例不再决定 KV 大小。
- [CONF-2b] 禁止：让 `dense_legacy` 因这些字段改变既有 pipeline parallel、cache 或 scheduler 配置；用 truthiness 把 `0` 误判为非法或显式 KV pin；在末端静默丢弃非默认值，或把文本 encoder 的长度字段未经模型语义确认当作 DiT KV 上限。
- [CONF-2c] 禁止：接受缺失、`0`、负数、`bool` 或浮点行上限；用 truthiness 合并吞掉显式值；让 `dense_legacy` 因该字段创建 native paged KV，或把 CUDA 平台限制写进通用配置校验。
