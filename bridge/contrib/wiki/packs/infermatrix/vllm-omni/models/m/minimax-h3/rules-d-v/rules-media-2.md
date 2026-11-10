---
name: rules-media-2
description: MiniMax H3 媒体输入与精度规则（下）：MMH3-2l split text encoder 的 presentation、条件载荷与原始媒体所有权、MMH3-2q minimax_h3.text_conditioning/v1 schema、MMH3-2r Ref2VA 声轨与独立音频分账 15 秒、MMH3-2s timing/latent shape/condition pinning、MMH3-2t audio decoder backend 统一输入、MMH3-2u 参考媒体网格对齐
metadata:
  scope: 只收 MMH3-2l、2q、2r、2s、2t、2u；decoded video、输入矩阵、media ingress 限界与参考视频解码归 rules-media-1
---
# MiniMax H3 媒体输入与精度规则（2/2）

## 关键事实

- 拆分说明：本页是源页 `rules-media.md` 的第 2/2 部分；第 1 部分 [[rules-media-1]]
- 源页：`knowledge/repos/vllm-omni/models/minimax-h3/rules-media.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, diffusion；created: 2026-09-02；updated: 2026-10-06
- [MMH3-2l] split text encoder 必须保持 H3 presentation、条件载荷与原始媒体的所有权
  - 触发：`minimax_h3_disaggregated`、H3 Qwen3-VL prompt processor、Stage 0→1 bridge、prefix/sender cache、reference-video preparation 或 encoder-free Stage 1。
  - 强制：Stage 0 只接收 H3 的 Qwen presentation；Stage 1 必须接收 original prompt/media 加上 typed `text_encoder_output`，不得把 encoder-transformed prompt 当作 DiT input。conditioning 是 hidden states `[tokens, 5120]` 与 token-role tags `[tokens]`；
    - wire 上 tags 必须为 `[tokens, 1]` 才能作为 per-token prefix-cache payload，Stage 1 恢复一维语义并在 request ID、completion count、tensor type/rank/shape 与二值 tags 边界 fail closed。H3 sender cache 必须 bypass：cache hit 只给 generic processor misses，不能重建 media-dependent presentation IDs。
  - 强制：Ref2VA 的 Stage 0 preparation 要把 serialized prepared-video descriptor 和 artifact owner 交给 original request；Stage 1 reuse the RGB stream for VAE/audio conditions, and terminal/error paths must clean it.
    - This avoids duplicate ffprobe/transcode while preserving raw media ownership at Stage 1. split profile 是 multi-stage，不能仅因一个 replica inline Stage 1；fused/bare single-stage H3 仅在一个 replica 时默认 inline。
    - 显式 `inline_diffusion` 或已有 custom-pipeline owner 可让 single-replica split/custom 路径 opt in，但任何超过一个 replica 的 plan 都必须 subprocess。Encoder-free DLO must skip absent components, and final-output validation follows declared final video metadata rather than requiring every stage to be diffusion.
  - 验收：覆盖 fused fallback versus explicit split selection; exact H3 prompt IDs/tags including sender-cache hits; chunked/prefix-cache token tags; malformed bridge payload/request mismatch; artifact reuse and cleanup; resolver/local partition paths; Stage 0-only TP alias precedence/rejection;
    - encoder-free DLO; explicit inline isolation; and regular/Turbo default sampling profiles. ^[PR #5885]
- [MMH3-2q] `minimax_h3.text_conditioning/v1` 必须在 Stage 0→1 边界 fail closed
  - 触发：修改 MiniMax-H3 `MiniMaxH3TextConditioning`、`text_encoder2diffusion` bridge、`OmniPayload` handoff，或 Stage 0/1 对 hidden states / token roles 的消费。
  - 强制：公开 schema id 为 `minimax_h3.text_conditioning/v1`。语义载荷：`hidden_states` 为 contiguous strided `[tokens, 5120]` `bfloat16`；`token_tags` 为 contiguous strided `[tokens]` `int64` 且仅含 `0/1`。
    - Stage-wire `OmniPayload` 路径必须经 `from_omni_payload`：从 `hidden_states.output` 取 tensor，从 `meta.token_role_ids` 取 `[tokens, 1]` `int64` contiguous strided，再 squeeze 成语义 tags；任一类型/shape/dtype/layout 不符都在 adapter 边界失败。
  - 验收：CPU 测试覆盖合法 payload、错误 dtype/layout/shape、缺失字段，以及 encoder ownership（仅 owning replica 持有，disaggregated diffusion stage 缺席）；不改动既有 serializer 与 launch path 时仍须保持负向门禁。^[PR #6720]
- [MMH3-2r] Ref2VA 视频声轨与独立音频必须分账 15 秒预算
  - 触发：修改 MiniMax-H3 Ref2VA 的 reference audio 时长校验、embedded/standalone audio latent 拼接，或 `_prepare_request_inputs` 在编码后的 `audio_lengths` 检查。
  - 强制：视频声轨与 standalone audio 各自遵守本模态的 2–15 秒（及既有编码后单段长度）预算，并在 encoding 前分别校验。拼接 conditioning rows 之后，不得再对 `sum(audio_lengths)` 施加单一 15 秒/600 latent-frame 总预算。各 `ref_blocks` 种类（如 `video_audio` 与 `audio`）与长度列表必须原样保留。
  - 验收：约 2–3 s 视频声轨 + 满 15 s standalone WAV 的 Ref2VA 请求必须被接受，并断言两段 audio condition 都进入上下文；继续覆盖单段越界与 audio-only 拒绝。^[PR #7281]
- [MMH3-2s] timing、latent shape 和 condition pinning 属于 checkpoint 数值合同
  - 触发：修改 duration/frame 归一化、video/audio latent、spatial padding、VAE dtype、seeded preprocessing 或 denoise condition row。
  - 强制：对原始 H3 checkpoint 的 24 FPS、frame 数 `17n+5`、video latent 长度 `5n+2`、audio latent 40 Hz、spatial dimension 对齐 32 约定，video VAE 的 FP32 边界和每步重新 pin condition rows 必须由明确 checkpoint 证据才能改变。
  - 验收：边界 duration/size 的 exact-vector 与 round-trip 测试覆盖 dtype 和 latent shape；固定 seed 逐步断言 condition rows，最终 MP4 同时验证 24 FPS 和 32 kHz audio metadata。^[PR #5691]
- [MMH3-2t] 所有 decoder backend 保持同一 audio VAE 输入合同
  - 触发：修改 H3 standalone/reference-video audio loading 或可选 media backend。
  - 强制：torchaudio、soundfile 和 ffmpeg-demux fallback 都返回 `(float32 waveform[C,T], native_sample_rate)`；soundfile 的 `[T,C]` 必须转置并 contiguous，32 kHz resampling 只由 audio VAE owner 执行；standalone 与 video soundtrack 共用该入口。
  - 验收：强制覆盖 torchaudio 成功、torchaudio 失败后 soundfile 成功、soundfile 失败后 ffmpeg 成功及 subprocess 失败；mono/stereo 的 dtype、channel order、rate 与临时目录 cleanup 都断言，direct audio 和 video-demux 路径结果一致。 ^[PR #5699]
- [MMH3-2u] Ref2VA 参考媒体只能做必要网格对齐或大视频缩小
  - 触发：修改 H3 reference image/video 的尺寸解析、resize 或 transcode。
  - 强制：参考图保留既有 ratio `[0.4,2.5]` 与维度 `[256,5760]` 校验，仅把原尺寸对齐到32网格；不再放大到固定2048短边。视频保留原canvas拟合和最大像素约束，但若该canvas面积大于源面积，改为对源尺寸做32网格对齐。已对齐的小输入保持原尺寸，网格舍入仍可调整未对齐的轴。
  - 验收：覆盖已对齐/未对齐图像、小/大视频和非法输入；`640×384`视频保持原尺寸，`1920×1152`按既有canvas缩至`1280×768`。^[PR #8253]

## 决策与踩坑

- [MMH3-2l] 禁止：把 split route 自动发现为 H3 default、把 `text_encoder_tp_size` broadcast 到 Stage 1、用 unvalidated positional output/tensor fields transfer conditioning，或把 H200/B300 single topology observations扩展成 cross-node transport、throughput 或 all-profile compatibility evidence。
- [MMH3-2q] 禁止：放宽为任意 float/int dtype 或非 contiguous layout；绕过 schema validator 直接塞 positional tensors；把该 H3-only hardening 写成已落地的通用 `StagePortSpec`。
- [MMH3-2r] 禁止：把“各 ≤15 s”误读成“embedded+standalone 合计 ≤15 s”；在合法分账输入上因合计超限拒绝请求。
- [MMH3-2s] 禁止：用通用 `round()` 或相邻模型的公式替代 H3 对齐；为省显存静默降低 VAE 精度；只在初始 step 固定 conditioning 后允许后续 denoise 漂移。
- [MMH3-2t] 禁止：新增 direct `torchaudio.load` 旁路；泄漏 channels-last、在 loader 静默 resample，或把 TorchCodec/CUDA 可用性当作 NPU/CPU 前提。
- [MMH3-2u] 禁止：用固定canvas放大小参考图/视频；移除既有非法ratio/dimension拒绝；把网格舍入说成任意输入像素尺寸完全不变。
