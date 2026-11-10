---
name: rules-gradio-pcm
description: "规则 VLLM-OMNI-PR7901-GRADIO-PCM-NORM：examples/online_serving/ 下十个 Gradio demo 处理 gr.Audio 非 int16 整数 PCM 时，先除以位深满标度 1 << (np.iinfo(dtype).bits - 1) 归一化再 clip / 转 int16（24-bit 源经 pydub 填充为 int32）；aura_omni 以归一化浮点直接 sf.write；回归测试 tests/examples/test_gradio_ref_audio_bit_depth.py（PR #7901）"
metadata:
  scope: 只收 Gradio 示例参考音频的整数 PCM 归一化这一条规则；Realtime 的 24 kHz PCM16 输入校验（SERV-RT-1b）归 rules-realtime-openai，speech 输出采样率归 rules-speech-output
---
# vLLM-Omni 服务：Gradio 示例 PCM 音频转换规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/serving/rules-gradio-pcm.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, serving；created: 2026-10-14；updated: 2026-10-14
- 来源（sources）：PR #7901
- [VLLM-OMNI-PR7901-GRADIO-PCM-NORM] Gradio 示例参考音频：整数 PCM 须按位深满标度归一化后再 clip/转换，禁止裸 astype 窄化
  - 触发：改动 `examples/online_serving/` 下 PR #7901 触及的十个 Gradio demo 中处理 `gr.Audio` numpy 音频的非 int16 dtype 分支——minicpmo、qwen2_5_omni、qwen3_omni 的 `audio_to_base64_data_url`，
    - `text_to_speech/` 下采用同一转换的六个 TTS demo（audio8_tts 的 `encode_audio_to_base64`，及 fish_speech、glm_tts、moss_tts_nano、qwen3_tts/tts_common.py、voxcpm2），aura_omni 的 `_audio_to_data_url`，以及 minicpmo 的 `process_audio_input`、qwen2_5_omni 与 qwen3_omni 的 `process_audio_file` 及其调用的 `_pcm_to_float32` 助手；
    - 或改动 `tests/examples/test_gradio_ref_audio_bit_depth.py`。
  - 强制：Gradio 上传经 pydub 解码，24-bit 源被填充为 int32 返回（随行代码注释为证），所以任何非 int16 的整数 PCM 在 clip 或 dtype 转换之前，必须先经浮点中转并除以该 dtype 的满标度 `1 << (np.iinfo(dtype).bits - 1)` 归一化到 [-1, 1]；已是 [-1, 1] 的浮点输入只需 clip 到 [-1, 1]。
    - diff 所示的两种落地形态各自保持，不得互相替代：（1）写 int16 WAV 的编码器——三个 omni demo 的 `audio_to_base64_data_url` 与六个 TTS demo 的同类函数（audio8_tts 为 `encode_audio_to_base64`）——先把两个分支统一归一化为 `audio_f`，再执行 `np.clip(audio_f * 32768, -32768, 32767).astype(np.int16)`；
    - （2）aura_omni 的 `_audio_to_data_url` 对整数分支除以满标度并 clip 到 [-1, 1] 后，以归一化浮点直接交给 `sf.write`，该路径不做 int16 转换，评审时不得以形态（1）的 int16 换算作为其验收标准。
    - 路径加载由 `_pcm_to_float32` 处理（该助手仅在 minicpmo、qwen2_5_omni、qwen3_omni 显示新增）：整数除以满标度返回归一化 float32，浮点直接 `astype(np.float32)`，由 minicpmo 的 `process_audio_input` 与 qwen2_5_omni、qwen3_omni 的 `process_audio_file` 调用。上述行为由 `tests/examples/test_gradio_ref_audio_bit_depth.py` 回归守护。
  - 验收：所示各 demo 的非 int16 分支均先按 `1 << (np.iinfo(dtype).bits - 1)` 归一化——九个写 int16 的编码器随后乘 32768 并 clip 到 [-32768, 32767]，aura_omni 以归一化浮点直接写 WAV；`pytest tests/examples/test_gradio_ref_audio_bit_depth.py` 通过。^[PR #7901]

## 决策与踩坑

- [VLLM-OMNI-PR7901-GRADIO-PCM-NORM] 禁止：对宽于 16 位的整数 PCM 裸 `astype(np.int16)`（按 2**16 回绕，破坏参考波形）；对未做满标度归一化的整数先 clip 到 ±1.0（任何非零样本都会饱和到 ±1.0）；删除或绕过 `tests/examples/test_gradio_ref_audio_bit_depth.py`。
