---
name: longcat-video-avatar-1-5-rules
description: "LongCat-Video-Avatar-1.5 规则 LCVA-1a 至 LCVA-4a：Avatar 与基础模型资产分开解析及 INT8/LoRA 加载（PR #4099）、stage 与 speaker audio 和空间 mask 的输入合同、AVC KV cache 只复用 continuation conditioning、支持结论只绑定 offline 单 H100 exact case"
metadata:
  scope: 只收 LCVA-* 规则与代码快速入口；名称范围与资源边界归 longcat-video-avatar-1-5-overview
---
# LongCat-Video-Avatar-1.5 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/longcat-video-avatar-1-5/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, diffusion；created: 2026-09-02；updated: 2026-09-02
- 来源（sources）：PR #4099；docs/user_guide/diffusion_features.md；examples/offline_inference/longcat_video/end2end.py；pyproject.toml；recipes/meituan-longcat/LongCat-Video-Avatar-1.5.md；tests/diffusion/models/longcat_video/test_longcat_video_avatar.py
  - tests/e2e/offline_inference/test_longcat_video_avatar.py；tests/model_tests/diffusion/test_alignment.py；vllm_omni/diffusion/models/longcat_video/longcat_video_avatar_transformer.py；vllm_omni/diffusion/models/longcat_video/pipeline_longcat_video_avatar.py
  - vllm_omni/diffusion/registry.py
- 置信度（confidence）：high
- 只有 `LCVA-数字字母` 是可审计规则 ID。

### Direct 代码快速入口

| PR 描述信号 | 规则 | 第一批源码 |
|---|---|---|
| registry、HF/local、INT8、LoRA、base model、dependency | LCVA-1a | registry；`prepare_longcat_video_avatar_model_for_omni`；pipeline `weights_sources/load_weights` |
| AT2V/AI2V、multi-speaker、audio_type、bbox/mask | LCVA-2a | pre-process → `_resolve_request_inputs` → audio/mask helpers → transformer attention |
| AVC、num_segments、conditioning frames、KV cache | LCVA-3a | `_prepare_audio_embeddings` → first segment → `_generate_avc` → transformer KV reuse |
| H100、memory、E2E、online/parallel/cache acceleration | LCVA-4a | advanced E2E → recipe → diffusion feature matrix |

### [LCVA-1a] Avatar 与基础模型资产分开解析，加载模式必须自洽

- 触发：registry、model preparation、HF allow-pattern、INT8/full-precision DiT、distilled LoRA 或 `longcat-video-avatar` extra。只支持 `model_type=avatar-v1.5`；
  - Avatar repo 提供 scheduler、所选 `base_model_int8`/`base_model`、DMD LoRA、Whisper 与 vocal separator，基础 LongCat-Video repo 提供 tokenizer、UMT5 text encoder 与 VAE。
- 强制：registry 同时绑定 pipeline 与专属 pre/post process。DiT 用 `weights_sources` + `AutoWeightsLoader`，INT8 loader 必须覆盖 parameter 和 registered buffer；选择 INT8 时不能同时下载 full-precision weight tree。CPU component build 是降低初始化峰值的默认，最终组件仍迁移到设备。
- 验收：local 与 HF ID、INT8/full precision、parameter/buffer load、`.to(device)` 与 `.to(dtype)`、extra 缺失分别覆盖。`prepare_*` 会写 `model_index.json` 并复制 transformer config 到给定目录，因而路径必须可写且调用方应把它视为 mutation；HF `revision=None` 也不能当不可变资产证据。
  - `use_distill=True` 时缺 DMD LoRA 当前会静默不安装，但 forward 仍强制 8 steps/双 guidance=1；这是未封闭 gap，修复应 fail fast 或显式回退非 distill schedule，并加 local-checkpoint 缺 LoRA 测试。

### [LCVA-2a] stage、speaker audio 与空间 mask 必须作为同一个输入合同

- 触发：audio/image、`stage`、official JSON、`audio_type`、bbox 或 speaker mask。无显式 stage 时有图推断 AI2V、无图推断 AT2V；所有请求必须有 audio，AI2V 必须有 image。多个 audio track 只能走 AI2V，因为 mask 定义在 reference image 上。
- 强制：speaker key 用末尾数字排序；`para` 把各轨补零到最长/生成时长并行播放，`add` 把各轨放入依次相接且其余位置为零的 timeline。显式 bbox 顺序是 `[y_min,x_min,y_max,x_max]` 并裁到图像；person1/person2 都缺时默认左右分区，只缺一个则拒绝，背景 mask 是两者补集。
- 验收：单 speaker AT2V/AI2V、两 speaker AI2V 的 para/add、显式/默认 bbox、单边 bbox、缺 audio/image、非法 stage/resolution 都在昂贵 model work 前验证；输出是 RGB PIL frame list，不把 example 最后的 ffmpeg 音频 mux 当 pipeline output 合同。

### [LCVA-3a] AVC cache 只复用 continuation conditioning，不是 diffusion-step acceleration

- 触发：`num_segments>1`/`auto`、`num_cond_frames`、reference latent、`use_kv_cache` 或 `offload_kv_cache`。frame 数先归一为 `4k+1`；auto 以首段 `num_frames/fps`、后续 stride `(num_frames-num_cond_frames)/fps` 覆盖完整 audio，且必须满足 `num_cond_frames<num_frames`。
- 强制：首段生成完整 latent；后续段复用末尾 conditioning frames、固定首帧 reference latent，按 stride 切 full-audio embedding，并只追加每段去掉 `num_cond_frames` 后的新帧。因此 unique frames 为 `F+(S-1)*(F-C)`。model-local KV 先从 clean conditioning latents 构造、可 CPU offload，segment 结束清空；关闭 cache 时仍携 condition tokens 做完整 attention。
- 验收：cache on/off 的 continuation shape与内容 parity、CPU offload、segment failure cleanup、auto 音频边界和 deterministic generator continuity。目标自动 E2E 只断言 2-segment 17/5 得到 29 张 RGB frame，未做 cache on/off 数值 parity、长音频质量、异常清理或跨重复确定性。

### [LCVA-4a] 支持结论只绑定 offline 单 H100 的 exact case

- 触发：声称硬件、并行、online、性能、显存或质量支持。
- 强制：当前 advanced E2E 是 H100×1、INT8+distill、480p、8 steps，覆盖 5-frame 单说话人 AT2V/AI2V、两说话人 AI2V 与 17-frame/5-cond 的两段 continuation，只检查 frame count/type/size。pipeline 在 alignment census 被显式排除，因为没有 tiny-model `DIFFUSION_TEST_SETTINGS`。
- 验收：新增能力必须补对应入口、topology、硬件和输出质量测试。PR 附件视频与作者报告的 fresh-pod test 没有固定 dependency/model revision 或机器可审计日志；目标仓库测试存在不等于 merge SHA 已复跑，故只能把自动 case 当 future gate，不能声称目标已复现质量。

## 决策与踩坑

- [LCVA-1a] 禁止：把基础 LongCat T2V/I2V 或旧 Avatar checkpoint 归入该 key；并发调用 `enable_loras()`。当前 LoRA 通过 monkey-patch `module.forward` 且明确非线程安全，只适用于现有单线程 offline 初始化。
- [LCVA-2a] 禁止：把任意说话人数描述成已验证；目标 transformer/test 只闭合两个 speaker，额外 `others` 是空间 mask，不是额外 audio-speaker 映射。也不能在多说话人 AT2V 中隐式忽略 mask。
- [LCVA-3a] 禁止：把该 transformer KV reuse 称为 Cache-DiT/TeaCache/FBCache 或跨请求 prefix cache；它不跨 request，也不跳过 diffusion steps。refinement/high-frequency/super-resolution 与 BSA 未实现。
- [LCVA-4a] 禁止：外推 online serving、SP/TP/CFG parallel、HSDP、VAE patch parallel、通用 component/layerwise CPU offload（不同于 AVC KV 的可选 CPU offload）、Cache-DiT 或质量 parity。recipe 的 41.0/56.8 GiB 和 130/33s 只绑定其 Modal H100、93-frame AI2V、CPU/GPU build observation；无重复/误差/持续 gate，不是性能 benchmark。
