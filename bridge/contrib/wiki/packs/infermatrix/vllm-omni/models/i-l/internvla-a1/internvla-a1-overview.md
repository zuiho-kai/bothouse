---
name: internvla-a1-overview
description: InternVLA-A1 目录入口：视觉-语言-动作（VLA）机器人策略而非媒体生成模型（Qwen3-VL backbone + action-expert + Cosmos flow-matching 动作头），以动作 pipeline 形态跑在 diffusion 引擎下；InternVLAA1Pipeline registry 条目、7 个源码文件、观测字典输入与 regionally_compile
metadata:
  scope: 只收名称范围、registry、源码文件、结构要点和何时查；本页是源码派生、尚无运行经验沉淀；同为 VLA 的另一家族归 gr00t-overview，名称相近的 Cosmos 家族归 cosmos3-overview
---
# InternVLA-A1

## 现状

- 以下事实在 `main @ 5d44868e` 复核（源码派生页,尚无本模型的运行经验沉淀）。

### 名称与范围

- **不是媒体生成模型**：vision-language-action 机器人策略（Qwen3-VL backbone + action-expert transformer + Cosmos flow-matching 动作头）,以"动作 pipeline" 形态跑在 diffusion 引擎下。树内另一 VLA 家族：[[gr00t-overview]]（gr00t）。
- 无别名、无变体有据,树内未 pin checkpoint。diffusion registry: `InternVLAA1Pipeline` →（`internvla_a1`, `pipeline_internvla_a1`, `InternVLAA1Pipeline`）,post `get_internvla_a1_post_process_func`（薄封装）。单 stage,引擎默认 stage 配置（[[configuration-architecture]]（Config 组件））。无 deploy YAML。
- 源码（7 文件,尾部家族里最异构）：`model_internvla_a1.py`（41 KB, `Qwen3VLWithExpertModel`/`InternVLAA1Policy`/`resolve_cosmos_checkpoint_paths`）、`adapter_qwen3_vl.py`（重写的 Qwen3-VL attention/caching 层）、`cosmos_ci_torch.py` + `model_cosmos.py`（家族目录内的 Cosmos 动作扩散组件;与 [[cosmos3-overview]]（cosmos3） 是不同目录）、
  - `config.py`（`OBS_IMAGES`/`OBS_STATE`/`OBS_TASK` 观测键 + `DEFAULT_QWEN3_VL_MODEL`/`DEFAULT_COSMOS_REPO`）。

### 结构与要点

- 输入是观测字典（images/state/task）而非 prompt;`SuffixStaticContext` 静态 cache + `OPENPI_ATTENTION_MASK_VALUE`（OpenPI 风格掩码）。
- pipeline 用 `vllm_omni.diffusion.compile.regionally_compile`。

### 什么时候查这里

- 审查 VLA 观测输入、动作头或 Qwen3-VL adapter 改动;评审时先确认改动属于 internvla_a1 还是 gr00t（两个独立家族目录）。主类 `InternVLAA1` 与 pipeline 包装 `pipeline_internvla_a1.py` 都在本家族目录内。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/internvla-a1/_index.md`（InferMatrixCopilot@ecfb84d0）；title: InternVLA-A1（视觉-语言-动作机器人策略）；type: index；tags: vllm-omni, models, diffusion；created: 2026-07-21；updated: 2026-07-21
- 来源（sources）：vllm_omni/diffusion/models/internvla_a1/；vllm_omni/diffusion/registry.py
