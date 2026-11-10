---
name: rules-runtime-hot-paths
description: "运行时热路径合同 EXEC-8a、EXEC-9a、EXEC-11a 至 EXEC-11h、EXEC-4f：GLM-TTS DiT Euler 循环不变条件只算一次、OmniVoice 固定输入缓存与 mask dtype / TF32、连续 AR 音频侧路 fp32 与正常终止、codec 逐请求帧账本、meta.sparse_audio marker 校验、model sampler fallback 与 penalty padding、逐请求 logits mask 窗口、STFT window buffer 迁移（CosyVoice3）、MiniCPM-o Talker codec penalty、CosyVoice3 finite logits 与 typed payload、单 token prefill 尾块不进 MTP（PR #7136）"
metadata:
  scope: 只收采样循环、热路径缓存、AR 音频侧路与 preprocess phase 的 EXEC-8a、EXEC-9a、EXEC-11a 至 EXEC-11h、EXEC-4f；runner 预处理合同总则与 EXEC-4e 归 model-executor-rules-2，跨 stage 合同归 rules-bridge-batch-1、rules-bridge-batch-2，其余审查组路由归 model-executor-rules-1
---
# 运行时热路径合同

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/model-executor/rules-runtime-hot-paths.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, model-executor；created: 2026-09-04；updated: 2026-09-08
- 来源（sources）：PR #4765；PR #5068；PR #5174；PR #5666；vllm_omni/worker/；PR #5452；vllm_omni/worker/sparse_audio.py；vllm_omni/worker/sampling_utils.py；PR #5048；PR #6424；PR #6454；vllm_omni/data_entry_keys.py；vllm_omni/model_executor/models/cosyvoice3/cosyvoice3.py
  - vllm_omni/model_executor/models/cosyvoice3/code2wav_core/hifigan.py；vllm_omni/model_executor/stage_input_processors/cosyvoice3.py；PR #6458；PR #6317；PR #7136
- 置信度（confidence）：high
- `EXEC-8a`、`EXEC-9a`、`EXEC-11a`–`EXEC-11h`：采样循环的不变量提取、固定输入缓存与掩码/精度边界，以及连续 AR 音频侧路和 codec 帧账本。触发条件与其余审查组见 [[model-executor-rules-1]]、[[model-executor-rules-2]]、[[model-executor-rules-3]]（model-executor 共享规则） 的 Direct 代码快速入口。
- [EXEC-8a] DiT Euler 采样循环必须只计算一次不变条件
  - 触发：修改 GLM-TTS flow-matching DiT 的 Euler 采样循环、文本 embedding、RoPE、block-causal mask、CFG batch，或新增预计算输入参数。
  - 强制：在每次 `_do_sample` 调用中只计算一次不随 timestep 或采样状态变化的 text embedding、RoPE、attention mask 和 CFG 双 batch 张量，并传入 DiT；同时保持 `seq_len`、设备、dtype 与 `forward()` 的合同一致，缺省参数仍保留原有调用行为。
  - 验收：覆盖 CFG/non-CFG 和 block-causal streaming 路径，验证预计算输入的长度、设备、dtype 与采样序列匹配，并以数值/字节一致性、输出 shape 及 profiling 证明循环内不再重复执行固定计算；确认非 streaming CUDA-graph 和未提供预计算参数的旧调用仍正常。 ^[PR #5068]
- [EXEC-9a] OmniVoice 热路径的固定输入缓存与掩码/精度边界
  - 触发：修改 OmniVoice 离散扩散生成循环中的 D2H 同步、attention mask、RoPE、文本/音频 embedding、CFG、CUDA graph/eager 路径或 TF32 配置。
  - 强制：将循环不变的文本 embedding、`audio_mask_3d`、RoPE 和 additive attention mask 在循环外缓存；批量取得 `c_lens` 并只在实际消费的 logits slice 上转为 fp32；普通缓存的 additive mask、CUDA graph capture buffer 与 replay 前 normalization 都使用 `OmniVoiceGenerator.model_dtype`。
    - CUDA graph 与 eager 使用相同的 float mask 语义：bool mask 必须将 True 映射为 `0.0`、False 映射为 `-inf`，已有 float mask 必须原样保留；TF32 只能通过显式配置 opt-in，并在 graph capture 前启用。
  - 验收：覆盖 eager 与 CUDA graph、bool 与 additive float mask、CFG/non-CFG 及不同 batch/concurrency，断言 masked 位置仍为 `-inf`、float mask 数值保留，三处 mask dtype 都等于 `model_dtype`，graph/eager 输出满足既定精度合同、每步无固定输入重算和逐请求同步；单独验证 `enable_tf32` 默认关闭且显式开启前后性能/非 bit-identical 语义有记录。 ^[PR #5174] ^[PR #6317]
- [EXEC-11a] 连续 AR 音频侧路必须保持 fp32、上下文与正常终止
  - 触发：vLLM-native AR 模型在每个 token/patch 旁路执行 DiT 或 flow-matching 采样、连续声码器解码，并通过 Omni multimodal output 输出增量音频。
  - 强制：Euler/ODE 累积状态保持 fp32，仅将 DiT matmul 输入置为模型 dtype；跨 patch 保留 causal decoder 的 streaming window，并在模型停止或容量边界通过正常 stop 信号前 flush lookahead；输出按 step 发 delta audio，并保留 `meta.sparse_audio` 等路由标记。
  - 验收：跨两次 engine restart 做 bit-identical/确定性探针，做跨 patch 首词与边界上下文验证；将容量缩小后确认请求正常截断且同一 engine 的下一次 generate 仍成功，并断言逐步 delta 合并后只有目标音频张量。^[PR #4765]
- [EXEC-11b] codec 音频流必须由逐请求帧账本驱动
  - 触发：native-AR 音频模型逐步产生多头 codec codes，按 chunk 解码并通过 sparse multimodal output 交付增量 waveform 时。
  - 强制：按 request id 保存 frame history 与 `emitted_frames` 账本；仅提交有效音频 frame；每个 decode window 带 lookback 并在裁剪后用实际 decode 结果推导 samples-per-frame；以原 request id 排队增量 payload，在 STOP 或预算最后一步、request 仍在输出 batch 时完成最终 flush，并保留 `meta.sparse_audio`。
  - 验收：CPU codec stand-in 覆盖跨 first/steady chunk 边界的完整帧拼接、lookback 和 partial final chunk；真实 runner 覆盖 mixed requests、sparse routing、预算尾部与 cleanup；GPU smoke 断言 waveform 样本数等于 committed frames 的实际 frame ledger。 ^[PR #5666]
- 相关执行流见 [[model-executor-architecture]]（model-executor architecture）；跨 stage 合同见 [[rules-bridge-batch-1]]、[[rules-bridge-batch-2]]（bridge/batch 规则）。
- [EXEC-11c] sparse 音频 marker 必须执行协议校验并在非法声明时 fail closed
  - 触发：修改共享 AR 音频输出、sparse multimodal routing、`meta.sparse_audio`/`meta.req_id` producer 或 consumer。
  - 强制：marker 只接受 list of strings 或 bare string，并用同一 literal truthy set 判定；nested 与 flattened encoding 必须同时解析，冲突、重复 id、不可用 id 或非法 carrier 必须记录并在 audio 路由 fail closed；任何 subset producer（包括 VoxCPM2 dense 分支）都必须声明按 `meta.req_id` 对齐。
  - 验收：覆盖 legal list/string、invalid audio/non-audio、unusable `req_id`、nested marker without id、nested/flat conflict、duplicate id、合法 sparse routing 与 VoxCPM2 coalesce/plain producer；并验证一次性 classifier error、rate-limited fail-closed error 和无 D2H 读取。 ^[PR #5452]
- [EXEC-11d] model sampler fallback 与 penalty padding 必须保持显式合同
  - 触发：模型声明 `prefer_model_sampler`，修改 runner 的 model sampler fallback，或调整 prompt ids 与 logits vocab 的 penalty 处理。
  - 强制：`model.sample()` 返回非 `None` 时直接采用；返回 `None` 必须回退默认 sampler 并通过 `warning_once` 保持可见；prompt padding 必须 clamp 到 `logits_vocab`，保留 upstream 的 padding bin 语义；新增 declarer 必须经过精确 assignment inventory 同意。
  - 验收：覆盖真实 declarer 的 None/非 None sampler、重复调用仅一次 warning、inventory 增删、padding 对 penalty mask 无影响，以及较窄 logits vocab 下未 clamp 会失败的边界。 ^[PR #5452]
- [EXEC-11e] 逐请求 logits mask 必须由 live history 与 batch identity 守住窗口
  - 触发：`compute_logits` 或 logits processor 按 request 的 sampling metadata 对前 N 个 decode step 施加 mask、penalty 或其他逐请求覆盖。
  - 强制：启用行为时请求并保留 `output_token_ids`；decode step 必须取每个 request 的 live history 长度，窗口严格使用 `step < N`，并按同一 batch 顺序结合 request mode；history 不得由独立 counter 代替，以保证 preemption/resume 不会重新触发窗口。metadata 或 req_id 长度不匹配、未分类 mode 和无法建立一行一请求映射时必须 warning 并 fail closed；没有早期目标行时跳过 device mask 分配。
  - 验收：覆盖默认关闭、step `0..N-1`、`step >= N`、mixed-step/mixed-mode batch、ICL/未记录 mode、缺失或空 `output_token_ids`、history/req_id mismatch、warning 去重与 preemption history 保留；确认无早期目标时不产生热路径 device allocation。^[PR #5048]
- [EXEC-11f] 音频 STFT 运行时窗口必须随模块迁移
  - 触发：模型的声码器或 HiFT 等 STFT 路径在 module `.to(...)`、多设备 stage 或 CUDA 推理中使用由 `__init__` 创建的运行时 tensor，尤其是子类绕过基类初始化时。
  - 强制：将不属于 checkpoint 的运行时 tensor 通过 `register_buffer(..., persistent=False)` 注册到实际消费它的 module，使常规 `.to(...)` 能迁移它；STFT use site 还必须在 window 与输入设备不同时迁移并把结果保留回 buffer，因为 dummy loader 可能不调用 weight-loading hook。
  - 验收：构造 CosyVoice3 `CausalHiFTGenerator`，分别覆盖 module `.to(cuda)` 与 dummy-loader 风格的首次 use-site mismatch，断言后续 `_stft/_istft` 复用同设备 buffer 并完成 causal inference；CPU 路径仍可运行，`persistent=False` buffer 不出现在 checkpoint state dict，并覆盖 subclass constructor。 ^[PR #6454] ^[PR #6424]
- [EXEC-11g] MiniCPM-o Talker codec penalty 与终止预算必须在 Sampler 前后闭环
  - 触发：修改 MiniCPM-o 4.5 Talker 的 codec 采样、repetition penalty、EOS/min_tokens 处理或离线生成长度预算。
  - 强制：在 Stage 1 Sampler 前按请求维护最近 16 个 codec frame，使用请求级 `repetition_penalty` 执行 frequency-aware penalty，并将 Sampler 的同一 penalty 置为 `1` 避免重复计分；离线生成上限取 `min(2048, remaining Talker context)`。对 `compute_logits` 强制的 codec EOS 必须在 `MinTokensLogitsProcessor` 之后恢复到对应采样行；
    - native duplex 仍按既有 `generate_chunk` 的 26-sample 预算执行。
  - 验收：覆盖正负 logits、空 history、超过 16 frame 的遗忘、`no_penalties`、逐请求 penalty 与单次消费；覆盖 forced/unforced EOS、`min_tokens`、2048 上限和剩余 context clamp，并用真实长文本 TTS 检查请求在预算边界释放且无静默尾部。^[PR #6458]
- [EXEC-11h] CosyVoice3 sampler 与 stage handoff 必须保留有限 logits 和 typed nested payload
  - 触发：修改 CosyVoice3 talker sampling、RAS fallback、outer transformer config，或跨 stage 的 `additional_information` serializer/decoder。
  - 强制：在 request mask 与所有 logits processor 后只让 finite logits 参与 sampling；整行无 finite candidate 必须显式失败，RAS 为唯一合法 token 恢复时保存 clone 的 score。outer config 的 attention/KV-head metadata 必须与实际 nested Qwen checkpoint 一致。
    - tensor payload 用 raw bytes、recorded PyTorch dtype 与 shape round-trip，并经 shared decoder 重建 nested dotted keys，再由 stage processor 消费。
  - 验收：覆盖 NaN/±inf、全非有限行、唯一合法 token 的 RAS fallback 和 14 query/2 KV config；BF16 payload 必须 bit-exact 并在 async handoff 中保留 `embed` conditioning；固定 seed 的 token 序列不得被拿来与旧 `torch.multinomial` 比较。当前实现把 `+inf` 也排除，并在整行无 finite candidate 时从 `sample()` 抛错、可能终止整个 EngineCore；
    - 这两项是 review 接受的 follow-up 风险，不能描述成 per-request 隔离或通用正无穷采样语义。^[PR #6424]
- [EXEC-4f] 单 token prefill 尾块必须保留 preprocess，不得当 decode/MTP
  - 触发：修改 runner `_preprocess` 的 `_omni_prompt_len` / `_omni_num_computed_tokens` / `_omni_is_prefill`、phase 路由、normal/batched MTP eligibility，或自定义 AR talker 的 chunked-prefill 行为。
  - 强制：上述字段为 Python `int`/`bool`，按真实 prompt 进度逐行生产。长度为 1 的 **prefill** 行（含 chunked prefill 的最后一 token）必须保留 preprocess embedding，且不得进入 runner-managed MTP；只有单 token **decode** 行才可走 MTP。out-of-tree 模型虽见下划线前缀，仍按公开 contract 消费。
  - 验收：直接调用生产 `_preprocess`，在 mixed batch 中对照应/不应进入 MTP 的行，覆盖单 token prompt/tail、cached progress、normal/batched hooks；真实权重 E2E 至少锁一条 one-token prefill tail。^[PR #7136]

## 决策与踩坑

- [EXEC-8a] 禁止：在每个 Euler step 重复构造上述固定输入；让预计算 embedding 或 RoPE 在长度不匹配时静默继续；改变原有 mask device、模型 dtype 或 block-causal 语义；把 eager streaming 路径的优化结论外推为 CUDA-graph 路径或其他模型的通用结论。
- [EXEC-9a] 禁止：每步重复计算固定输入或执行逐请求 D2H `.item()`；为 additive mask 恢复 fp32 默认值、对 float mask 使用布尔反转，或把 bool 直接隐式转换进 float buffer；让 graph capture 与 replay 使用不同 mask dtype；默认开启或宣称 TF32 路径 bit-identical；只更新 conditional 或 unconditional 一侧的迭代 token。
- [EXEC-11a] 禁止：以 bf16 作为多步积分默认累积 dtype；每个 patch 独立零填充解码；容量耗尽时 raise 使 engine 失效；停止时丢弃 decoder 尾部，或让 scaffold hidden 通过默认 multimodal merge 混入音频。
- [EXEC-11b] 禁止：在裸 chunk 边界解码、假定标称帧率或固定 hop、每帧解码或每次发送完整历史；把尾部音频放进 finished cleanup；让已离开输出 batch 的 request 继续产生不可路由 payload，或以 pooler/hidden state 充当音频。
- [EXEC-11c] 禁止：对 tensor/ndarray/number marker 做元素读取或归一化、把非法 sparse declaration 降级为 dense、静默抹掉 nested marker，或发送未声明 alignment 的 subset 音频列表。
- [EXEC-11d] 禁止：把合法的 `None` fallback 当作采样失败、无日志静默吞掉意外 fallthrough，或 clamp 到 `logits_vocab - 1` 使 padding 被计作最后一个真实 token。
- [EXEC-11e] 禁止：把 mask 应用于整个 batch、假定普通采样总会填充 history、用本地 counter 在恢复后重启 ban，或在 spec decode 的多行映射下按位置读取 mode；不得静默吞掉形状不一致而继续按错误 request masking。
- [EXEC-11f] 禁止：把设备敏感 tensor 留作普通 attribute，只在 weight-loading hook 迁移，或每次返回一个不保留的一次性 `.to(device)` 结果；不得只修基类初始化而遗漏 causal/subclass 路径，也不得把派生 window 写入 checkpoint state dict。
- [EXEC-11g] 禁止：把 vLLM whole-stream presence penalty 当作上游 16-frame codec penalty；让 forced EOS 被 `min_tokens` 再次屏蔽后以任意 codec id 继续解码；让无 EOS 的离线请求占满剩余上下文；用本次 simplex 修复改变 native duplex chunk 语义。
- [EXEC-11h] 禁止：把 NaN/±inf 变为可采样的均匀分布、从 all-`-inf` softmax 继续抽样、让 outer config 静默退回 query-head 数作为 KV-head 数，或以 NumPy/flat dotted-key local decoder 代替 shared typed serialization。
- [EXEC-4f] 禁止：用当前 span 长度把 one-token prefill 当成 decode；只在模型 helper 手喂 metadata 却不测 runner producer；或把该合同当成已为所有模型开启 chunked prefill。
