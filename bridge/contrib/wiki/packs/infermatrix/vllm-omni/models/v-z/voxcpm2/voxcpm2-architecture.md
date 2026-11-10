---
name: voxcpm2-architecture
description: VoxCPM2 架构：MiniCPM4PagedForVoxCPM2 28 层 base LM → FSQ → 8 层 residual LM → LocDiT/CFM → AudioVAE 的单 stage 模型链、fp32 数值孤岛与 muP 缩放中和、多套 CUDA-graph 容器、统一 decode graph 与调度器推迟接纳等待请求的协作、StaticKVCache 还原与 _RequestState 泄漏告警阈值 512、e2e / dfx 验证入口与已知未决
metadata:
  scope: 只收 VoxCPM2 的模型链、配置与兼容范围、主要流程、验证入口与已知未决；名称、registry 与 knob 速览归 voxcpm2-overview，可执行规则归 voxcpm2-rules 与 rules-npu-graphs
---
# VoxCPM2 架构

## 现状

- 事实在 `main @ 5d44868e` 复核;入口/knob 速览见 [[voxcpm2-overview]]（index）。

### 模型专有部分与共享模块的边界

- 模型链（全在一个 vLLM AR stage 内）：`MiniCPM4PagedForVoxCPM2`（28 层分页 base LM,fp32 RoPE）→ FSQ 量化 → `MiniCPM4PagedResidualLM`（8 层,无 RoPE）→ LocDiT（CFM 求解器）→ AudioVAE → 48 kHz 波形。原生包的重复 base/residual LM 在权重拷入分页模块后删除,`tts_model` 留作侧路。
- **fp32 数值孤岛**：RoPE/RMSNorm/MLP 在 bf16 模型内保 fp32 以位级对齐原生实现;`VoxCPM2Config` 把嵌套 `lm_config` 提升到顶层并**中和 muP 缩放**（`use_mup=false` 训练,`scale_emb=1.0` 等）——别把这些"归一化"掉。
- 性能基建（`voxcpm2_talker.py` ~2000 行）：多套 CUDA-graph 容器（CFM/VAE/统一 decode）、LocDiT 手术安装器（融合 qkv/mlp、zero-dt cache）、`_CFMBufferManager`、优化 Euler 求解器、NVTX 计时。
- 共享：AR runner 的 padded FULL attention 元数据钩子（graph 策略留在模型层,不 fork runner）;serving 侧 CJK 多字 token 拆分（对齐原生分词粒度）。

### 配置、checkpoint 和兼容范围

- 变体轴 = `voxcpm2_runtime_config`（hf_overrides）+ 平台能力回退（talker 内 CUDA graph/torch.compile 可用性检查、`decode_graph_capture_policy`）;deploy 默认开批式 CFM/VAE、统一 decode graph（max batch 8）、`vae_decode_every: 3`。
- 声音克隆零样本:无预置 preset;自定义声音经 `precompute_custom_voice.py` 预计算张量 profile,speaker cache 校验加载;纯 embedding 上传被拒（那是 Qwen3-TTS 专属格式）。
- checkpoint 范围：deploy YAML 不 pin;示例/测试用 `openbmb/VoxCPM2`;无 checkpoint/拓扑变体有据。
- `stop_token_ids: [1]`（config bos=1/eos=2）——停在 id 1 的语义 pin 上无注释,未决。

### 从输入到输出的主要流程

1. serving `_build_voxcpm2_prompt`（带原始波形元组做 prefill 长度记账）; 服务器预热把 ~15 s 的 compile/graph 捕获挪出首请求。
2. AR 步循环:base LM 出 patch latent → FSQ → residual LM → LocDiT/CFM 去噪;流式 AudioVAE 解码按 `vae_decode_every` 节奏滑窗执行（尾部 12 pad 帧当 VAE 感受野上下文）→ 流式发射音频。
3. **统一 decode graph 与调度器协作**：全批 decode graph 只对纯 decode 批有效,`VoxCPM2OmniARAsyncScheduler` 在 decode-ready 请求运行时**推迟接纳等待请求**（模型局部服务策略,非通用 AR 调度规则）——改通用调度器时勿把这段"顺手泛化"。
4. 每请求原生 StaticKVCache 在步边界还原进分页注意力;`_RequestState` 生命周期带泄漏告警阈值（512),驱逐有专测。

### 怎样验证功能、精度和性能

- 功能面之外另有 dfx 套件（可靠性/稳定性/perf 定义,见下),但仅凭这些来源不能得出精度或性能结论——需另行实测。
- e2e：`tests/e2e/offline_inference/test_voxcpm2_tts.py`、`tests/e2e/online_serving/test_voxcpm2_tts.py`、`tests/e2e/online_serving/test_voxcpm2_tts_expansion.py`;单测 `tests/model_executor/models/voxcpm2/test_runner_assisted_unified_graph_static.py`、
  - `tests/model_executor/models/voxcpm2/test_talker_state_eviction.py`;dfx `tests/dfx/reliability/test_reliability_voxcpm2.py`、`tests/dfx/stability/scripts/test_stability_voxcpm2.py`、`tests/dfx/{perf,stability}/tests/test_voxcpm2.json`;
  - 示例 `examples/{offline_inference,online_serving}/text_to_speech/voxcpm2/`（含 gradio 流式 demo 与自定义声音预计算）;语义验收方法见 [[model-validation]]（model-validation）。
- 已知未决：原生包 pin 版本;stop id 1 vs 2 语义;scheduler 每次调用重建 runtime config 是否位于热路径（未测,开放问题）。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/voxcpm2/architecture.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: vllm-omni, models；created: 2026-07-21；updated: 2026-07-21
- 来源（sources）：vllm_omni/model_executor/models/voxcpm2/voxcpm2_talker.py；vllm_omni/model_executor/models/voxcpm2/scheduler.py；vllm_omni/model_executor/models/voxcpm2/runtime_config.py；vllm_omni/transformers_utils/configs/voxcpm2.py
