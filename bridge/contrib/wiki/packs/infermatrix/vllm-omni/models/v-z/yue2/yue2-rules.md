---
name: yue2-rules
description: "YuE2 synthesis 与完成边界规则：YUE2-SYNTH-1a（HOLD、synthesis 队列、buffer lifetime）、YUE2-SYNTH-1b（完成音频跨 scheduler 终态确认）、PR #8851 sampler 测试削减不得丢边界覆盖，含代码快速入口表"
metadata:
  scope: 只收 YUE2-SYNTH-1a、YUE2-SYNTH-1b 与 VLLM-OMNI-PR8851-YUE2-SAMPLER-COST 及快速入口表；请求/tokenizer/数值合同归 rules-interface，SheetSage2 score handoff 归 rules-score-handoff
---
# YuE2 synthesis 与完成边界规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/yue2/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, model-executor；created: 2026-10-06；updated: 2026-10-13
- 来源（sources）：PR #8407；PR #8851
- 置信度（confidence）：high

### Direct 代码快速入口

| PR 描述信号 | 规则组 | 第一批源码 |
|---|---|---|
| HOLD、side-stream synthesis、cancel、preemption、完成音频重交付 | `YUE2-SYNTH-1a`、`YUE2-SYNTH-1b` | `vllm_omni/model_executor/models/yue2/yue2.py` 的 `_SynthesisJob`、`_SynthesisQueue`、`_ship_audio`；`tests/worker/test_yue2_request_state.py` |
| speech/native tokenizer、lyrics/style/ABC、frame budget | [[rules-interface]]（请求合同）：`YUE2-INPUT-1a` | `vllm_omni/entrypoints/openai/tts_adapters/yue2.py::Yue2Adapter`；`vllm_omni/tokenizers/yue2_prompt.py`、`vllm_omni/tokenizers/yue2_tokenizer.py` |
| MoT weight mapping、whole-song noise、NAR、FP32 tiled VAE | [[rules-interface]]（数值合同）：`YUE2-NUMERIC-1a` | `vllm_omni/model_executor/models/yue2/yue2.py` 的 `partition_checkpoint_weights`、`song_chunks` 与 VAE decode |
| SheetSage2、ABC/MIDI、offline snapshot、speech request export | [[rules-score-handoff]]（Score handoff）：`YUE2-SCORE-1a` | `tools/sheetsage2_transcribe.py`；`tests/tools/test_sheetsage2_transcribe.py` |

### [YUE2-SYNTH-1a] side-stream synthesis 的 HOLD、队列和 buffer lifetime 必须闭合

- 触发：修改 `_SynthesisJob`/`_SynthesisQueue`、HOLD budget、request admission 或 preemption history reconciliation。
- 强制：通过模型 opt-in hook 接收每个 request 的 sampling extra args/discard 状态；synthesis queue 串行运行 song job，并限制已提交但未完成的 work units。HOLD 只在 CUDA、预算和上下文 headroom 都允许时发出，HOLD 不进入 codec history；无 HOLD headroom 或预算用尽时允许在 finishing step 等待同一 synthesis queue。
  - 取消/错误后停止新提交，并在本 job 已提交 kernel 完成后才释放其 graphs、buffers 和 generator。
- 验收：覆盖 HOLD/zero-budget、排队取消、active 取消、history rollback 和资源回收；用实际模型 admission 测试与 eager/AR-graph、chunked/unchunked lifecycle case 分别证明路径，graph 声明须断言对应 replay counter。^[PR #8407]

### [YUE2-SYNTH-1b] 完成音频必须跨过 scheduler 的终态确认边界

- 触发：修改 YuE2 `_ship_audio`、finished row、`end_len` 或完成 step 的 preemption/replay。
- 强制：保留已完成音频和对应终止 token，直到 scheduler 接受该 end boundary。若完成 step 的输出被丢弃、resumed row 的 accepted count 尚未到 `end_len`，重新交付保留的音频与 end token，复用已完成 synthesis；非丢弃的完整 accepted sequence 才能作为 history reconciliation 边界。
- 验收：确定性回归让 scheduler 丢弃交付 step，恢复后仍得到同一音频/end token且只完成一次 synthesis；再覆盖真实 eager/graph preemption、取消与后续请求恢复。^[PR #8407]

### [VLLM-OMNI-PR8851-YUE2-SAMPLER-COST] 削减全词表一致性循环不得丢失边界覆盖

- 触发：以缩短 CI 时长为由修改 `tests/worker/test_yue2_sampler.py`（或同类在 CPU 上对全词表做逐行 `torch.multinomial` 一致性比对的测试）的循环步数、`min_tokens` 或 preset 默认值覆盖。
- 强制：步数削减必须由行为跨度论证：先断言生产默认值（ABC `min_tokens` 32、semantic 200），再替换成小于循环步数的 floor，使循环首步仍处于 end-token block、末步已释放；被门控路径须有独立确定性测试（temperature=0、手工构造 logits 令 end token 得分最高）证明 history 不足时被屏蔽、达到 floor 后放行；填满 semantic penalty window 的长-history alone-vs-batch case（60 token）不得随削减被删。
- 验收：缩减后每步仍对全部 184704 列对比 batched draw 与 `torch.multinomial` 并检查 generator 同步；`test_end_token_is_blocked_until_min_tokens` 在 abc 与 semantic 两个 phase 都先取 fallback、后取 end；本地运行整个测试文件维持秒级（本 PR 实测 9 passed in 1.20s）。40 步版本在 AMD `Simple · Other Test` 中约占 1175 秒（main #13631 实测）只是削减动机；
  - 该 PR 的 AMD 验证项未勾选，AMD 时长改善不得作为已验证结果或验收依据。^[PR #8851]

## 决策与踩坑

- [YUE2-SYNTH-1a] 禁止：宣称 finishing step 永不阻塞；把整个 ODE/VAE pass 一次塞入 launch queue；用另一 song 的 stream-wide 完成代替本 job event；缺失 admission metadata 却把 forwarding stub 当作模型请求已正确建立的证明。
- [YUE2-SYNTH-1b] 禁止：finished row 无条件跳过而连续输出零 token；在重新交付时再次运行 synthesis；把未确认的部分 recompute 当作完整 accepted history；finish/abort 后遗留 job 或 timing state。
- [VLLM-OMNI-PR8851-YUE2-SAMPLER-COST] 禁止：保留从不触达生产 floor 的重复抽样步；直接覆盖 preset 默认值而不先断言其生产取值；削减后让 min_tokens/end-token block、batched 与单行 `torch.multinomial` 的逐列对比或 per-request generator 同步推进失去覆盖；把 AMD CI 时长收益当作已验证结果陈述。
