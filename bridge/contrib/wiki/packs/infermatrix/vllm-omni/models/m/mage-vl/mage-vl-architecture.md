---
name: mage-vl-architecture
description: "Mage-VL 实验性架构：encoded MP4 经 WS /v1/mage-vl/duplex 到 FastAPI server、MageVLDuplexAdapter 的有界因果视觉窗口与 gate、MageVLTransformersBackend 的 StreamMind gate 与 frames/codec 两种采样（codec 需要 ffmpeg、ffprobe、cv-preinfer）、仅接受 encoded video 的生产边界（PR #6537）"
metadata:
  scope: 只收 Mage-VL 的 transport 到 adapter 到 backend 数据流与能力边界；MAGEVL-1a 硬门禁归 mage-vl-rules，名称与入口归 mage-vl-overview
---
# Mage-VL experimental architecture

## 现状

### Transport → adapter → backend

- Client sends shared duplex `input.append`: optional text plus encoded MP4 video data (`video_base64` and segment/timing metadata) to standalone `WS /v1/mage-vl/duplex`.
  - The FastAPI server owns bearer authentication, session-ID validation, concurrent-session/message bounds, idle timeout, cancellation and lease cleanup. It advertises only `{text, video}` input and `{text}` output, matching the checked-in Transformers backend.
- `MageVLDuplexAdapter` owns per-session bounded causal visual windows, pending query/gate decision, event de-duplication and gate tasks. `MageVLDuplexRuntime` is a small shared-runtime subclass that watches deferred gate completion while the reader remains available for cancellation.
  - The common response/cancellation/close mechanics belong to [[rules-session-lifecycle]]（SERV-6h）.
- `MageVLTransformersBackend` materializes the encoded MP4 temporarily, applies the remote-code processor, runs the StreamMind gate or generation, and serializes access to the shared checkpoint. `frames` samples decoded frames.
  - The optional `codec` backend requires `ffmpeg`, `ffprobe`, and `cv-preinfer` from `codec-video-prep>=0.2.5`; absent `cv-preinfer` is a startup error with `frames` as the fallback.

### Boundary

- The adapter has generic codec-window abstractions, but the production Transformers transport accepts encoded video only. Image or opaque `codec_window` must not be advertised as production capabilities. This is not a native vLLM executor, pipeline, deploy profile, or unified route.^[PR #6537]

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/mage-vl/architecture.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: vllm-omni, models, model-executor；created: 2026-09-05；updated: 2026-09-05
- 来源（sources）：PR #6537；vllm_omni/experimental/fullduplex/mage_vl/adapter.py；vllm_omni/experimental/fullduplex/mage_vl/serving/backend.py；vllm_omni/experimental/fullduplex/mage_vl/serving/server.py；recipes/Microsoft/Mage-VL.md
- 置信度（confidence）：high
