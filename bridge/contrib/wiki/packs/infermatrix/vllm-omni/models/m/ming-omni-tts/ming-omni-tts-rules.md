---
name: ming-omni-tts-rules
description: "Ming-Omni-TTS 规则 MING-1a 至 MING-4a：CFM graph 保持 eager 的 float32 solver 边界、CFG 近零分支与 eager 一致、graph 最后一步复刻 Solver.integrate（PR #4341）、MoE-only 依赖 lazy import、说话人抽取区分引擎预取与离线下载（PR #6119）、ISTFT complex spectrum 由 FP32 operands 构造（PR #7538）"
metadata:
  scope: 只收 MING-1a/1b/1c/2a/3a/4a 与代码快速入口；名称、源码路径与流程概述归 ming-omni-tts-overview
---
# Ming-Omni-TTS 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/ming-omni-tts/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, model-executor；created: 2026-07-20；updated: 2026-10-06
- 来源（sources）：PR #4341；PR #6119；PR #7538
- 置信度（confidence）：high
- 只有 `MING-数字字母` 是可审计规则 ID。

### Direct 代码快速入口

| PR 描述信号 | 规则组 | 第一批源码 |
|---|---|---|
| Ming-TTS dense/MoE、`ming_tts(_moe)` | MING-2a | `config/pipeline_registry.py::OMNI_PIPELINES` → `model_executor/models/ming_tts/pipeline.py`；`model_executor/models/registry.py::_OMNI_MODELS` |
| CFM CUDA Graph、solver dtype、noise/timestep | MING-1a | `model_executor/models/ming_tts/fm/cfm_cudagraph.py` → eager solver |
| CFG 近零分支 | MING-1b | graph/eager CFM forward 与 CFG branch |
| 最后一步 ODE/SDE 更新 | MING-1c | graph step loop → `Solver.integrate` |
| speech API/adaptation | 对应规则 + Serving | `entrypoints/openai/tts_adapters/ming_tts.py::MingTTSAdapter` → `model_executor/models/ming_tts/ming_tts.py::MingTTSForConditionalGeneration` |

### [MING-1a] CFM graph 保持 eager 的 float32 solver 边界

- 触发：修改 `fm/cfm_cudagraph.py`、solver、noise/timestep 或 DiT cast。
- 强制：初始 noise、timesteps、SDE random/state 和积分保持 float32；只在 DiT forward 边界转模型 dtype，最终 latent 再按 eager 合同 cast。
- 验收：固定 noise/condition 下逐步比较 eager 与 graph state，覆盖默认 temperature=0。 ^[PR #4341]

### [MING-1b] CFG 近零分支与 eager 一致

- 触发：`cfg < 1e-5` 或 graph capture 中 cfg 作为 CUDA tensor。
- 强制：保留 eager unconditional 分支；graph 无法安全表达时明确回退 eager。
- 验收：cfg=0、阈值两侧和正常 cfg 的 eager/graph 输出分别对齐。 ^[PR #4341]

### [MING-1c] graph 最后一步更新复刻 Solver.integrate

- 触发：手写或展开 ODE/SDE step loop。
- 强制：核对每一步 dt/shift、最后一步 SDE 更新与 `Solver.integrate` 的确切顺序。
- 验收：逐步状态和最终 latent 同时对齐，测试必须单独断言最后一步。 ^[PR #4341]

### [MING-2a] MoE-only 依赖保持 lazy import

- 触发：dense/MoE 共用 package `__init__`、config 或 model factory。
- 强制：只在确认 MoE 分支后 import 新 vLLM MoE module；dense import 路径不依赖它。
- 验收：缺 MoE module 时 dense 模型可 import/构造；选择 MoE 时给出明确版本/依赖错误。 ^[PR #4341]
- 共享 graph/eager 规则见 [[diffusion-rules-1]]、[[diffusion-rules-2]]、[[diffusion-rules-3]]（Diffusion DIFF-1a）；模型语义证据矩阵见 [[model-validation]]（model validation）。

### [MING-3a] 说话人抽取必须区分引擎预取与离线下载

- 触发：修改 Ming-TTS 的 `SpeakerEmbeddingExtractor`、引擎模型预取、离线 speaker embedding 预处理，或调整 HF/ModelScope 模型路径策略。
- 强制：引擎内的 `SpeakerEmbeddingExtractor` 默认使用 `allow_download=False`，依赖已预取且包含 `campplus.onnx` 的模型目录；引擎构造前的离线 `end2end` 提取必须显式传 `allow_download=True`，并限制解析到 `campplus.onnx`。
- 验收：覆盖本地已解析目录、缓存命中/未命中和离线显式下载三条路径；确认缺失 `campplus.onnx` 明确失败，ModelScope 预取后的目录走短路，并验证 serving 与离线提取都能产生 speaker embedding。 ^[PR #6119]

### [MING-4a] ISTFT complex spectrum 必须由 FP32 operands 显式构造

- 触发：修改 common/ming/audio_dsp.py 的 ISTFTHead.forward 或 magnitude/phase 到 complex spectrum 的转换。
- 强制：先将 mag、x、y 显式转 float32，再构造 mag * (x + 1j*y)，得到 complex64；后续 streaming buffers、window 与 fused/native ISTFT 选择合同保持。
- 验收：覆盖 BF16、FP16、FP32 spectrum dtype 与 native FFT；FP32 control 要保持逐值一致；fused gate 与 streaming last-chunk/buffer 路径分别验证。当前 PR 无新增 regression test，模型 smoke 不能替代这些 dtype 边界检查。^[PR #7538]

## 决策与踩坑

- [MING-1a] 禁止：为减少 cast 把整段 ODE solve 降为 bf16；shape 和无 NaN 仍可能掩盖音频漂移。
- [MING-1b] 禁止：始终执行 cond/uncond chunk 和 CFG 公式，改变 cfg=0 的语义。
- [MING-1c] 禁止：用中间 step 的通用公式处理最后一步，或只比较前 N-1 步。
- [MING-2a] 禁止：顶层导入 MoE-only 模块，导致旧 vLLM 或 dense-only 环境无法 import Ming-TTS。
- [MING-3a] 禁止：在线请求路径在缓存未命中时隐式联网，离线引擎前处理使用 cache-only 却假定文件已经预取，或在 `VLLM_USE_MODELSCOPE` 下假定 HF 的 `local_files_only` 分支能够完成 ModelScope 首次解析。
- [MING-4a] 禁止：依赖 BF16/FP16 complex promotion，使新 torch dtype 落到 FFT 不支持的 bcomplex32/complex32；把局部 spectrum precision 修复写成全模型 FP32 或通用 XPU 性能提升。
