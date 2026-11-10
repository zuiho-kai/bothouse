---
name: hunyuan-image3-rules-1
description: HunyuanImage3 开发规则前半：Direct 开发快速入口（HY3-0a / 0b 与按修改对象选规则的源码入口表）、审查触发组表、完整行为链 HY3-1a…1j、公开入口 HY3-2a…2g、prompt 与 tokenizer HY3-3a…3f、size=auto 与 ratio HY3-4a…4d、条件图和随机数 HY3-5a…5f
metadata:
  scope: 只收 HY3-0* 至 HY3-5a…5f 的导航、触发组和行为 / 入口 / prompt / ratio / 条件图规则；HY3-6*（验收矩阵）、HY3-7a…7e、HY3-5g…5i、HY3-8a、HY3-8d、HY3-9a、HY3-10a 归 hunyuan-image3-rules-2，ROCm 规则归 rules-rocm
---
# HunyuanImage3 开发规则（1/2）

## 关键事实

- 拆分说明：本页是源页 `rules.md` 的第 1/2 部分；第 2 部分 [[hunyuan-image3-rules-2]]
- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, hunyuan-image3；created: 2026-07-13；updated: 2026-09-22
- 来源（sources）：incidents/painterly/_index.md；hf-alignment-pitfalls.md；vllm_omni/diffusion/models/hunyuan_image3/prompt_utils.py；vllm_omni/model_extras/hunyuan_image3.py；vllm_omni/model_extras/registry.py；PR #6094；vllm_omni/diffusion/models/hunyuan_image3/hunyuan_image3_transformer.py；PR #6306
  - PR #6102；PR #6563；PR #4048；vllm_omni/diffusion/models/hunyuan_image3/pipeline_hunyuan_image3.py；vllm_omni/diffusion/models/hunyuan_image3/hunyuan_image3_tokenizer.py；vllm_omni/diffusion/models/hunyuan_image3/request_layout.py
  - tests/diffusion/models/hunyuan_image3/test_hunyuan_image3_step_execution.py；tests/diffusion/models/hunyuan_image3/test_image_kv_cache_manager.py；PR #7021；PR #6111
- 这些规则适用于 HunyuanImage3 的生成、编辑、prompt、AR 采样、AR→DiT 交接、条件图处理和公开入口。只有加粗项目或表格第一列中的 `HY3-数字字母` 是可审计规则 ID；章节标题只是分组，不计入 ID，解释性文字和链接也不计。

### Direct 开发快速入口

- [HY3-0a] **HY3-0a — 开发阶段按任务选规则。** 开发者只合并下表命中的规则和源码入口，不在编码前手工枚举整页；Direct review 先用 PR title/body 的声明目标选择表格行，再用 pinned diff 验证真实命中范围。任务命中多行时必须取规则与源码并集，不能只选看起来最接近的一行。PR 描述只负责导航，不能作为 finding 证据；独立 reviewer 仍按当前完整 diff 审计 `core` 和所有真实命中组。
- （以下为原表格，按行改写为条目）
- 正在修改什么：`task`、`bot_task`、system prompt、prompt token
  - 开发阶段先读：`core`、`prompt-token`、`public-topology`
  - 第一批 live 源码：`vllm_omni/diffusion/models/hunyuan_image3/prompt_utils.py::build_prompt_tokens`；当前 public dispatcher 到 AR input processor
- 正在修改什么：stop token、temperature、top-p、top-k、sampling defaults
  - 开发阶段先读：`core`、`stop-sampling`
  - 第一批 live 源码：对应 stage YAML；sampling params 构造点；scheduler 实际读取的 stop 集合
- 正在修改什么：CoT、AR→DiT、stage transition
  - 开发阶段先读：`core`、`stage-transition`
  - 第一批 live 源码：官方用户入口；`vllm_omni/model_executor/stage_input_processors/hunyuan_image3.py::ar2diffusion`；当前 topology 的真实阶段合同
- 正在修改什么：图片数量、多参考图、online/offline
  - 开发阶段先读：`core`、`public-topology`、`image`
  - 第一批 live 源码：`vllm_omni/entrypoints/openai/api_server.py::edit_images`；live public chat dispatcher；offline example；生产 processor/VAE 路径
- 正在修改什么：`size=auto`、ratio token、batch ratio
  - 开发阶段先读：`core`、`size-ratio`、`stage-transition`
  - 第一批 live 源码：live public dispatcher；`_extract_ratio_index`；`ar2diffusion`；最终 size consumer
- 正在修改什么：alpha、resize/crop、条件 VAE、seed/RNG
  - 开发阶段先读：`core`、`image`、`randomness`
  - 第一批 live 源码：live public dispatcher；`prepare_seed`、`_encode_cond_image`、`prepare_model_inputs`；AR 模型的 image/VAE owner
- 正在修改什么：shared serving 分层和模型 adapter
  - 开发阶段先读：`core`、`layering`、`public-topology`
  - 第一批 live 源码：live public dispatcher 到 owner adapter；模型 owner 的 `prompt_utils.py` 和 `stage_input_processors/hunyuan_image3.py`
- 正在修改什么：`model_extras`、shared task examples、`extra_body`、`ar_input_builder`、tokenizer validator/fallback
  - 开发阶段先读：`core`、`prompt-token`、`stop-sampling`、`public-topology`、`layering`
  - 第一批 live 源码：`vllm_omni/model_extras/hunyuan_image3.py::{build_ar_stage_inputs,build_x_to_text_prompt,HUNYUAN_IMAGE3_EXTRA_BODY_PARAMS}`；`vllm_omni/model_extras/registry.py::{get_extra_body_params,get_ar_input_builder,get_ar_tokenizer_validator}`；
    - `vllm_omni/entrypoints/openai/serving_chat.py::_get_diffusion_extra_body_params`；`examples/offline_inference/{text_to_image/text_to_image.py,image_to_image/image_edit.py}::_apply_ar_stage_inputs`；`examples/offline_inference/x_to_text/x_to_text.py::main`；
    - `prompt_utils.py::build_ar_prompt_inputs`；`stage_config.py::_build_engine_args`
- 正在修改什么：prompt、stop 已对齐后仍有真实 HF 差异
  - 开发阶段先读：`core`、`alignment-residual`，再按差异进入 image 或 runtime owner
  - 第一批 live 源码：对齐后的最小复现；processor 输出；`hunyuan_image3.py::{_parse_and_validate_image_input,_vae_encode}`；router/top-k；实际 TP/paged-KV 边界
- [HY3-0b] **HY3-0b — 代码地图之后停止读文档。** 开发或 Direct review 打开命中行的第一批源码后就沿 live producer-consumer 调用链实现或审查；只有规则明确链接的官方机制、源码证明跨 owner 或一个具体未知量阻止继续时，才再读一篇 guide 或增加一个 owner，不能预读 incidents/history。

### 审查触发组

- 独立 reviewer 永远审 `core`，再根据当前 diff 和真实可达路径增加命中的组。组内规则必须全部审计；未命中的组不手工填几十行 `NOT_APPLICABLE`。同一规则可属于多个组，报告中仍只写一行。

| 审查组 | 什么时候触发 | 规则 ID |
|---|---|---|
| `author-routing` | 只供开发者或 Direct reviewer 确认导航和停止阅读，不作为 finding 审计规则 | `HY3-0a`, `HY3-0b` |
| `core` | 每次 HunyuanImage3 代码审查 | `HY3-1f`, `HY3-2g`, `HY3-6a`, `HY3-6j` |
| `prompt-token` | task、bot task、system prompt、模板、token IDs | `HY3-1a`, `HY3-1c`, `HY3-1e`, `HY3-3a`, `HY3-3b`, `HY3-3c`, `HY3-3d`, `HY3-6e`, `HY3-6f` |
| `stop-sampling` | stop、sampling defaults、finish reason | `HY3-1a`, `HY3-1c`, `HY3-1e`, `HY3-3a`, `HY3-3e`, `HY3-6e`, `HY3-6f` |
| `stage-transition` | CoT、AR→DiT、KV 或阶段间字段 | `HY3-1a`, `HY3-1e`, `HY3-1h`, `HY3-1i`, `HY3-1j`, `HY3-2g`, `HY3-6f` |
| `public-topology` | public entry、online/offline、资源获取、topology | `HY3-1b`, `HY3-1d`, `HY3-2a`, `HY3-2c`, `HY3-2e`, `HY3-2f`, `HY3-2g`, `HY3-3f`, `HY3-6b` |
| `layering` | shared serving 或模型 adapter 分层 | `HY3-1g`, `HY3-2f`, `HY3-6i` |
| `image` | 图片数量、processor、VAE、条件图 | `HY3-2b`, `HY3-2c`, `HY3-2d`, `HY3-5a`, `HY3-5b`, `HY3-5c`, `HY3-6c`, `HY3-6d` |
| `size-ratio` | size=auto、ratio、batch ratio | `HY3-4a`, `HY3-4b`, `HY3-4c`, `HY3-4d`, `HY3-6g` |
| `moe-loader` | `get_expert_mapping`、expert remapping、fused-MoE loader 对接 | `HY3-9a` |

- （以下为原表格，按行改写为条目）
- 审查组：`randomness`
  - 什么时候触发：seed、RNG、复现
  - 规则 ID：`HY3-5d`, `HY3-5e`, `HY3-5f`, `HY3-6h`
- 审查组：`alignment-residual`
  - 什么时候触发：prompt、token、stop 已验证后仍有真实输出差异
  - 规则 ID：`HY3-3d`, `HY3-5b`, `HY3-7a`, `HY3-7b`, `HY3-7c`, `HY3-7d`, `HY3-7e`
- 审查组：`paged-kv`
  - 什么时候触发：Hunyuan scheduler-paged KV、Q/K/V layout、prefill/denoise span 或 mixed attention
  - 规则 ID：`HY3-5h`, `HY3-5i`

### 完整行为链

- [HY3-1a] **HY3-1a — 编码前行为表。** 涉及 `task`、`bot_task`、system prompt、stop token 或 AR→DiT 数据时，只填写实际受影响模式和一个默认或相邻 control，并为这些行核对官方主入口；不能为了表格完整横向调查所有模式。

  | 请求模式 | AR prompt/prefix | 阶段跳转 | 最终停止位置 | 交给 DiT 的文本范围 | DiT system prompt |
  |---|---|---|---|---|---|
  | T2T |  | 无 DiT 时写明 |  | N/A 或真实范围 | N/A 或真实值 |
  | I2T |  | 无 DiT 时写明 |  | N/A 或真实范围 | N/A 或真实值 |
  | T2I |  |  |  |  |  |
  | IT2I |  |  |  |  |  |
  | 其他实际支持模式 |  |  |  |  |  |

- [HY3-1b] **HY3-1b — legacy 只在入口归一化。** 公开 legacy 调用只允许在请求入口做一次显式 normalization，并记录旧字段到新字段的映射。
- [HY3-1c] **HY3-1c — 内部字段保持正交。** `task` 表示用户要做什么，`bot_task` 表示 AR 怎样生成；进入模型计划后两者不得互相充当默认值。
- [HY3-1d] **HY3-1d — legacy 有回归证据。** 新旧公开入口各保留一个行为测试。
- [HY3-1e] **HY3-1e — 单一模型计划。** prompt、stage transition、final stop、CoT 边界和 DiT prompt 必须由同一份模型专属计划导出。每种模式同时写明真实交接机制是 token IDs、decoded text、KV、图片状态、其他 stage state，还是没有下游阶段；字段出现在字典里或没有直接 reader 都不能单独证明对错。
- [HY3-1f] **HY3-1f — 官方主入口是语义基线。** 对齐官方 `generate_image()` 等真实用户入口，不用绕过阶段跳转的底层 `generate()` 代替。机制解释见 [[hf-alignment-pitfalls]]（HF alignment pitfalls）。
- [HY3-1g] **HY3-1g — 模型语义留在 owner。** shared serving 不实现 HunyuanImage3 状态机，不导入模型 prompt helper，也不堆模型名称分支；它只传通用请求事实并调用模型 owner 暴露的 adapter/capability，模型专属默认值和跳转计划留在 owner。
- [HY3-1h] **HY3-1h — 行为表逐行验收。** 每行必须同时给出官方源码、vLLM-Omni consumer 和测试证据；受影响行缺少任一项时状态只能是 `implementation draft`。
- [HY3-1i] **HY3-1i — 先证明阶段合同。** 在要求某段 AR text、KV 或图片被 DiT 直接读取前，必须从官方用户入口和当前 topology 证明该值就是阶段合同的一部分。若 canonical 路径通过其他 state 完成跳转，或当前模式没有 DiT，不能因为搜索不到字段 reader 就报缺 consumer。
- [HY3-1j] **HY3-1j — finding 必须属于当前 diff。** stage-transition P0/P1 必须给出“当前修改点 → 可达运行路径 → 修改前已有合同 → 用户故障”的完整证据，并核对是否存在另一条 canonical 机制。已有架构疑问、未验证设计偏好或作者任务里的模糊表述只记调查项，不冒充当前 diff blocker。

### 所有公开入口

- [HY3-2a] **HY3-2a — live 入口清单。** 修改图片数量、prompt、size、seed 或模式前，从 live 源码枚举所有能进入同一模型流程的入口，包括实际存在的 offline example、image generation/edit endpoint、chat endpoint 和内部直调；不能根据当前编辑文件假定只有一个入口。
- [HY3-2b] **HY3-2b — 图片数量合同。** T2I 接受 0 张参考图，IT2I 接受 1–3 张；不得为了代码兼容给 T2I 伪造 `num_images=1`。
- [HY3-2c] **HY3-2c — 入口尽早拒绝。** 每个公开入口都在文件读取、URL 获取、解码、resize 和 GPU/VAE 工作前校验图片数量。
- [HY3-2d] **HY3-2d — 数量边界有入口证据。** 测试覆盖 0、1、2、3、>3，并断言 >3 的拒绝发生在昂贵操作之前。
- [HY3-2e] **HY3-2e — online/offline 行为一致。** 两条路径共用模型 owner 的 normalization/plan，或用逐字段 parity test 证明一致；helper 返回值测试不能代替公开入口证据。
- [HY3-2f] **HY3-2f — 新入口不能形成旁路。** 新增入口或调用方式时同步扩展入口矩阵，并用旧入口回归证明新 happy path 没有绕过旧合同。
- [HY3-2g] **HY3-2g — 核对真实 dispatcher。** 对所有能到达 changed owner 的公开入口和一个默认或相邻 control，写出实际 dispatcher、第一处 decode/load、模型 owner adapter 和最终 consumer；不能枚举仓库全部入口，也不能用 helper 存在代替真实调用。

### Prompt 和 tokenizer

- [HY3-3a] **HY3-3a — 官方分段 tokenization。** HunyuanImage3 chat prompt 使用官方分段 tokenization；需要 Token 级对齐时传 `prompt_token_ids`，不得静默退回整串 BPE。
- [HY3-3b] **HY3-3b — 缺少模型工件就 fail fast。** tokenizer、processor 或模型专属配置缺失时在 owner 边界报出具体缺项，不切到会改变 token 边界的路径。
- [HY3-3c] **HY3-3c — system prompt 是完整合同。** 类型、正文、尾部换行、normalization 点和 bot prefix 都必须与对应官方入口一致；不得随手 `strip()` 或保留空白，也不得把一个官方入口的 normalization 推广到另一条 token path。差异必须由真实入口和 token IDs 证明。
- [HY3-3d] **HY3-3d — 使用真实 tokenizer 验收。** 至少一个测试使用真实 tokenizer/processor，并同时断言 token ids、raw prompt、system prompt 和图像占位符数量。格式解释见 [[official-prompt-format]]（official prompt format）。
- [HY3-3e] **HY3-3e — stop 和 sampling 在 owner 构造点确定。** 每个受影响模式列出完整 stop token 集合、finish 边界和 sampling defaults。优先修改 stage config 或受支持的构造 API；构造完成后直接改公开字段时，必须证明 scheduler 内部集合也同步。stop 修复不得顺手改变 temperature、top-p、top-k 或其他无关默认值。
- [HY3-3f] **HY3-3f — 资源获取服从 topology。** 获取 tokenizer、processor、engine 或 stage resource 前，列出哪些 topology 拥有它、默认 CLI 走哪条 topology，以及不存在时的 owner 路径。至少跑一个默认入口和一个受影响入口；不能因为 AR-first 路径有 stage-0 tokenizer 就让 diffusion-only 路径启动即失败。

### `size=auto` 和 ratio

- [HY3-4a] **HY3-4a — ratio 来源唯一。** `size=auto` 使用 AR 实际生成的 `<img_ratio_*>` 和官方允许集合；集合按可能不连续处理，不用连续区间、第一张参考图比例或自造 heuristic 代替。
- [HY3-4b] **HY3-4b — ratio 生命周期完整。** ratio 限制、选择、AR 输出提取、AR→DiT 翻译和最终宽高必须连成一条可追踪链；只在 pipeline 尾部补宽高不算完成。
- [HY3-4c] **HY3-4c — batch 内逐请求归属。** 每个请求独立拥有 ratio；实现只支持同尺寸 batch 时，在进入 pipeline 前明确拒绝不同 ratio，不默默使用第一个请求的值。
- [HY3-4d] **HY3-4d — ratio 边界测试。** 至少覆盖一个非连续 token、两个不同 ratio 的请求和缺少 ratio token 的失败路径。

### 条件图和随机数

- [HY3-5a] **HY3-5a — 保留原生 bucket。** 每张参考图保留自己的 bucket 语义，异构尺寸不得在真实 VAE/ViT 处理前被无条件 `stack`。
- [HY3-5b] **HY3-5b — 使用生产图像路径验收。** 至少运行一次生产 processor/VAE 路径，fake tensor shape 不算替代证据。
- [HY3-5c] **HY3-5c — 图像策略精确对齐。** alpha 到 RGB、resize/crop、归一化和 cond VAE posterior 策略逐项核对官方实现，不能用看起来合理的白底或黑底策略代替。
- [HY3-5d] **HY3-5d — RNG 阶段归属明确。** 编码前写清 request seed 控制 AR sampling、条件 VAE、DiT noise 的哪些阶段以及是否共享 RNG 流。
- [HY3-5e] **HY3-5e — 不改变官方 RNG 消费顺序。** 不得通过 clone 或局部新建 generator 无意改变官方随机数消费顺序。
- [HY3-5f] **HY3-5f — seed 端到端验收。** 相同 seed 同时覆盖 online/offline 和条件图路径；只证明 AR seed 或最终 DiT seed 被赋值不算可复现。
