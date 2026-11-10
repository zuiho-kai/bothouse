---
name: minimax-h3-overview-2
description: MiniMax H3 目录入口（下）：ComfyUI 请求路由指向 tooling 规则、full-model accuracy/nightly 的 I2VA 与 Ref2VA 用例与 SSIM/PSNR gate、H100 两卡 L2 smoke、以及按主题（media、loading、deployment、cache-task、VAE eager ops、encoder state、quality、latent refinement、VDNH3、audio VAE、ComfyUI audio 与 schema）列出的 MiniMax H3 规则页导航
metadata:
  scope: 只收 ComfyUI 路由说明、验证入口与审查入口导航；模型名称、拓扑和并行加载摘要在 minimax-h3-overview-1，各规则页正文归 rules-media-1、rules-loading、rules-deployment-1、rules-cache-task-1、rules-vae-ops、rules-encoder-state、rules-quality、rules-latent-refinement、rules-vdnh3、rules-audio-vae-determinism、rules-comfyui-audio、rules-comfyui-workflow-schema
---
# MiniMax H3（2/2）

## 现状

- 拆分说明：本页是源页 `_index.md` 的第 2/2 部分；第 1 部分 [[minimax-h3-overview-1]]

### ComfyUI 请求路由

- MiniMax H3 的 `t2va`、`fl2va` 和 `ref2va` frontend 选择、reference multipart 字段及 Hub/local model lookup 合同由 [[tooling-rules]]（ComfyUI tooling rules） 负责；模型页不复制客户端规则。

### 验证入口

- 模型专属 contract、packing 和 parallel 测试在 `tests/diffusion/models/minimax_h3/`。full-model accuracy/nightly 入口现保留 I2VA 与 Ref2VA，两者都从 Hugging Face `main` 下载模型分区与 SHA-256 固定的 official assets；模型 `main` 仍可漂移。
  - 两例固定 1344x768/24 FPS/AAC 32 kHz stereo/50 steps/seed 0，帧数分别 192/124，共用 SSIM>=0.97、PSNR>=34 dB gate。nightly lane 声明 4x H100，PR 数值则来自 4x B300，不得混为同一硬件证据。T2VA 因当前严格 gate 未达标被移出；这表示“无 retained pixel-level gate”，不是 T2VA 功能不支持。该用例是精度/媒体合同，不是性能基线。^[PR #5978] 硬件 recipe 只记录已验证的 GPU/NPU 形状；
  - 性能数字不能从 recipe 的配置示例泛化为全硬件保证。目标 pin 的 MUSA Ref2VA recipe 已改为 `MODEL_ROOT/Ref2VA` + `--task-type ref2va`；它只验证单分区启动，不能外推 combined 双 DiT 的容量或性能。共享 offloader、并行和请求合同分别归 [[diffusion-overview]]（Diffusion）、[[configuration-overview]]（Configuration） 和 [[serving-overview]]（Serving）。
- 另有 ready L2 smoke 使用 TP=1/DP=2 的 distributed layerwise offload、two concurrent `/v1/videos/sync` T2VA requests、4 steps 和 1344×768/24 FPS；它同时断言 MP4 video 与 nonempty decodable audio。
  - 该 YAML job 配置为两张 H100，但 PR 仅报告 local two-card B300 execution，不能代替 retained accuracy gate、Buildkite H100 result 或其他 parallel topology 的支持证据。^[PR #6555]

### 审查入口

- H3 input matrix/media ingress，以及 text-encoder completeness、online FP8 的 component namespace、loader 顺序、
  - joint quality 与 offload 边界见 [[rules-media-1]]、[[rules-media-2]]（media rules）（含 `text_conditioning/v1` schema 与 MMH3-2u 的 reference 尺寸门禁）与 [[minimax-h3-rules-1]]（MiniMax H3 rules；源锚点 #direct-代码快速入口） 新增核对：MMH3-2r、MMH3-2s、MMH3-2t。；
  - checkpoint transform、quantized loader 与 text-encoder fused-source 完整性正文见 [[rules-loading]]（loading rules）；DLO、consumer/H100/ROCm 部署和硬件证据正文见 [[rules-deployment-1]]、[[rules-deployment-2]]（deployment rules）；
  - conditioned VAE 确定性、modular task 选择与 request 级 Cache-DiT/TeaCache/sigma schedule/Turbo LoRA 生命周期、alias metadata 同构、Turbo artifact 与 MMH3-2v 的 sampler 状态隔离见 [[rules-cache-task-1]]、[[rules-cache-task-2]]、[[rules-cache-task-3]]（缓存与任务生命周期规则）。 新增核对：MMH3-2r2。
- H3 VAE decoder 的 model-local eager dispatch、remote-code eligibility、exactness guards、selective FP16 materialization、keyframe encode 的 cuDNN/TF32 pin 与 compile/spatial-parallel fallback 见 [[rules-vae-ops]]（VAE eager-ops rules）。
  - Qwen3-VL text encoder 的 cuDNN SDPA process-global-state restore、encoder-rank/VAE boundary 和 CPU-only validation limit 见 [[rules-encoder-state]]（encoder state rules）。
- [[rules-quality]]（rules-quality） 新增核对：MMH3-4a2。
- [[rules-latent-refinement]]（latent upscaler、second-pass refinement 与容量门禁）
- [[rules-vdnh3]]（MiniMax-H3 VDNH3 checkpoint 与请求合同）。
- [[rules-audio-vae-determinism]]（MiniMax-H3 audio VAE 确定性规则）
- [[rules-comfyui-audio]]（MiniMax-H3 ComfyUI audio_mode 与 supplied-audio MV 规则）
- [[rules-comfyui-workflow-schema]]（MiniMax-H3 ComfyUI 工作流 Schema 规则）

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/minimax-h3/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, models, diffusion；created: 2026-08-05；updated: 2026-10-06
