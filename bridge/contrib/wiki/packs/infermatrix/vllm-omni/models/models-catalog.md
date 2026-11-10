---
name: models-catalog
description: 模型代码入口与 registry 快照（main @ 44d3ae10，2026-09-06 校验）：从 PR 提取模型名后搜索 _OMNI_MODELS / _DIFFUSION_MODELS / OMNI_PIPELINES 的 Direct 入口，四个注册点计数表（AR 89 架构 / 33 族、diffusion 66 pipeline / 41 族、OMNI_PIPELINES 59 key、deploy YAML 89 份）与逐 PR 的 inventory 变动（#5918 MAGI-2、#5885 MiniMax H3、#6353、#6357、#6694 MammothModa2、#4820 WanDMD、#6727 Intel GPU、SANA-Video），三份家族 / key 完整名单，audit_vllm_omni_release.py 重派生命令
metadata:
  scope: 只收模型名到代码目录的定位入口、四个注册点的计数与变动史、三份名单和重派生方法；按名称选 owner 归 models-overview，参照模型的用途归 reference-models
---
# 模型代码入口与 registry 快照

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/catalog.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, models；created: 2026-07-16；updated: 2026-09-06
- 来源（sources）：vllm_omni/model_executor/models/registry.py；vllm_omni/diffusion/registry.py；vllm_omni/config/pipeline_registry.py；vllm_omni/deploy/；PR #5885；PR #6354；PR #6727；PR #5918
- 本页提供模型描述到代码目录的自动定位入口，不维护逐模型 class 映射。下方计数是 `main @ 44d3ae10`（2026-09-06 校验）快照，数字会漂移，不能凭它断言“不支持”。

### Direct 模型代码入口

- 从 PR title/body 提取模型名、architecture 或 `model_type`，一次性搜索：
  1. `vllm_omni/model_executor/models/registry.py::_OMNI_MODELS`
  2. `vllm_omni/diffusion/registry.py::_DIFFUSION_MODELS`
  3. `vllm_omni/config/pipeline_registry.py::OMNI_PIPELINES`
- registry tuple 给出 folder、module 和 class 后，直接进入：
  - AR/omni：`vllm_omni/model_executor/models/<folder>/`
  - diffusion：`vllm_omni/diffusion/models/<folder>/`
- 命中 `OMNI_PIPELINES` 时继续打开对应 pipeline 定义，补齐多 stage 的所有模型目录。若正式名称和目录 slug 不同（如 MiniCPM-o → `minicpmo_4_5`），以 registry 结果为准；若一个模型同时命中 AR 和 diffusion（如 GLM-Image），两个目录都进入初始 scope。然后再用 changed files 校验是否还跨到 `model_extras/`、`stage_input_processors/` 或 serving adapter。
  - 已有专属知识 owner 可从 [[models-overview]]（models index） 按名称进入。

### 四个注册点与计数

| 注册点 | 位置 | 计数 |
|---|---|---|
| AR/omni 架构 | `model_executor/models/registry.py` `_OMNI_MODELS` | 89 个架构名 / 33 个模型族目录 |
| Diffusion pipeline | `diffusion/registry.py` `_DIFFUSION_MODELS` | 66 条 pipeline / 41 个模型族目录 |
| Pipeline（model_type） | `config/pipeline_registry.py` `OMNI_PIPELINES` | 59 个 key |
| Deploy YAML | `vllm_omni/deploy/*.yaml` | 89 份 |

- `1015b1ce → 44d3ae10` 将审计目标从 alignment 分支切回 upstream main。新增 `Magi2Pipeline`，实现位于 `vllm_omni/diffusion/models/magi2/pipeline_magi2.py`；AR、`OMNI_PIPELINES` 与 deploy YAML inventory 不变。MAGI-2 暂走共享 Diffusion owner，注册存在不等于所有硬件、online serving 或性能路径均已验证。^[PR #5918]
- PR #5885 adds `MiniMaxH3TextEncoder`, the opt-in `minimax_h3_disaggregated` pipeline key, and regular/Turbo deployment profiles. It preserves bare H3's fused single-stage fallback; the split topology is selected only by its explicit deploy config. ^[PR #5885]
- PR #6089 新增 `nemotron_labs_voicechat_duplex.yaml`，因此只增加 deploy profile；它没有增加 AR/diffusion registry architecture 或 `OMNI_PIPELINES` key。
  - PR #6354 将既有 offline、streaming 与 duplex 三份 Nemotron VoiceChat deploy profile 改为各自的 fast defaults，但未新增 deploy YAML、模型族、AR/diffusion registry architecture 或 `OMNI_PIPELINES` key。^[PR #6089] ^[PR #6354]
- PR #6634 adds Omni-DuplexEval benchmark support without changing the AR registry, diffusion registry, `OMNI_PIPELINES`, or deploy-YAML inventory. Its MiniCPM-o duplex endpoint is an evaluation consumer, not a new model registration or deploy profile. ^[PR #6634]
- PR #6664 only extends BF16 autocast for MossAudioTokenizer v2 decode on NPU; it does not change any AR/diffusion registry, `OMNI_PIPELINES`, or deploy-YAML inventory. ^[PR #6664]
- 对比上一审计快照（`39c16d75`）：AR 架构 88→81，diffusion pipeline 65→64，OMNI_PIPELINES 57→55，deploy 86→84。PR #6353 删除 AudioX 的 diffusion registry、processor/extras/recipe/examples/tests，并删除 MammothModa2 Preview/Dev 共用的七个 AR architecture、两个 pipeline key、两个 deploy YAML 及其 tokenizer/config/AR/DiT/bridge。
  - 因此当时 active owner 与 catalog 不再声明这两个家族；diffusion text-to-audio 的 first-party 示例只剩 Stable Audio，Audex 的 TTA 仍是独立两阶段 autoregressive 路径。^[PR #6353]
- PR #6357 删除 `DreamIDOmniPipeline` 和 `MagiHumanPipeline`，以及相应的模型目录、MagiHuman extras、测试、文档和唯一共享的 `x_to_video_audio` offline 示例；这两个家族不再是当前 first-party 支持，下面的 registry/owner 清单不将其列为 active。两页保留为历史 tombstone，不得作为可运行支持或能力证据。RFC #5996 最初讨论的是 CI delist；
  - 本 PR 的合并代码和 PR body 明确扩大为完整 first-party 删除。^[PR #6357] ^[Issue #5996]
- PR #6694 恢复 MammothModa2-Preview 和 MammothModa2-Dev：七个 AR architecture、`mammoth_moda2`（AR→DiT）与 `mammoth_moda2_ar`（AR-only）pipeline key，以及对应两份 deploy YAML 回到 active inventory。Preview/Dev 的实现、prompt/extras 与 AR→DiT bridge 共享 `mammoth_moda2` 家族；
  - 理解路径使用 AR-only topology，Dev 的 supported-model 表仅声明 AR-only image understanding。详见 [[mammoth-moda2-overview]]（MammothModa2 owner）。^[PR #6694]
- PR #6619 删除独立的 `minicpmo_4_5_duplex.yaml`，将 duplex 配置并入全部 shipping MiniCPM-o profile，因此 deploy inventory 84→83；这是 profile 合并，不是 MiniCPM-o 能力删除。^[PR #6619]
- PR #6559 增加 `mimo_audio_5090d.yaml`，使 deploy inventory 83→84；这是 MiMo-Audio 的社区 1× RTX 5090/5090D 32 GB recipe profile，不增加 registry 架构或 pipeline key，且不构成其他 Blackwell SKU、online serving、性能或音质的支持证明。^[PR #6559]
- PR #4820 将 `WanDMDPipeline` 注册为 Wan2.2 的同实现入口，因此 diffusion pipeline 计数回升至 65；它不是新的模型族或新的 `OMNI_PIPELINES` key。^[PR #4820]
- PR #6727 does not change any registry or deploy inventory, but the upstream supported-model table adds Intel GPU checkmarks for Qwen-Image and Qwen-Image-2512, Krea 2, Wan2.2-VACE, Boogu-Image, OmniVoice, VoxCPM2, Qwen3-TTS CustomVoice, Ming-omni-tts dense 0.5B, Dynin-Omni,
  - and Gepard-1.0. This is table-declared Intel GPU support; it is not a claim that every model has a recipe, an online-serving validation, performance data, or validation on hardware other than the PR's XPU lane. ^[PR #6727]
- SANA-Video 2B 新增 native `SanaVideoPipeline`（T2V）和 `SanaImageToVideoPipeline`（I2V），二者共用 `sana_video` 模型族目录；它没有新增 `OMNI_PIPELINES` key 或 deploy YAML。模型专有的 checkpoint、VAE 和 adapter 边界见 [[sana-video-overview]]（SANA Video）。^[PR #5508]

### AR/omni 模型族（33）

- audex、aura_omni、bagel、cosyvoice3、covo_audio、dots_tts、dynin_omni、fish_speech、gepard、glm_image、glm_tts、higgs_audio_v2、higgs_audio_v3、hunyuan_image3、indextts2、mammoth_moda2、mimo_audio、ming_flash_omni、ming_tts、minicpmo_4_5、minimax_h3、minimax_music3、moss_tts、moss_tts_nano、nemotron_voicechat、
  - omnivoice、personaplex、qwen2_5_omni、qwen3_omni、qwen3_tts、step_audio2、voxcpm2、voxtral_tts

### Diffusion 模型族（41）

- bagel、boogu_image、cosmos3、diffusers_adapter、dreamzero、ernie_image、flux、flux2、flux2_klein、glm_image、gr00t、helios、hidream_image、hidream_o1_image、hunyuan_image3、hunyuan_video、internvla_a1、krea2、lance、lingbot_video、lingbot_world、longcat_image、longcat_video、ltx2、magi2、ming_flash_omni、minimax_h3、
  - nextstep_1_1、omnigen2、omnivoice、ovis_image、pi0、qwen_image、sana_video、sana_wm、sd3、sdxl、sensenova_u1、stable_audio、wan2_2、z_image

### OMNI_PIPELINES key（59）

- Gr00tN1d7、audex_s2s、audex_thinker_only、audex_tta、audex_tts、aura_omni、bagel、bagel_single_stage、bagel_think、cosyvoice3、covo_audio、dots_tts、dreamzero、dynin_omni、fish_qwen3_omni、gepard、glm_image、glm_tts、higgs_audio_v2、higgs_multimodal_qwen3、hunyuan_image3_ar、hunyuan_image3_dit、hunyuan_image_3_moe、
  - hunyuan_video_15、indextts2、indextts2_5、lance、mammoth_moda2、mammoth_moda2_ar、mimo_audio、ming_flash_omni、ming_flash_omni_image、ming_flash_omni_thinker_only、ming_flash_omni_tts、ming_tts、ming_tts_moe、minicpmo_4_5、minimax_h3_disaggregated、minimax_music3、moss_tts_delay、moss_tts_local、moss_tts_nano、
  - moss_tts_realtime、nemotron_labs_audex、nemotron_labs_voicechat、nemotron_voicechat、omnivoice、personaplex、pi0、qwen2_5_omni、qwen2_5_omni_thinker_only、qwen3_omni_moe、qwen3_omni_moe_thinker_only、qwen3_tts、step_audio_2、step_audio_2_asr、voxcpm2、voxtral_tts、wan2_2_ti2v
- `diffusers_adapter` 是通用 diffusers 桥；`Gr00tN1d7` 保留其大小写，`qwen3_omni_moe` 是 resolver key。
- 注意：单 stage diffusion 模型**多数不在** `OMNI_PIPELINES`（引擎为它们生成默认 diffusion stage 配置,见 [[configuration-architecture]]（Config 组件））; 但存在例外——omnivoice、Gr00tN1d7、lance、dreamzero 等单 stage 家族也有显式 key,勿以"在不在 OMNI_PIPELINES"倒推 stage 数。

### 重派生方法

```bash
python tools/audit_vllm_omni_release.py \
  --from 1015b1ce \
  --to 44d3ae10 \
  --repo <vllm-omni-checkout> \
  --mode report-only
```

- 命令从 Git 对象读取 registry，不 import vLLM；机器基线与完整维护步骤见 `adapters/vllm_omni/release_baseline.yaml` 和 `doc/contributing/release-maintenance.md`。
- 已有专属沉淀页的模型见 [[models-overview]]（models/_index）；没有专属规则的新家族先走共享 Diffusion owner。参照用途见 [[reference-models]]（reference-models）。
