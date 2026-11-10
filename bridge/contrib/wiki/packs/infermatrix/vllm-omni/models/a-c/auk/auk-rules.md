---
name: auk-rules
description: AuK / AuK-Flash 请求与加速规则 AUK-1a、AUK-2a 至 AUK-2c、AUK-3a 至 AUK-3d 及 Direct 代码入口表：Speech API task shortcut 在 adapter 一次性转换、DiT graph 整代退役与 capture 失败处理、graph 几何与 per-request conditioning 分离、adaLN 随 time grid 刷新、codec tiling 的 halo / fallback、reference latent cache 只缓存 posterior mean、encoder FULL graph 的 stage handoff 验收、fused alias-free activation 的 eligibility
metadata:
  scope: 只收 AuK 的 Speech API adapter、DiT graph、codec 与 reference cache 规则；FP8 量化规则 AUK-2d 归 rules-fp8，目录入口归 auk-overview
---
# AuK / AuK-Flash 请求与加速规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/auk/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, diffusion；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #7469；PR #7881；PR #8300；PR #8328；PR #8305
- 置信度（confidence）：high

### Direct 代码快速入口

| PR 描述信号 | 规则组 | 第一批源码 |
|---|---|---|
| Speech API、task_type、instruction、duration | AUK-1a | `tts_adapters/auk.py::AuKAdapter` → `model_extras/auk.py` |
| DiT graph、CFG、conditioning、time grid | AUK-2a / AUK-2b / AUK-2c | `diffusion/models/auk/cudagraph_wrapper.py` → `auk_transformer.py::prepare/step` |
| codec graph、tiling、halo、compiled bucket | AUK-3a | `vae_cudagraph.py::plan_tiles`、`AuKVAEDecodeGraph` → `auk_vae.py::decode_context_frames` |
| reference cache、encoder FULL graph、Triton Snake | AUK-3b / AUK-3c / AUK-3d | `pipeline_auk.py::_encode_source`、`deploy/auk.yaml`、`auk_vae.py::AliasFreeActivation` |

### [AUK-1a] task shortcut 必须在 adapter 中一次性转换并保留 benchmark 任务口径

- 触发：修改 AuK Speech API、`task_type`、instruction normalization 或 TTS benchmark mapping。
- 强制：完整 `instructions` 优先；CustomVoice/Base shortcut 用 JSON quoting 包住 target text，转换后清空 input 并消费 task_type，batch validate/build 的第二次 normalize 不再套模板。entry stage 按 `AuKForConditionalGeneration` architecture 识别，不能只靠 generic encoder stage 名。无 reference 必须有正有限 duration；
  - 自定义 t_grid 至少两项、有限严格递增，在 encoder dispatch 前拒绝错误；seed/steps/CFG override 进入 diffusion stage。benchmark 由 model config 映射任务并在导出记录 task/task_type，通用 harness 不改模型 prompt。
- 验收：单条与 batch 请求反复 normalize 结果相同；覆盖引号/反斜杠/Unicode、字段冲突、完整 instruction、invalid duration/grid 和 stage override；benchmark 结果保留任务元数据。特定语料 WER 不外推到任意 instruction/reference。^[PR #7469]

### [AUK-2a] 共享 pool 的 DiT graphs 必须整代退役，capture 失败不能重试损坏 generation

- 触发：修改 AuK DiT graph cache capacity、capture exception、pool 或 replay buffer。
- 强制：wrapper 使用自己的 graph pool；容量满且需新 shape 时整代清空，不能只销毁一条仍与存活 graph 共享地址的 entry。capture 失败清空、禁用 wrapper 并传播当前错误，后续请求才走 eager；replay 返回裁去 padding 后的 clone，避免被下一步覆盖。
- 验收：填满 cache 再引入新 key，旧 generation 全部退役；注入 capture failure 后当前失败且后续 eager；连续 replay 不改先前持有输出，实测 CUDA allocator lifetime。CPU mock 的 cache 检查不等于 GPU address reuse 已验收。^[PR #7469]

### [AUK-2b] graph 几何与 per-request conditioning 必须分离

- 触发：修改 DiT bucketing、prepare/step split、CFG、padding bias 或 compilation hook。
- 强制：key 包含 bucketed target/text/reference geometry 与 CFG 模式；timestep 和同一模式内的 CFG strength 更新静态 scalar buffer。每个新 request 重新 prepare text projection、两支 reference embedding、padding bias/RoPE，再复制到当前 graph context；graph 只捕获 step+CFG combine。full compile 编译 sampler 实际调用的 step；
  - regional compile 使用 double/single repeated blocks。startup warmup 按当前 variant 的 CFG 与默认 time grid，覆盖有/无 reference；显式空 warmup 列表可禁用。
- 验收：同 bucket 换 prompt/reference/CFG strength、跨 bucket 后返回、Base/Flash 与 warmup→首请求均对照 eager 的 condition/velocity；compile 和 capture 的 startup 成本与稳态 latency 分开测量。^[PR #7469] ^[PR #8300]

### [AUK-2c] 预计算 adaLN 必须随请求的 time grid 刷新，step index 是图内可变输入

- 触发：修改 timestep modulation、time-grid 长度、图 key 或 conv position embedding。
- 强制：prepare 按整个当前 time grid 计算各层 shift/scale/gate；key 包含 grid length，相同长度但不同 grid 的新请求也必须刷新 context。每一步更新静态 step-index buffer 选择对应 modulation 行。unfold+batched GEMM 的 grouped conv 保持原 Conv1d 几何与边界。
- 验收：同长度不同时间值、不同长度、所有 step 的 eager/graph velocity 对比，连同 grouped Conv1d 的独立数值 oracle；warmup 用 variant 默认 grid 匹配真实 key。^[PR #8328]

### [AUK-3a] codec tiling 必须保留 decoder halo、buffer lifetime 与实际 fallback

- 触发：修改 VAE compile buckets、decode_tiles、tile size 或 graph failure handling。
- 强制：halo 从 decoder receptive-field 计算，tile 大于左右 context 总和；每窗仅贡献有完整 context 的 interior，真片边界例外。选最小成功 capture 的 compiled bucket，右侧 pad 后 crop，尾窗可选更小 bucket。plain graphs 共享 private pool 且整代退役；compiled warmup failure 可选其他 bucket/plain path，运行期 plain capture/replay 错误仍传播。
  - 保留跨 iteration 的 graph-backed chunk 必须复制；latent output 跳过 codec。
- 验收：独立 whole eager oracle 检查 halo 内部/真边界、短尾窗、禁用 tile、batched/CPU/outer-capture eager 路径与持有 chunk；compiled/tiling 采用数值 tolerance 并检查尾部。配置 bucket 是参数而非固定能力，后续 deployment 可改为 160/320/640。^[PR #7881]

### [AUK-3b] reference latent cache 只缓存 prepared waveform 的 posterior mean

- 触发：修改 AuK reference audio 预处理、LRU key、capacity 或 VAE sample。
- 强制：content digest 与 prepared waveform 长度共同作 key；只缓存 deterministic posterior mean，随机 posterior draw 每次重新计算且保留 generator。capacity 是非负 integer，bool/float/字符串非法，显式 0 禁用；LRU 有界。返回 cached tensor 的 caller 不得写入。
- 验收：相同内容复用、内容/长度改变 miss、LRU eviction、sample 绕过、关闭 cache 与 invalid capacity；同 seed 的随机路径与无 cache oracle 一致。^[PR #8305]

### [AUK-3c] encoder FULL graph 验收必须观测跨请求的真实 stage handoff

- 触发：修改 AuK stage 0 capture sizes、FULL graph 或 prompt condition transfer。
- 强制：交替不同 prompt 与 token length，覆盖同 bucket、跨 bucket 后返回，逐请求比较 stage 0 交给 DiT 的 text condition 与 eager。只变 encoder 的实验将 stage 1 设为 eager，保留真实 stage handoff，避免无关 DiT/codec compile 成本盖住边界。
- 验收：assert 实际进入预期 capture buckets、condition cosine/误差和重复 prompt 一致性；单次报告阈值与硬件范围明确，不能外推所有 tokenizer/model variant。^[PR #8305]

### [AUK-3d] fused alias-free activation 必须按真实 eligibility 保留 eager

- 触发：修改 SnakeBeta upsample/activation/FIR fusion、Triton import 或 kernel indexing。
- 强制：仅 CUDA fp32、3-D 输入、SnakeBeta 与匹配 filter/crop geometry 使用 fused path；共享 `vllm.triton_utils` 的 availability 控制 import/registration，其他输入保持 eager。parity oracle 直接执行 downsample(act(upsample(x)))，不增加运行时 fusion toggle。
- 验收：长度 511/512/513 与 1023/1024/1025、短输入、contiguous/transposed/sliced、causal 与非 causal 对照独立 eager，并断言 input 未修改；缺 Triton/CPU fallback 可导入。性能收益与质量通过真实模型另核验。^[PR #8305]
- 公共 request/result ownership 见 [[serving-rules-1]]、[[serving-rules-2]]、[[serving-rules-3]]（Serving 规则）；共享 cache 与编译生命周期见 [[diffusion-rules-1]]、[[diffusion-rules-2]]、[[diffusion-rules-3]]（Diffusion 规则）。

## 决策与踩坑

- [AUK-1a] 禁止：用单引号直接拼可能含引号的文本；把 input 当作任意 TTS transcript 自动推断 instruction；按 served checkpoint path 选择任务；遗漏 reference/no-duration 边界。
- [AUK-2a] 禁止：把 wrapper-private pool 单独当作逐 entry eviction 安全证明；`graph.reset()` 后仍留共享地址的旧 peers；捕获失败后继续 replay 或每个新 shape 再试 capture。
- [AUK-2b] 禁止：相同 geometry 即复用上一 prompt 的 context；按旧 64-frame alignment 宣称最新 bucket 仍不变（后续为 32/32/50）；编译未被 sampler 调用的 forward；把 cuDNN SDPA preference 当作所有 shape/backend 的恒定收益。
- [AUK-2c] 禁止：将首步 modulation 固定进 graph；只因 grid length 相同就沿用旧 grid；把特定 H20/H200 测量外推成 Flash 四步或任意设备的相同 latency 收益。
- [AUK-3a] 禁止：把 decode_tiles helper 当作 HTTP streaming 已启用；声称 tiling 令总输出内存与长度无关（pipeline 仍组装完整 waveform）；把 compiled fusion/right padding 的 tolerance 当作 plain exact-length graph 的 bit equality；凭空承诺 runtime eager fallback。
- [AUK-3b] 禁止：按 path、tensor address 或原始压缩音频 bytes 缓存；缓存随机 posterior；用 int() 静默截断 capacity 或负值变禁用；后处理原地污染共享 latents。
- [AUK-3c] 禁止：只检查 audio valid 就证明 prompt condition 没被静态 buffer 覆盖；用同一 prompt 重复请求代替 bucket 变化；为测试再引入未使用的生产控制 API。
- [AUK-3d] 禁止：不匹配 geometry 或非 fp32 强行调用 kernel；将特定 SNR/activation error 扩大成任意 waveform 逐 bit 相同；忽略 stride、partial block 或修改输入 buffer。
