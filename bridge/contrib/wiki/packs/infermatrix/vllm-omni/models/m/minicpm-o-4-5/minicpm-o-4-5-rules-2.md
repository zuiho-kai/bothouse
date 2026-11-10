---
name: minicpm-o-4-5-rules-2
description: "MiniCPM-o 4.5 规则（二）：MCPMO-2c vision unpadding metadata 只在同一次 encoder forward 内复用（PR #5165）、2d Whisper 流式缓存兼容 Transformers 新旧 API（PR #6274）、3a TTS batch 与 runtime_info、3b wrapper 与 OmniOutput、3c Talker 批量 logit 与逐请求 RNG（PR #5792）、3d Talker codec 采样闭环（PR #6346）、4a native duplex 保留可恢复 Stage0 与 VAD 策略（PR #6056、PR #6154、PR #6170）"
metadata:
  scope: 只收 MCPMO-2c/2d/3a/3b/3c/3d/4a；快速入口与 MCPMO-1a 至 2b 归 minicpm-o-4-5-rules-1，MCPMO-4d、5a、5b 等归 minicpm-o-4-5-rules-3，turn_eos 后的 LISTEN 归 rules-duplex-turn-closure
---
# MiniCPM-o 4.5 规则（2/3）

## 关键事实

- 拆分说明：本页是源页 `rules.md` 的第 2/3 部分；第 1 部分 [[minicpm-o-4-5-rules-1]]；第 3 部分 [[minicpm-o-4-5-rules-3]]
- 源页：`knowledge/repos/vllm-omni/models/minicpm-o-4-5/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, model-executor；created: 2026-07-20；updated: 2026-09-22
- [MCPMO-2c] vision unpadding metadata 只在同一次 encoder forward 内复用
  - 触发：修改 MiniCPM-o 4.5 SigLIP FlashAttention mask、`_get_unpad_data`、Q/K/V layout 或 encoder layer 调用链。
  - 强制：只有 FlashAttention2 且 `attention_mask is not None` 时，`SiglipEncoder.forward` 才从当前 mask 计算一次 `(indices, cu_seqlens, max_seqlen)`，并把同一 tuple identity 传给该次 forward 的所有 encoder layers。下一次 forward 必须从新 mask 重算；不得做 global、实例级或 cross-request cache。
    - 直接调用 `SiglipFlashAttention2` 且未传 metadata 时，`_upad_input` 保留 per-call fallback；dense mask=None path 不计算 metadata。显式传入的 metadata 不会校验是否与 `attention_mask` 匹配，因此 custom/direct caller 必须成对持有；安全 owner 是 encoder 当前 forward 的 mask，禁止外部或 stale cache。
  - 强制：metadata 复用必须保持 padded batch 输出与逐 sample unpadded、以及逐 layer 重算 path 数值一致。Q/K/V projection 的 view→transpose→transpose 原本就形成共享 projection storage 的 contiguous BSHD；本 PR 没改 layout，新 storage/stride test 只是冻结该既有 zero-copy 合同，不能把它计入 metadata 优化收益。
  - 验收：CPU spy 覆盖 padded 一次、dense 零次、不同 mask 重算与 tuple identity；L4/FA2 BF16 覆盖 encoder reuse 对 per-layer recompute bitwise parity、unpadded 对 eager、两种 padding 程度对逐 sample unpadded（容差 2e-2）。
    - PR 的 2×RTX PRO 6000 Blackwell、27 layers、5 warmups、30 paired samples 中 varlen 约 21.697→13.790 ms / 22.162→14.113 ms，只绑定测试 commit `895cb303`、该环境与 vision-encoder latency；作者说明 rebase 后 source-file hash 未变，但它仍不是 merge target 的 end-to-end 复测。dense/equal-length video 不计算 metadata且近零变化。
    - 当前测试未覆盖 `gradient_checkpointing and training`：新 tuple（两 tensor + Python int）会作为位置参数穿过 `_gradient_checkpointing_func`，补该 path 前不能假设训练/checkpoint 兼容。^[PR #5165]
- [MCPMO-2d] Whisper 流式音频缓存必须兼容 current 与 legacy Transformers API
  - 触发：MiniCPM-o 4.5 Whisper/APM 音频编码器需要在 Transformers 版本变化后复用流式 chunk 的 attention cache。
  - 强制：根据 `self_attn.forward` 签名选择 `past_key_values` 或旧版 `past_key_value`；读取缓存长度时优先支持 `self_attention_cache.get_seq_length()`，兼容需要 layer 参数的实现，并回退到 legacy tuple 的 key shape；当当前 attention 返回值没有 cache 项时保留传入 cache。
  - 验收：覆盖 legacy/current attention 参数名、`EncoderDecoderCache`/`DynamicCache`、legacy tuple 和两种 `get_seq_length` 签名；连续编码两个 chunk 时缓存长度正确增长，输出与无缓存编码有可观察差异，并通过 MiniCPM-o 4.5 streaming/duplex 回归验证首响应和中断行为。 ^[PR #6274]
- [MCPMO-3a] TTS stage 的 batch 能力与 runtime_info 消费一致
  - 触发：talker/TTS stage 的 `max_num_seqs`、batching 或 runtime bridge。
  - 强制：若实现只安全消费一条 runtime info，将上限设为 1；开放 batch 前逐请求处理并证明输出不串线。
  - 验收：两个不同文本/voice 的同批测试分别产生对应音频；未支持前配置拒绝 batch>1。 ^[PR #3642]
- [MCPMO-3b] wrapper 接收 bridge 并显式包装 OmniOutput
  - 触发：LLM/thinker → TTS stage handoff 或 TTS class 返回 waveform。
  - 强制：stage wrapper 读取 runner 实际写入的 bridge 字段，模型输出包装到明确的 `OmniOutput`/multimodal key。
  - 验收：真实 wrapper handoff 测试断言字段名、逐请求 shape、最终公开 payload。 ^[PR #3642]
- [MCPMO-3c] Talker 批量 logit 处理必须保留逐请求采样与输出索引
  - 触发：修改 Talker `make_omni_output`、codec projection、repetition penalty、top-k/top-p、multinomial、terminal 或 compaction。
  - 强制：只把有效 span、未 finished 且 sampling-eligible 的 row 收集为 pending samples；一次批量执行 head projection、frequency-aware repetition penalty、top-k/top-p 与 softmax。每个 pending item 必须携带原 `output_index`、request ID、history、step 与 state，采样结果再按该原索引写回 codec delta、terminal 和 stop row。
    - 无效 info/span 与 incomplete prefill 保持 continue、空 delta，且不推进 request RNG/state；此前或本次 terminal 的请求才 stop。
  - RNG：`torch.multinomial` 每次只接收一个 generator，因此必须保留逐 row 调用各自 request-local generator；禁止为了完全向量化而改成共享 generator。batch reorder、其他请求结束和 compaction 均不得改变单请求序列。所有 row 采完后再把 concatenated tensor 一次搬到 CPU `.tolist()`，避免逐请求 `.item()` 同步。
  - workspace：repetition penalty 可保留 full-batch logits/result，但 encoded history 与 `bincount` 必须最多按 16 rows 分块；token 编码为 `token + local_row*vocab`，count minlength 只到 `chunk_rows*vocab`，使 int64 count 临时空间不随总并发一次放大。
    - penalty=1 与空 batch 保持 fast path，logits 必须为 2D且 histories/request IDs/steps 与 batch row 数一致。
  - 验收：逐 row oracle 对比正负 logits 与空 history，跨 16/16/1 chunk 固定 bincount workspace；reorder、compaction 与 standalone 对照 request RNG；mixed eligible/ineligible/finished rows 断言原索引 delta、stop、EOS/min/max token、duplex metadata 和只调用一次 batched sampler。
    - CPU 单测证明这些离散合同，但没有硬件上的 batched GEMM/logit 与旧 serial GEMV 数值/音频 parity；PR 也没有 NPU concurrency 1/4 的 latency、吞吐或内存数据，因此不得宣称性能或质量不变/提升。^[PR #5792]
- [MCPMO-3d] Talker codec 采样必须由 Stage 1 Sampler 与 codec 词表闭环
  - 触发：修改 MiniCPM-o 4.5 Talker 的 codec 采样、词表、EOS、prompt penalty 或 Stage 1 sampling 参数。
  - 强制：`ConditionalChatTTSConfig` 暴露 `vocab_size=num_audio_tokens`、`eos_token_id=num_audio_tokens-1`；完整采样项由 Stage 1 `default_sampling_params` 提供，缺项初始化失败；`head_code`、`emb_code` 与 `codes.audio` 按采样 id 闭环，Sampler 前将 scheduler prompt 全置为 `vocab_size`。
  - 验收：配置、pipeline EOS、prompt 不变、codec delta/empty EOS 单测通过，并用长文本真实 text+audio/ASR 检查完整输出。 ^[PR #6346]
- [MCPMO-4a] native duplex 保留可恢复 Stage0，VAD 只作显式策略
  - 触发：MiniCPM-o native duplex 的连续音频、LISTEN/SPEAK handoff 或 server VAD interruption。
  - 强制：模型说话时仍把音频单元追加到同一可恢复 Stage0，保留 KV/runtime state 和上一 terminator；仅确认的 empty/control-only handoff 可在没有 speech conditioning 时跳过，其他缺 latent/hidden-state 的 speech handoff 仍报错。plain LISTEN 是成功且不需要 Talker hidden state；
    - 含 turn_eos 的 speech-closure LISTEN 仍须转交 Talker，边界见 [[rules-duplex-turn-closure]]（turn closure）。默认模型拥有的模式固定为 `listen_only`，不会创建/调用 Silero；只有 `turn_detection.type=server_vad` 且 `interrupt_response=true` 才选择 `barge_in_on_speech`，并拒绝 `interrupt_response=false` 的第三模式。
    - server VAD hard cancellation 必须显式 opt-in，阈值不得落到使 silence branch 不可达的边界。
  - 验收：native case 完成响应≥2、cancel/truncate=0、listen≥1；opt-in hard interrupt 恰好一次 terminal、epoch fence 后无 stale delta，且新 epoch 保留 interrupt PCM/confirming pre-roll、后续响应消费该语句并成功。
    - Realtime `session.update` 先暂存 VAD candidate，只有 matching runtime ACK 才 commit，任何 rejected/failed append/config path 都必须 correlated error 后 discard，不能让 unrelated outbound error 提交它或让 reader 卡住。response-required fixture 若要求每轮 SPEAK，应重放已验证的完整 active-speech window；
    - 任意较短 mid-utterance slice 合法返回 LISTEN，不能把它当模型失败或修改生产决策阈值。`threshold=0.15` 的 validator boundary assertion 在 merge 时缺失，是后续测试补强，不是本提交已实现的覆盖；#6821 的 playback ACK/history 修复也在本精确提交之外。 ^[PR #6056] ^[PR #6154] ^[PR #6170]

## 决策与踩坑

- [MCPMO-2c] 禁止：把 mask shape 相同当成内容相同而跨 forward 复用；将该局部优化泛化成 dense image、equal-length video、端到端 serving 或 throughput 提升。review 中短暂加入的 profiler scripts/raw JSON 已在 final commit history 删除，不是仓库内可复现 benchmark fixture。
- [MCPMO-2d] 禁止：固定传入已被新 API 吞入 `**kwargs` 的旧参数名；调用已移除的 `get_usable_length()`；依赖 experimental 模块的全局 monkey patch 才能读取缓存；把当前 API 返回的两项结果误解为应清空已有 cache。
- [MCPMO-3a] 禁止：读取 `runtime_info[0]` 后把请求 0 的音频广播到全批。
- [MCPMO-3b] 禁止：直接 TTS class 不读 runtime bridge；返回 tuple 让 runner 猜它是 hidden state。
- [MCPMO-3d] 禁止：从 `tts_config` 回退或硬编码 codec knobs；把 Thinker token/embed 或 scheduler 占位符当作 codec history；丢失 sampled id 或让 EOS 不可达。
- [MCPMO-4a] 禁止：用 server VAD cancellation 冒充 native interruption；每轮重建 Stage0；让 LISTEN 因无 Talker payload 失败；将 Qwen3-Omni 的 turn-based server-VAD endpointing/auto-commit 合同混同为本 MiniCPM native-barge-in 行为。
