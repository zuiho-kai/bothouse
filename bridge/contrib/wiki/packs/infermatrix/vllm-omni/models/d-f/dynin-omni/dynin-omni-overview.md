---
name: dynin-omni-overview
description: "Dynin-Omni（snu-aidas，main @ 5d44868e）目录入口：pipeline key dynin_omni 的 token2text → token2image → token2audio 三 stage 链（全部 LLM_GENERATION、latent、final_output）、各入口路径、模型逻辑几乎全是 checkpoint 内远程代码（trust_remote_code: true 是承重配置）、三份 deploy 的差异（dynin_omni_ci.yaml 显式 pin pipeline；multiconnector 只接 mooncake_connector 且 trust_remote_code: false 矛盾未解）"
metadata:
  scope: 只收 Dynin-Omni 的名称、三 stage 拓扑、入口路径和 deploy / checkpoint 差异；detok_id 协议、远程代码装载和 IPC 交接的数据流归 dynin-omni-architecture
---
# Dynin-Omni

## 现状

- 以下事实在 `main @ 5d44868e` 复核。

### 名称与范围

- 代码/pipeline 标识 `dynin_omni`;checkpoint 组织为 snu-aidas（`snu-aidas/Dynin-Omni` 来自 examples README,YAML 不 pin）。AR registry: `DyninOmniForConditionalGeneration` →（`dynin_omni`, `dynin_omni`,同名类）; **无 diffusion registry 入口**。
- 入口路径：拓扑 `vllm_omni/model_executor/models/dynin_omni/pipeline.py`（注册于 `vllm_omni/config/pipeline_registry.py`）;stage 分发壳 `dynin_omni.py`;三个 stage 实现 `dynin_omni_token2{text,image,audio}.py` + 共享设施 `dynin_omni_common.py`;
  - 桥 `vllm_omni/model_executor/stage_input_processors/dynin_omni.py`;deploy `vllm_omni/deploy/dynin_omni{,_ci,_multiconnector}.yaml`。
- pipeline key `dynin_omni`：三 stage 链,**全部 LLM_GENERATION、全部 `engine_output_type="latent"`、全部 `final_output=True`**——stage 0 token2text（`owns_tokenizer=True`,`final_output_type="text"`, `custom_process_next_stage_input_func=token2text_to_token2image_full_payload`）→
  - stage 1 token2image（`input_sources=(0,)`,`final_output_type="image"`, 入 `token2text_to_token2image`、出 `token2image_to_token2audio_full_payload`）→ stage 2 token2audio（`input_sources=(1,)`,`final_output_type="audio"`,入 `token2image_to_token2audio`）。
  - **唯一冻结拓扑,无 think/单 stage 变体** ——变化只来自按请求任务路由与三份 deploy。
- 依赖共享模块：worker-connector 全载荷数据面（`OmniConnectorModelRunnerMixin`）、[[configuration-architecture]]（Config 组件）。

### 目录内容

| 遇到什么 | 查看哪里 | 说明 |
|---|---|---|
| detok_id 协议、远程代码机器、IPC 陷阱 | [[dynin-omni-architecture]]（architecture） | 数据流与 reviewer 陷阱 |

### 配置与 checkpoint 差异

- 模型逻辑几乎全是 **checkpoint 内远程代码**（LLaDA 系 LM、采样函数、MAGVITv2 图像 VQ、EMOVA speech tokenizer、s2u vendor 树）——树内只是编排 + 兼容 shim（pin 上 token2text 侧 4 个 transformers≥5 shim,token2audio 侧另有 tied-weights shim）;`trust_remote_code: true` 是承重配置。
- 三份 deploy：默认（单卡,显存 0.5/0.1/0.1——stage 0 持 LM,stage 1/2 只懒加载各自的 VQ/语音解码模型）;
  - `dynin_omni_ci.yaml`（**显式 pin `pipeline: dynin_omni`,防 model_type 自动探测失配**;L4 级显存）;`dynin_omni_multiconnector.yaml`（定义 Mooncake/Yuanrong/SHM 三种连接器,但 stage 间 output/input 链接 **显式只接 `mooncake_connector`**——Yuanrong/SHM 定义了但未接线;此文件 `trust_remote_code: false` 与家族要求矛盾,pin 上无解释——评审改这份 YAML 时先澄清）。

### 什么时候查这里

- 审查 dynin_omni 的 stage 交接、远程代码加载或 transformers 升级兼容; transformers 升级 PR 把本家族当高危回归点。
- 语义验收见 [[model-validation]]（model-validation）。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/dynin-omni/_index.md`（InferMatrixCopilot@ecfb84d0）；title: Dynin-Omni（三 stage 全 LLM_GENERATION,远程代码为主）；type: index；tags: vllm-omni, models；created: 2026-07-21；updated: 2026-07-21
- 来源（sources）：vllm_omni/model_executor/models/dynin_omni/；vllm_omni/deploy/dynin_omni.yaml；vllm_omni/config/pipeline_registry.py
