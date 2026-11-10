---
name: omnivoice-rules
description: "OmniVoice 规则：OMNIVOICE-1a 生成器热路径的 QKV/gate-up pack 顺序、partial shard 拒绝、Q/K RMSNorm+RoPE 与 GQA、Triton 资格与 eager 回退（PR #6317）、OMNIVOICE-2a packed varlen CFG 批布局与逐请求 decode（PR #6408）、VLLM-OMNI-PR6105-INSTRUCT-VALIDATION instructions 封闭词表在 TTS adapter 校验（PR #6105）"
metadata:
  scope: 只收 OMNIVOICE-1a、2a、VLLM-OMNI-PR6105-INSTRUCT-VALIDATION 与快速入口表；双注册、pipeline 与部署结构归 omnivoice-overview
---
# OmniVoice 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/omnivoice/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, model-executor, attention-runtime, ffn-runtime；created: 2026-09-05；updated: 2026-10-12
- 来源（sources）：PR #6317；vllm_omni/model_executor/models/omnivoice/omnivoice_generator.py；vllm_omni/model_executor/models/omnivoice/fused_qkv_rope.py；tests/model_executor/models/omnivoice/test_cuda_graph_generator.py；tests/model_executor/models/omnivoice/test_fused_projection_load.py
  - tests/model_executor/models/omnivoice/test_fused_qkv_rope.py；tests/model_executor/models/omnivoice/test_mask_dtype.py；tests/model_executor/models/omnivoice/test_triton_kernels.py；PR #6408；PR #6105
- 置信度（confidence）：high
- 只有 `OMNIVOICE-数字字母` 是可审计规则 ID。双注册、pipeline 与部署结构见 [[omnivoice-overview]]（_index）；共享固定输入、mask 与 TF32 约束见 [[rules-runtime-hot-paths]]（EXEC-9a；源锚点 #exec-9a-omnivoice-热路径的固定输入缓存与掩码精度边界）。

### Direct 代码快速入口

- （以下为原表格，按行改写为条目）
- 正在做什么：OmniVoice generator 的 fused projection、checkpoint loading、attention prologue、SwiGLU、residual、mask dtype、CUDA graph 或 Triton fallback
  - 精确规则组：`core`：`OMNIVOICE-1a`
  - 第一批 live 源码：`vllm_omni/model_executor/models/omnivoice/omnivoice_generator.py::{OmniVoiceGenerator._load_fused_projections,OmniVoiceAttention.forward,OmniVoiceMLP.forward,OmniVoiceTransformerBlock.forward,_OmniVoiceCUDAGraphForward}` →
    - `vllm_omni/model_executor/models/omnivoice/fused_qkv_rope.py::{fused_qkv_norm_rope,fused_cuda_supported,_eager_qkv_norm_rope}`

| 审查组 | 什么时候触发 | 规则 ID |
|---|---|---|
| `core` | 每次命中 OmniVoice generator 热路径或其 checkpoint/attention 测试 | `OMNIVOICE-1a` |

### [OMNIVOICE-1a] OmniVoice 生成器热路径必须保持 pack、加载、注意力与回退合同

- 触发：修改 OmniVoice 的 Q/K/V 或 gate/up projection、checkpoint loader、Q/K RMSNorm/RoPE、GQA、SwiGLU、residual threading、attention mask、CUDA graph，或 `fused_qkv_rope.py` Triton/eager 路径。
- 强制：checkpoint pack 顺序固定为 `qkv=[q,k,v]`、`gate_up=[gate,up]`；一旦某层开始 pack，缺少或仅出现部分 source shards 必须拒绝，不能让 fused parameter 保持随机初始化；未进入任何 fused-source group 的 shard 保持 generic loader 处理。attention prologue 只以 fp32 进行 Q/K RMSNorm、Q/K 权重计算与 Q/K RoPE，V 保持原 projection 值；
  - 随后按 GQA repeat K/V，并产出 contiguous `[batch, heads, sequence, head_dim]`（BHSD）。Triton 仅在 Triton 可用、CUDA tensor、QKV contiguous、head dim 为正的 2 的幂、Q 与 KV head 数都可被 8 整除且 GQA 可整除时启用；其他情况走 eager reference。residual 的加法/归一化代数不变，SwiGLU 保持 `silu(gate) * up` 的顺序。
- 验收：CPU 覆盖 pack order、全缺 source group 不触发 pack、任一 partial/missing 或错误 shape 拒绝，以及 eager 输出；CUDA+Triton 仅在上述 geometry 下对 eager reference 覆盖 fp32/fp16/bf16、Q/K norm+RoPE、未经变换的 V、正确 GQA index 与 contiguous BHSD；无 Triton、CPU、non-contiguous 或不合资格 geometry 必须回退。
  - mask 测试覆盖 `model_dtype` 的 bool True→`0.0`、False→`-inf`、float 原样保留和 graph replay；graph/eager 及 residual/SwiGLU 回归保持既有精度合同。A800 上的 float16/float32 性能和 CPU/CUDA 单测只构成该 PR 的有界证据，不构成广泛性能或支持承诺。 ^[PR #6317]

### [OMNIVOICE-2a] OmniVoice 请求批必须使用 packed varlen CFG 布局并按请求解码

- 触发：修改 OmniVoice pipeline/generator 的 request batch、step execution、CFG 输入布局、`cu_seqs`、CUDA Graph 键，或 codec decoder 批处理。
- 强制：声明 `supports_request_batch` 与 `supports_step_execution` 时，Generator 使用 token-major packed 布局 `[cond0, uncond0, cond1, uncond1, …]`，以 `cu_seqs` 表达 `2B` 条独立序列的累积边界，序列内双向、序列间互不可见；position id 按 `cu_seqs` 每段从 0 重置。
  - CUDA Graph 键为 `(request_batch_size, token_bucket)`，静态输入按 token bucket 与 `2B+2` `cu_seqs` 捕获。每请求保留独立 RNG，避免 Gumbel 流交叉。完成请求用**精确长度** codec token **逐条** decode；不得为迁就 Decoder 批处理而把已 exact-length 的 token 再 pad 到 longest。
- 验收：覆盖 packed `cu_seqs` 边界、per-request seed 隔离、graph key/bucket、step lifecycle，以及 exact-length 单请求 decode；WER/parity 报告须标明 layout 变更。deploy 批参数（如 `max_num_seqs` / `request_batch_max_wait_ms`）只证明该配置，不构成通用吞吐保证。^[PR #6408]

### [VLLM-OMNI-PR6105-INSTRUCT-VALIDATION] OmniVoice instructions 必须按封闭词表在 TTS adapter 校验

- 触发：修改 OmniVoice speech 的 `instructions` 输入、`tts_adapters/omnivoice.py` 的校验接线、`model_executor/models/omnivoice/prompt_utils.py` 的 `validate_instruction`/`prepare_instruct`，或 `instruct_constants.py` 的有效词表。
- 强制：instructions 是逗号分隔的封闭词表，有效项以模型目录的 `instruct_constants.py` 为唯一来源。分隔符不是输入校验的硬性要求：解析同时接受半角与全角逗号，“英文 comma + space、中文全角逗号”只是报错提示中的建议写法。校验在 request-facing 的 TTS adapter 完成，非法请求在进入 engine 前返回结构化 400。三类非法各自可识别：不支持/不存在的项返回 "Unsupported instruct items found"，且只有该错误附带两种语言的有效项列表与分隔符提示；
  - 同类别冲突项（如 teenager 与 middle-aged）返回 "Conflicting instruct items within the same category"；中文方言与英文口音混用返回 "Cannot mix Chinese dialect and English accent"；后两类报错不包含有效项列表或分隔符提示。校验通过后只把 `prepare_instruct` 的产物传给下游；offline 示例在写入 `mm_processor_kwargs["instruct"]` 前执行同一 validate→prepare 流程。
- 验收：`tests/model_executor/models/omnivoice/test_prompt_utils.py` 覆盖合法英文/中文与三类非法；`tests/e2e/online_serving/test_omnivoice_expansion.py::TestOmniVoiceInstructions` 断言合法英文/中文请求产出音频、三类非法各自返回 400 且匹配对应错误消息；
  - `tests/entrypoints/openai_api/test_serving_speech.py` 保持未知 voice 下 `_adapter` 为 OmniVoiceAdapter 的断言。^[PR #6105]

## 决策与踩坑

- [OMNIVOICE-1a] 禁止：改变 source shard packing 次序、接受 partial/missing pack group，或把没有 fused source 的整组 shards 误判为 partial；对 V 应用 Q/K norm 或 RoPE；重排 GQA 的 K/V 映射、返回非 contiguous BHSD；把 Triton 的存在或 CUDA 单项条件当作充分资格，或删除 eager fallback；为方便而给 generator mask 重新引入 fp32 默认。
  - 不得把本 PR 的 A800、CPU 或 CUDA 测试/性能证据外推为其他硬件、shape、后端或普遍 serving support。
- [OMNIVOICE-2a] 禁止：把 cond/uncond 或跨请求 pad 成 `[batch, codebook, max_seq]` 当作默认热路径；共享 batch 级 RNG；在未证明 pad-Decoder 更快前恢复 padded Decoder batching。不得把注意力/layout 变更后的输出宣称为与旧 padded 路径 bit-exact。
- [VLLM-OMNI-PR6105-INSTRUCT-VALIDATION] 禁止：把未校验的原始 instructions 直接送入 engine 或 `mm_processor_kwargs`；在 serving/adapter 内复制第二份有效词表；静默丢弃非法项或让 free-form 文本进入模型；以分隔符写法不符为由拒绝本可解析的请求；diffusion speech server 因 voice 未知而缺少 adapter（未知 voice 时 `_adapter` 应为 OmniVoiceAdapter 而非 None）。
