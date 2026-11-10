---
name: rules-bridge-batch-1
description: 跨 stage bridge 与 batch 合同（1/2）EXEC-1a 至 EXEC-1i：producer 字段到下一 stage consumer 的追踪、batch stage 逐请求消费 runtime_info、request-local RNG 跨 batching/yield、embedding buffer 按 get_inputs_embeds_size() 的 ingress width 分配、upstream registry 重名时的 Omni override、MediaWithBytes 与 hash algorithm 传播、request-end payload 延迟 D2H、pooling stage 显式 bridge、有状态 AR bridge 按 request 累积
metadata:
  scope: 只收 bridge-batch 审查组的 EXEC-1a 至 EXEC-1i；EXEC-1j 至 EXEC-1q 见 rules-bridge-batch-2，触发条件与其余审查组的代码路由归 model-executor-rules-1，loader 与 checkpoint 合同 EXEC-2x 归 rules-loader-contract
---
# 跨 stage bridge 与 batch 合同（1/2）

## 关键事实

- 拆分说明：本页是源页 `rules-bridge-batch.md` 的第 1/2 部分；第 2 部分 [[rules-bridge-batch-2]]
- 源页：`knowledge/repos/vllm-omni/components/model-executor/rules-bridge-batch.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, model-executor；created: 2026-09-04；updated: 2026-09-05
- 来源（sources）：PR #3422；PR #3642；PR #4795；PR #5073；PR #5074；PR #5310；PR #5792；PR #5842；PR #5957；PR #5976；PR #6422；vllm_omni/worker/gpu_ar_model_runner.py；vllm_omni/worker/gpu_model_runner.py；vllm_omni/model_executor/models/higgs_audio_v3/higgs_audio_v3_talker.py；vllm_omni/core/sched/output.py
  - vllm_omni/utils/mm_outputs.py；tests/model_executor/models/higgs_audio_v3/test_higgs_audio_v3.py；PR #4765；PR #5666；PR #5491；PR #6186；PR #5452；vllm_omni/worker/output/payload_build.py；PR #6406
- 置信度（confidence）：high
- `bridge-batch` 审查组的 `EXEC-1a`–`EXEC-1i`：runtime info、跨 stage payload、batch 与 request RNG。触发条件和其余审查组见 [[model-executor-rules-1]]、[[model-executor-rules-2]]、[[model-executor-rules-3]]（model-executor 共享规则） 的 Direct 代码快速入口；loader 与 checkpoint 合同留在该页的 `EXEC-2x`。
- [EXEC-1a] 从 producer 字段追到下一 stage consumer 和最终输出包装
  - 触发：新模型、多阶段 pipeline、stage wrapper、runtime info 或 multimodal payload。
  - 强制：逐段记录 runner 写入字段、传输后的字段名/shape、下一 stage 读取位置，以及最终 `OmniOutput`/multimodal payload 的包装。loader 或模型 class 单独可调用不能代替真实 stage handoff。
  - 验收：测试从真实 stage wrapper 输入开始，断言下一 stage 收到逐请求字段并得到公开输出类型。MiniCPM-o 的具体合同见 [[minicpm-o-4-5-rules-1]]、[[minicpm-o-4-5-rules-2]]、[[minicpm-o-4-5-rules-3]]（MiniCPM-o 4.5 规则）。 ^[PR #3642]
- [EXEC-1b] stage 声明 batch 能力就必须逐请求消费 runtime info
  - 触发：`max_num_seqs > 1`、batch handoff 或 wrapper 接收 `runtime_info` 列表。
  - 强制：输出按请求索引与输入一一对应；无法安全逐请求处理时把并发上限显式收紧为 1。
  - 验收：至少两个不同输入的同批测试，分别断言 bridge、输出和错误归属；不能重复相同 prompt 让串线不可见。partial downstream subset 必须保留原 `req_id_to_index`：跳过中间请求后，后续请求的 tensor slice 和 list-valued payload 仍取原 batch index，不能压缩到 downstream position。 ^[PR #3642] ^[PR #5310]
- [EXEC-1c] 请求随机状态跨 batching 和 yield 保持请求所有权
  - 触发：AR/talker adapter 接收 seed/sampling knob，或修改 batch compaction/reorder、逐 token loop。
  - 强制：请求值在 adapter/model 构造前到达真实 sampling consumer；使用 request-local generator。若依赖必须临时改 global RNG，只能在无 yield 的窄上下文 save/restore。
  - 验收：同 seed 同输出、异 seed 不同输出，batch reorder/compaction 后逐请求结果稳定；全局 RNG 前后相同，计数器证明目标分支实际消费请求参数。 ^[PR #3422] ^[PR #5074] ^[PR #5792] Higgs V3 将每请求的八个 codebook rows 对齐扩展至 `SamplingMetadata.generators`，并把 GPU decode delay state 以 request ID（非临时 batch row）保存；
    - finished/replacement 同 ID 时缺失 pool entry 必须触发重同步。^[PR #6422]
- [EXEC-1d] cross-stage embedding buffer 必须按 ingress width 分配
  - 触发：stage 的输入 embedding 在 model forward 或 preprocess 内投影，或修改 shared AR runner 的 `inputs_embeds` buffer。
  - 强制：buffer second dimension 来自 `model_config.get_inputs_embeds_size()`；它表示进入 stage 时的 pre-projection width，与内部 `hf_text_config.hidden_size` 分开。没有 stage override 时 helper 必须回退到内部 hidden size，保持其他 AR stage 的既有行为。
  - 验收：至少一个 ingress≠internal 的正向 case 与一个无 override control，断言真实 buffer shape 和 projection consumer。Qwen2.5 Talker 当前接收 3584-wide Thinker state，并在 forward 内投影到 896；Qwen3 在 preprocessing 先投影，因此走 hidden-size fallback。PR #5073 的最终单测只有 Qwen3 control，没有直接钉住 Qwen2.5 正向 buffer，后者仍是回归缺口。^[PR #5073]
- [EXEC-1e] upstream registry 重名时 Omni override 与 plain-vLLM forward 必须同时成立
  - 触发：上游开始注册 Omni 同名 architecture，或 model runner/forward/capture/dummy-run 接口变化。
  - 强制：全局 registry 无条件重注册 Omni owner；非 staged 模式为 Qwen Omni 选择 thinker，并返回 stock runner 可消费的 bare tensor；只有 staged talker consumer 存在时才 capture hidden layers。runner override 必须接受上游新增 kwargs；text/MoE dummy input 可按 upstream 要求 randomize，但 code2wav 等结构化 codec id 只能接受参数而不得随机化。
    - worker profiling 同步保存上游新增结果字段。
  - 验收：registry collision 解析到 Omni class；Qwen2.5/Qwen3 plain thinker 与 staged capture 分别断言 output shape，PP intermediate 原样透传；dummy-run 覆盖 text randomize 与 generation no-randomize，并对 profiling result 做字段 parity。^[PR #5976]
- [EXEC-1f] multimodal wrapper 与 hash algorithm 必须通过 live context 传播
  - 触发：upstream multimodal input 开始保留原始 bytes、修改 hash 签名或 processor item wrapper。
  - 强制：所有 `get_mm_hashes` / direct `MultiModalHasher.hash_kwargs` 调用传当前 multimodal config 的 algorithm；processor 通过公开 `get(index)` 解包 `MediaWithBytes`，再把 frames/metadata 交给 HF。
  - 验收：不同 algorithm 进入 hash consumer；wrapped/unwrapped video 都生成同一 HF input，metadata 保留；stage+replica scope 只包裹 base UUID 且用户 UUID 优先。^[PR #5976]
- [EXEC-1g] request-end payload 延迟 D2H 必须先取得 device snapshot
  - 触发：模型设置 `omni_payload_at_request_end`，或修改 full-payload accumulation、CUDA graph 和 D2H 策略。
  - 强制：只在显式 opt-in、无 prefix cache 且下游消费完整 payload 时延迟 D2H；每步 clone device tensor，相容 list 可 pack 后以 views 复原，结束才跨设备，中间 output 为 `None`。
  - 验收：覆盖 source 被下一 step 覆写、ragged list shape/value/alias、普通路径与 finish/abort 清理。^[PR #5957]
- [EXEC-1h] pooling stage 的输入输出必须走显式跨 stage bridge
  - 触发：新增非生成 pooling stage，或在 batch pipeline 中跨 stage 传递音频、文本、multimodal payload 与解码结果。
  - 强制：producer 只在上游请求完成后按原 request index 构造输入，分词一次并随音频携带 `aligner_words`、language 和真实 duration；pooling runner 识别 `is_pooling_model`，绕过仅适用于 AR hidden state 的 Omni prefix-cache/mm 提取，decoder 输出固定的 int32 `[n_words, 2]`；最终 consumer 使用同一份 words、duration 和原 batch 映射。
  - 验收：用真实 stage wrapper、`PoolingOutput` 和 `OmniRequestOutput` 做 mixed-batch 测试，分别断言音频完成门槛、metadata/shape、duration clamp、原 request 标签和 mismatch→无时间戳；同时验证普通生成 stage 的输入输出不受影响。^[PR #4795]
- [EXEC-1i] 有状态跨 stage AR bridge 必须按 request 累积并完整消费 payload
  - 触发：多 stage AR 模型在 `preprocess` 中按 request 保存 KV、音频帧或 TTS 状态，并通过 connector 传递累积 timeline/code payload。
  - 强制：以 request id 隔离 session；无法证明 batch-safe 时显式限制 `max_num_seqs=1` 并在 request 完成/abort 时清理；下游每次采用累积 payload，单次 wake drain 所有尚未消费的位置，prompt-region 状态也必须先推进；code2wav 只接受真实 `[frames, 31]` codec codes。
  - 验收：覆盖 delayed/coalesced chunks、首个 PAD prompt chunk、zero-progress wake、最终 marker、缺失 payload、flat/二维 code shape、越界 code 与 session cleanup；断言 talker 与 code2wav 的真实输出字段和音频类型。^[PR #5842]
- 相关执行流见 [[model-executor-architecture]]（model-executor architecture）；scheduler 侧的对应合同见 [[scheduler-rules-1]]、[[scheduler-rules-2]]（scheduler 规则）。

## 决策与踩坑

- [EXEC-1a] 禁止：让 tuple waveform/hidden state 依赖 runner 的隐式猜测；bridge key 不一致时用 fallback 掩盖。
- [EXEC-1b] 禁止：只消费 `runtime_info[0]`，或把单元素 waveform/metadata 广播给整个 batch。
- [EXEC-1c] 禁止：deploy 默认覆盖请求 seed；共享 generator；每步复制完整历史或创建无界 `batch*vocab` 临时量；global RNG 状态跨 yield 泄漏到兄弟请求。
- [EXEC-1d] 禁止：把内部 hidden size 当跨 stage wire shape；反过来用某模型的外部宽度扩大所有 stage；只测 config helper 而不覆盖发生宽度差异的正向 runner/model path。
- [EXEC-1e] 禁止：因 upstream 已有同名 arch 就跳过 Omni 注册；plain serve 返回 staged tuple；把 vocab-uniform id 喂给 codec codebook；用 `**kwargs` 隐藏未审查的签名漂移。
- [EXEC-1f] 禁止：直接遍历 `.data` 绕过 unwrap；让 stage/replica UUID 前缀替代 content hash algorithm；只修一个模型而不 census 自定义 processor 与 direct hasher caller。
- [EXEC-1g] 禁止：累计 graph/input-buffer alias，或扩散到普通逐步 payload。
- [EXEC-1h] 禁止：把 pooling 请求当作 `generate` 或隐式广播单请求 metadata；按 downstream position 压缩原 batch index；重新分词后与 interval 做未验证的 positional zip；把空结果、解码失败或缺失 word metadata 伪装成 `[0, 0]` 的有效对齐；假设真实 `OmniRequestOutput` 暴露测试 fake 才有的 `additional_information`。
- [EXEC-1i] 禁止：按一个 wake 只执行一个新位置；把延迟或合并的 chunk 当作只含一个 token；缺失 connector payload 时把 placeholder `input_ids` 当 codec codes 解码；用静默截断或 clamp 掩盖错误 shape/range。
