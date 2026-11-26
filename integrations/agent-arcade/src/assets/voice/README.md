# Serena synthetic voice reference

[`serena-reference.wav`](serena-reference.wav) is the owner's selected synthetic voice reference for Agent Arcade's local Serena playback. It was generated locally for this project on **2026-11-05**, using an original greeting and Qwen's official **Serena** named CustomVoice preset. No human reference recording was supplied, no microphone was opened and no audio was uploaded. This is generated speech, not a recording of the owner or an identified performer.

The included asset is an independent byte-for-byte copy of the selected experiment output. It was not regenerated, trimmed, normalized or re-encoded during publication preparation.

| Property | Value |
| --- | --- |
| File | `src/assets/voice/serena-reference.wav` |
| SHA-256 | `20a9b9c687db1dc2e9c5783c3e915c9694e49118fff9e72dad56b1c32a37d179` |
| File size | 318,764 bytes |
| Format | WAV, signed PCM16, mono, 24,000 Hz |
| Frames / duration | 159,360 / 6.640 seconds |
| Text | 晚上好，今天过得怎么样？不着急，慢慢说，我在听。 |
| Model author | Qwen Team |
| Model / fixed revision | `Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice` / `0c0e3051f131929182e2c023b9537f8b1c68adfe` |
| Preset / language | Official `Serena` / `Chinese`; no additional style instruction |
| Project contribution | Agent Arcade contributors: AI-assisted original text, local synthesis, selection and provenance |

The [pinned official model card](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice/blob/0c0e3051f131929182e2c023b9537f8b1c68adfe/README.md) documents the named preset and `generate_custom_voice` API. Machine-readable provenance and the original environment are in [`serena-reference.json`](serena-reference.json). Qwen model weights are **not** included with this audio asset.

## Output license and attribution

Agent Arcade contributors make the original text and this generated project asset available under the repository's [MIT license](../../../LICENSE), **to the extent they hold licensable rights in those contributions**. This is an explicit project output-distribution choice. It is not a conclusion that Qwen's Apache-2.0 model license automatically licenses every generated output.

The upstream model card declares Apache-2.0 for the model; that remains a separate notice. The project does not claim to own the Serena preset's underlying voice identity, to have obtained an individual human performer's release, or to have Qwen's endorsement. The preset name identifies the generation source, not a person. No claim of human-recording authorization is made. Keep this provenance with redistributed copies; see also [the repository notices](../../../THIRD_PARTY_NOTICES.md).

## Reproduction conditions

The original run used Python 3.11.9, qwen-tts 0.1.1, Torch/Torchaudio 2.11.0+cu128, Transformers 4.57.3, Accelerate 1.12.0 and SoundFile 0.14.0 on an RTX 5090. It loaded the fixed revision above from a pre-downloaded local directory with offline mode enabled, used BF16 and SDPA, and wrote PCM16. The relevant call was:

```python
import os
os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1",
                  HF_HUB_DISABLE_TELEMETRY="1", HF_HUB_DISABLE_IMPLICIT_TOKEN="1")
from pathlib import Path
import torch
import soundfile as sf
from qwen_tts import Qwen3TTSModel

# Download/verify the exact revision separately; never replace the approved asset.
model_directory = Path("verified-qwen-customvoice-model")
output = Path("serena-reproduction.wav")
if output.exists():
    raise FileExistsError(output)
model = Qwen3TTSModel.from_pretrained(
    str(model_directory), device_map="cuda:0", dtype=torch.bfloat16,
    attn_implementation="sdpa", local_files_only=True)
torch.manual_seed(20261105)
torch.cuda.manual_seed_all(20261105)
with torch.inference_mode():
    waves, sample_rate = model.generate_custom_voice(
        text="晚上好，今天过得怎么样？不着急，慢慢说，我在听。",
        language="Chinese", speaker="Serena", max_new_tokens=384)
sf.write(str(output), waves[0], sample_rate, subtype="PCM_16")
```

This records how the approved asset was produced; a matching seed does not promise identical bytes across different hardware or library versions. Use the included file and its SHA-256 when an exact reference is needed. The public setup workflow may copy it to a selected local runtime path without modifying the original.
