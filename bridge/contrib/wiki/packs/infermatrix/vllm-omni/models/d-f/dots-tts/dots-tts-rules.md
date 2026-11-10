---
name: dots-tts-rules
description: "dots.tts 规则 DOTS-1a（weekly offline E2E scaffold 保留真实 prompt token、_results_queue 按位置对应 logits、blake2b 派生的 request-local noise oracle；weekly 收集 3、nightly 收集 0，PR #6174）与 DOTS-2a（online serving detection 只按 DotsTTSForConditionalGeneration architecture 识别，不认领与 VoxCPM2 共用的 latent_generator stage key，PR #6235）"
metadata:
  scope: 只收 DOTS-1a 与 DOTS-2a 及其代码入口表；checkpoint、deploy 默认和 serving 合同的说明归 dots-tts-overview
---
# dots.tts 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/dots-tts/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, ci；created: 2026-09-05；updated: 2026-09-05
- 来源（sources）：PR #6174；tests/e2e/offline_inference/test_dots_tts_expansion.py
- 置信度（confidence）：high

### Direct 代码快速入口

| PR 描述信号 | 规则 |
|---|---|
| weekly E2E、prompt scaffold、result queue 或 request-noise oracle | `DOTS-1a` |

### [DOTS-1a] weekly E2E scaffold 必须保留 prompt、队列与 request-noise oracle

- 触发：修改 dots.tts offline E2E、prompt helper、`compute_logits` result queue 或 flow-matching noise test。
- 强制：以显式 remote-code tokenizer 调 `build_dots_tts_prompt`，构造 `[文本]<text>[文本对应语音]<|audio_gen_start|>` 的真实 Qwen2 token IDs。mixed case 的五个请求（一长四短）必须按位置维护 `_results_queue -> logits[i]`：每个 step 的 prefill row 也各贡献一个 entry，不能压缩后错配。
  - 测试引用的既有 flow-matching noise 由 `blake2b(seed:request_key:noise_step)` 派生 request-local generator；音频 oracle 只检查 finite、non-silent 和宽松时长。
- 验收：zero-shot 输出为 48 kHz、finite/non-silent 且时长 `(0.5,30)` 秒，mixed 五项各在 `(0.1,30)`；sequential singleton 同 prompt 运行两次，shape 相同且 `torch.allclose(atol=1e-4)`（默认 nonzero `rtol` 仍生效）。三例都带 `slow`、`tts` 和一张 L4 hardware marker；
  - weekly `-m "slow and L4 and tts"` 收集 3，nightly `-m "full_model and L4 and tts"` 收集 0。PR 未在 L4 实跑，真实 weekly run 才能证明硬件结果。^[PR #6174]

### [DOTS-2a] online serving detection 必须以 dots.tts architecture 优先，不能认领共享 stage key

- 触发：修改 `dots_tts` 的 `/v1/audio/speech` adapter、TTS detector metadata、`serving_speech` 的 stage discovery，或与 VoxCPM2 共用 `latent_generator` 一类 stage key 的模型接入。
- 强制：`DotsTTSAdapter` 只按 `DotsTTSForConditionalGeneration` architecture 识别 dots.tts，并用高于 VoxCPM2 的 `detect_priority` 先参与排序；`stage_keys` 必须保持空集合，避免把共享的 `latent_generator` entry stage 当作 dots.tts 的充分证据。最终 online speech 路由必须经统一 adapter detection，而不是在 `serving_speech.py` 增加模型专用分支。
- 验收：检测测试必须同时覆盖 dots.tts architecture 命中 `DotsTTSAdapter`、VoxCPM2 architecture 仍命中 `VoxCPM2Adapter`，并断言 dots.tts 不因 `latent_generator` 进入候选；serving 集成测试还要证明 `/v1/audio/speech` 的 dots.tts 请求走到正确 adapter。E2E 通过只证明该精确 online-serving 路径可达，不外推为其他共享 stage-key 模型都已安全。^[PR #6235]

## 决策与踩坑

- [DOTS-1a] 禁止：用 bare prompt string 代替真实 prefill scaffold；跳过 prefill queue slot；用本 PR 声称新增 runtime queue/RNG 修复；把 selector collection、non-silence 或相邻两次一致写成可懂度、speaker similarity、并发确定性、bitwise parity、性能或真实 L4 成功证据。
- [DOTS-2a] 禁止：让 dots.tts 通过共享 stage key 抢占 VoxCPM2 请求；在优先级上落后于 VoxCPM2 再依赖 stage 扫描“碰运气”命中；或把一次成功的 dots.tts speech 请求当成 detector 消歧已被证明。
