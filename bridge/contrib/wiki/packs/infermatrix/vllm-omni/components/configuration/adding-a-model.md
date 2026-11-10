---
name: adding-a-model
description: vLLM-Omni 新模型接入路径：三份官方 spec（adding_omni_model、adding_diffusion_model、adding_tts_model，main @ ebe93f5d 复核）、四个注册点（_OMNI_MODELS、_DIFFUSION_MODELS、OMNI_PIPELINES、deploy YAML）、TTS adapter 注册方式、参照模型与验收档位
metadata:
  scope: 只收新增模型时必须走的注册点和 TTS serving 适配入口；TTS detection 不变量（SERV-5e）归 rules-engine-lifecycle-1 至 rules-engine-lifecycle-2，模型目录入口见 models-overview，semantic parity 验收归 model-adaptation-guardrails-1 至 model-adaptation-guardrails-2
---
# 加新模型：三条官方路径与四个注册点

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/configuration/adding-a-model.md`（InferMatrixCopilot@ecfb84d0）；title: vLLM-Omni 新模型接入路径；type: guide；tags: vllm-omni, components, config, models；created: 2026-07-16；updated: 2026-09-03
- 来源（sources）：PR #5682；claude-workflow-starter-private@296ea45；.claude/skills/add-tts-model/SKILL.md；docs/contributing/model/；vllm_omni/entrypoints/openai/tts_adapters/
- 官方 spec（`main @ ebe93f5d` 复核）：`docs/contributing/model/adding_omni_model.md`（多 stage omni，以 Qwen3-Omni 为完整示例——目录结构/关键组件/注册/stage 配置/stage input processor/测试/recipe 九节）、`adding_diffusion_model.md`（纯 diffusion pipeline）、`adding_tts_model.md`（TTS）。仓库内的 `.claude/skills/add-*` 打包了同样的工作流。

### 四个注册点（漏一个都跑不起来）

| 注册点 | 位置 | 作用 |
|---|---|---|
| AR/omni 架构 | `model_executor/models/registry.py` `_OMNI_MODELS` | HF arch 名 → 模块/类 |
| Diffusion pipeline | `diffusion/registry.py` `_DIFFUSION_MODELS` | pipeline 类 → 模块 |
| Pipeline（model_type） | `config/pipeline_registry.py` `OMNI_PIPELINES` | model_type → 冻结拓扑/resolver（单 stage diffusion 不注册） |
| Deploy YAML | `vllm_omni/deploy/<model>.yaml` | bundled 默认部署 |

- 另有：跨 stage 转换 `stage_input_processors/<model>.py`（`ar2diffusion` 等）、serving TTS 适配 `entrypoints/openai/tts_adapters/`、`recipes/<Org>/<Model>.md`。

### TTS serving 适配

- AR TTS 新模型写一个 adapter，并在 `tts_adapters/__init__.py` 底部 import 注册；不要在 `serving_speech.py` 复制 stage 集合或增加 model-type branch。通常声明 `stage_keys`；stage 歧义/缺失时才声明 `model_archs`，只有无专有 stage 的 AR entry 才设 `arch_identifies_entry_stage`。
  - 非集合匹配用 `matches()`，部署拓扑能力用 `stage_serves_speech()`，真实冲突才设 `detect_priority`。详细 detection 不变量见 [[rules-engine-lifecycle-1]]（SERV-5e；源锚点 #serv-5e-tts-detection-从-adapter-metadata-的有序并集派生）。纯 diffusion TTS 仍走 `for_diffusion()` 直达路径，不能假设 adapter 的 `validate()`/`build()` 可达。

### 照抄谁

- 参照清单见 [[reference-models]]（reference-models）（GLM-Image / BAGEL）与 [[qwen-omni-overview]]（qwen-omni）；当前注册全量见 [[models-catalog]]（models/catalog）。

### 验收档位

- plumbing 绿灯（0 missing/0 unexpected、shape smoke、mock 权重）**不等于**语义正确——semantic parity 矩阵与逐入口验收见 [[model-adaptation-guardrails-1]]、[[model-adaptation-guardrails-2]]（model-adaptation-guardrails） 与仓库 [[vllm-omni-rules-1]]、[[vllm-omni-rules-2]]、[[vllm-omni-rules-3]]（rules.md） 第 3 节。
