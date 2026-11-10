---
name: cosmos3-rules-1
description: "Cosmos3 规则第 1 部分与 Direct 代码入口表：COSMOS-1a Edge offload 声明、COSMOS-1b Distilled 的 SDE scheduler 合同、COSMOS-2a 请求本地 generator、COSMOS-2b guidance=0.0 原样到达、COSMOS-2c session manager 按 branch/layer 装卸（PR #4657）、COSMOS-3a 支持表逐项证据、COSMOS-3b ROCm recipe 数字绑定 b3f4fbf9 与协议（PR #5634）、COSMOS-4a 默认 guardrails 缺包 fail closed、COSMOS-5a / COSMOS-5b Transfer 请求、提示词与 canonical bucket"
metadata:
  scope: 只收 COSMOS-1a 至 COSMOS-5b；COSMOS-6a、COSMOS-6b、COSMOS-1c、COSMOS-7a、COSMOS-8a 与两条 VLLM-OMNI-PR 规则归 cosmos3-rules-2，变体与流程概述归 cosmos3-overview
---
# Cosmos3 规则（1/2）

## 关键事实

- 拆分说明：本页是源页 `rules.md` 的第 1/2 部分；第 2 部分 [[cosmos3-rules-2]]
- 源页：`knowledge/repos/vllm-omni/models/cosmos3/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, diffusion；created: 2026-07-20；updated: 2026-10-23
- 来源（sources）：PR #4657；PR #5001；PR #5634；PR #6049；docs/features/session_state_manager.md；recipes/cosmos3/Cosmos3-Nano.md；vllm_omni/diffusion/models/cosmos3/；vllm_omni/model_extras/cosmos3.py；vllm_omni/model_extras/registry.py；vllm_omni/experimental/world_models/adapters/state_cosmos3_adapter.py
  - vllm_omni/platforms/rocm/platform.py；tests/diffusion/models/cosmos3/test_session_memory_equivalence.py；tests/diffusion/models/cosmos3/test_cosmos3_pipeline.py；PR #6107；PR #5614；PR #6325；PR #6913；PR #6920；PR #7427；PR #7971；PR #7592；PR #5712；PR #9304
- 置信度（confidence）：high
- 只有 `COSMOS-数字字母` 是可审计规则 ID。

### Direct 代码快速入口

| PR 描述信号 | 规则组 | 第一批源码 |
|---|---|---|
| Cosmos3/Edge、layerwise offload、专有 block | COSMOS-1a | `diffusion/registry.py::_DIFFUSION_MODELS`；`diffusion/models/cosmos3/transformer_cosmos3_edge.py::Cosmos3EdgeVFMTransformer` |
| Distilled、SDE scheduler、`t_list` | COSMOS-1b | `diffusion/models/cosmos3/pipeline_cosmos3.py::Cosmos3OmniDiffusersPipeline` 及 scheduler config consumer |
| seed/generator、逐步噪声 | COSMOS-2a | `pipeline_cosmos3.py::Cosmos3OmniDiffusersPipeline` 的 request-local sampling 路径 |
| `guidance=0`、request extra | COSMOS-2b | `model_extras/cosmos3.py` → pipeline sampling params；canonical task envelope 由 shared example 拥有 |
| session manager、UND K/V、`freqs_gen`、CFG branch、request ID | COSMOS-2c | `state_cosmos3_adapter.py` → `pipeline_cosmos3.py` → `transformer_cosmos3.py` |
| online/offload/HSDP/VAE parallel 支持声明 | COSMOS-3a | capability 文档/recipe → 对应公开入口与实现路径 |
| ROCm、MI350X、AITER、latency/peak memory | COSMOS-3b | recipe 的 measurement commit/protocol → `platforms/rocm/platform.py` backend gate → 目标配置复测 |
| formatted final prompt、`prompt_suffix`、rank-zero log level | COSMOS-6a | `diffusion/models/cosmos3/pipeline_cosmos3.py::Cosmos3OmniDiffusersPipeline` |
| multi-chunk transfer、distributed VAE decode、overlap broadcast、rank-zero assembly | COSMOS-6b | `diffusion/models/cosmos3/pipeline_cosmos3.py::{_transfer_vae_executor,_sync_transfer_overlap,_forward_transfer}`；`tests/diffusion/models/cosmos3/test_cosmos3_pipeline.py` |

- 若描述只写 Cosmos3，先从 registry 的 class key 进入 pipeline；只有命中共享 RNG、graph 或 offload 机制时再加 [[diffusion-rules-1]]、[[diffusion-rules-2]]、[[diffusion-rules-3]]（Diffusion owner）。

### [COSMOS-1a] Edge 的 offload 声明覆盖全部专有 block

- 触发：修改 Edge transformer 层级、layerwise offload 或 component discovery。
- 强制：Edge 新增/重命名 block 时同步更新 offload block 声明，并验证启用 offload 后每个目标 block 都发生预期迁移。
- 验收：结构测试枚举 Edge block 与 offload 声明集合，真实 smoke 证明无遗漏驻留。 ^[PR #5001]

### [COSMOS-1b] Distilled checkpoint 强制 stochastic scheduler 合同

- 触发：scheduler `_class_name` 或 checkpoint config 表明 distilled 变体。
- 强制：验证 `fixed_step_sampler_config.sample_type=sde` 且 `t_list` 非空；缺失立即失败。
- 验收：有效 distilled config 选择正确 scheduler；sample type 或 timestep 缺失分别有 fail-fast 测试。 ^[PR #5001]

### [COSMOS-2a] 逐步重加噪只使用请求本地 generator

- 触发：pipeline 在 scheduler step 中生成额外噪声或根据 seed 重建 generator。
- 强制：generator 从 request sampling params 传入每次随机操作，并确认当前 diffusers 版本的 scheduler 真正消费该参数。
- 验收：交错执行两个不同 seed 的请求与各自单独运行结果一致；相同 seed 可重复。 ^[PR #5001]

### [COSMOS-2b] guidance=0.0 必须原样到达 consumer

- 触发：request/dataclass 初始化 guidance 或其他允许零值的字段。
- 强制：仅以 `is None` 判断未提供；保留显式 `0.0` 并沿 request → sampling params → pipeline 断言。
- 验收：未提供使用默认，`0.0` 保持零，普通正值保持不变，三类测试都到 consumer。Cosmos3 T2I builder 已删除：shared example 写 `modalities=["image"]`，registry identity-return，pipeline 保留模型 validation/normalization；不得把 extra-body registry 误当 task-envelope owner。^[PR #5001] ^[PR #6049]

### [COSMOS-2c] session manager 缓存必须按 branch/layer 完整装卸

- 触发：启用 session-state manager，或修改 UND cached K/V、`freqs_gen`、CFG/request key。
- 强制：每层以 conditional `und_kv/{i}` 或 unconditional `und_kv_neg/{i}` 分支存 native `(K,V)` 引用，并随分支保存 M-RoPE cos/sin；仅未初始化分支可 capture，标准与 RoboLab/action 路径都必须传 request ID。generation 开始 reset，整个 dispatch 用 `finally` drop session。
- CFG：sequential CFG 可在同 GPU 保留 cond+uncond，CFG-parallel 每 rank 只保留自身分支，no-CFG 只保留 cond；UND K/V 随 SP rank 复制。该 state 隔离不等于 pipeline 并发安全。
- 验收：CPU adapter/mocked pipeline 测试覆盖 branch round-trip、encode-once、freqs restore、partial rejection、reset/LRU pin、RoboLab key、Transfer guard 与首次 step 前异常清理；真实 GPU/model flag-on equivalence 和 peak-memory A/B 仍是缺口，错误 env var 下的早期零差异不能引用。

### [COSMOS-3a] 支持表中的每个能力都有独立证据

- 触发：声明 Edge/Distilled、online、offload、HSDP、VAE parallel 或公开 checkpoint 支持。
- 强制：每个勾选项绑定可运行命令、checkpoint、输出和对应路径测试；未发布 checkpoint 不得提前标完整支持。
- 验收：公开矩阵逐项引用当前 head 证据；pending 项明确未验证或暂不声明。 ^[PR #5001]

### [COSMOS-3b] 硬件 recipe 数字必须绑定测量 commit、协议和未覆盖维度

- 触发：引用 Cosmos3 ROCm latency、显存、determinism、backend 或最低硬件声明。
- 强制：PR #5634 的数值只绑定 vLLM-Omni `b3f4fbf9`、单张 MI350X/gfx950、HIP 7.2、guardrails off、Nano T2I/T2V、每配置一次 warmup 加一次 measured run。T2I 1024²/50 steps 报告约 2.7 s、49.5 GiB reserved；T2V 1280×720/189 frames/35 steps 报告 161 s、120 GiB reserved/95 GiB allocated；
  - tiling、layerwise offload、FP8 分别报告约 183 s/38/36 GiB、163 s/84/69 GiB、149 s/107/82 GiB。数字是该协议的观察值，不是 merge target `b4581b29` 的复测结果。
- 验收：任何 target-head 或硬件矩阵 claim 都重新记录 commit、完整软件栈、warm/cold、样本数、reserved/allocated 定义、backend assertion 与输出检查；quality 必须有独立 metric/golden。PR #5634 只验证尺寸、帧数和同配置复现，明确没有 quality evaluation。^[PR #5634]
- 共享 RNG/graph 规则见 [[diffusion-rules-1]]、[[diffusion-rules-2]]、[[diffusion-rules-3]]（Diffusion rules）；公开证据分层见 [[model-adaptation-guardrails-1]]、[[model-adaptation-guardrails-2]]（model adaptation guardrails）。

### [COSMOS-4a] 默认 guardrails 必须具备依赖并在缺包时 fail closed

- 触发：Cosmos3 以默认开启的 guardrails 加载或运行，或修改 Cosmos3 guardrail 依赖与缺包处理。
- 强制：在公共依赖中声明 `cosmos-guardrail>=0.3.1`，使标准 vLLM-Omni 镜像具备默认 guardrails 所需包；guardrail import 失败时必须立即抛出明确的 `ValueError`，说明 guardrails 已启用但不可用、缺少 `cosmos-guardrail`，并保留 NVIDIA Open Model License Agreement 合规提示。
- 验收：干净环境安装公共 requirements 后 `cosmos-guardrail` 可导入，Cosmos3 默认 guardrails 路径可进入模型运行；模拟缺少该包时启动/构造 fail fast，错误文本同时包含包名和许可证链接。^[PR #6107]

### [COSMOS-5a] Transfer 请求与提示词合同

- 触发：修改 Cosmos3 transfer 的 `edge`、`blur`、`depth`、`seg`、`wsm` 控制提示解析、控制权重或 transfer prompt 构造。
- 强制：每个 active hint 只接受声明的字段，并将 `control_weight` 校验为 finite、non-negative 且总和为正；按 hint 声明顺序归一化为相对权重，单个正权重归一为 `1.0`，单控制的绝对强度仍由 `control_guidance` 控制。Transfer 必须使用专用 system prompt，同时对 CFG 两支启用；默认在 positive prompt 追加列出 active hints 并要求逐帧遵循形状、位置和运动的 directive，`emphasize_control_in_prompt=false` 才关闭。
  - 默认启用 duration/FPS 与 resolution metadata，并以 `negative_metadata_mode=same` 同步到 negative branch；可分别关闭模板，模式只允许 `same`、`inverse`、`none`。Transfer 不自动生成 negative prompt，调用方需显式传入可选参考 prompt。
- 验收：覆盖单/多控制权重归一化、未知字段、负数、全零和 `emphasize_control_in_prompt` ablation；断言 positive/negative 两支的 system prompt、metadata mode、模板和显式/省略 negative prompt；真实 serving 还需固定模型 revision、输入、seed、步数和硬件分别验证输出质量，当前单测与附件不构成通用质量或性能证据。^[PR #5614]

### [COSMOS-5b] Transfer canonical bucket 与 JSON aspect_ratio 元数据必须一致

- 触发：修改 Cosmos3 transfer 的 `size`、`resolution`、`aspect_ratio`、控制输入 bucket 选择、JSON prompt 元数据，或 I2V/V2V 的 canvas ratio 格式化与多 rank prompt 处理。
- 强制：Transfer 必须根据控制输入和选定 resolution 从 `VIDEO_RES_SIZE_INFO` 选择 canonical `(height, width, aspect_ratio)` bucket；原始请求尺寸先保存到 `COSMOS3_TRANSFER_REQUESTED_SIZE_KEY`，仅用于冲突告警，不能改变控制输入选出的几何。Transfer JSON prompt、以及 I2V/V2V 生成 canvas 的 aspect ratio 元数据必须使用 canonical ratio；
  - 若请求或 JSON prompt 的 ratio 与 canvas 冲突，所有 rank 都重写元数据，只有 rank 0 输出 warning。非 canonical canvas 必须映射到最近的受支持 ratio，而不是使用 gcd 形成新标签。
- 验收：覆盖 Transfer 请求尺寸与控制 bucket 不一致、请求/JSON ratio 冲突、rank 0 与非 rank 0 的 warning/rewrite 行为，以及 `1104x816`、`832x468` 等近似 canvas 映射到 `4,3`、`16,9` 的回归；JSON prompt 解析后必须逐 rank 得到相同 canonical `aspect_ratio`。^[PR #6325]

## 决策与踩坑

- [COSMOS-1a] 禁止：从常规 transformer 的声明推断 Edge 自动覆盖。
- [COSMOS-1b] 禁止：静默使用普通 scheduler/default，使 distilled 输出“能跑但语义错”。
- [COSMOS-2a] 禁止：调用 `torch.manual_seed`/global RNG 实现逐请求确定性；并发请求会互相改状态。
- [COSMOS-2b] 禁止：`value or default`、truthy sentinel。
- [COSMOS-2c] 禁止：capture 新分支时接受缺 K/V 或缺 freqs，或 load 只初始化部分 layer K/V；已有完整 K/V 但没有 cached freqs 时允许装载，并由 transformer 独立重算 freqs。flag 开启时 `diffuse_transfer()` 必须 fail closed，`_bde_kv_state` 非空也必须拒绝，因为当前没有 writer。默认关闭时保留原有 transformer-instance cache 行为。^[PR #4657]
- [COSMOS-3a] 禁止：用 offline unit test 支撑 online/HSDP/offload 多项 claim。
- [COSMOS-3b] 禁止：把单次 measured run 变成稳定性能界、从 38 GiB peak 推断已验证 40 GiB 可运行，或把同配置 byte-identical 外推为跨 flags/hardware determinism。ROCm platform 的 AITER gate 包含 gfx942/gfx950，但 PR 只实测 gfx950；gfx942、multi-GPU、Cosmos3-Super 均不得标已验证。
- [COSMOS-4a] 禁止：依赖用户手动安装额外包才能获得默认行为；缺少 guardrail 包时静默继续、把状态描述为用户主动禁用了 safety checker，或把安装成功外推为 HF authentication、模型质量和其他变体能力已验证。
- [COSMOS-5a] 禁止：把 `weight` 等未声明字段静默当作 `control_weight`；接受负数、非 finite 或全零权重；用单控制归一化权重改变绝对 guidance；让 request 的 `system_prompt`/`use_system_prompt` 覆盖 transfer system prompt；把默认 metadata 或 negative prompt 行为外推到普通 T2I/T2V。
- [COSMOS-5b] 禁止：把 Transfer 的任意 `size=HxW` 当作最终几何或宣称其会被采用；保留控制输入已覆盖的 stale `aspect_ratio`；将元数据重写也放在 `_is_rank_zero()` 条件内导致 rank 间 token ids 不一致；用非 canonical 的精确 gcd ratio 触发无意义的冲突告警。
