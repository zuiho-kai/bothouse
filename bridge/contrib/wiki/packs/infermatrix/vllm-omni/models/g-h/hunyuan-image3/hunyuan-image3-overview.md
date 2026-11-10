---
name: hunyuan-image3-overview
description: HunyuanImage3（hunyuan_image3）目录入口：按场景分流到开发规则、paged KV control plane、架构代码地图、HF 对齐三篇指南、IT2I gap 报告、官方 prompt 格式、官方 demo 运行、incidents、history 与 ROCm 规则
metadata:
  scope: 只收 HunyuanImage3 目录的别名、适用范围和分流表；规则正文归 hunyuan-image3-rules-1、hunyuan-image3-rules-2 与 rules-rocm，代码地图归 hunyuan-image3-architecture，多模型共享的 diffusion / serving 机制不放这里
---
# HunyuanImage3

## 现状

- 常见别名：`HunyuanImage3`、`hunyuan_image3`
- 适用范围：HunyuanImage3 的模型结构、配置、checkpoint、对齐和专有流程

### 什么时候查这里

- 问题只属于 HunyuanImage3，而不是多个模型共用的代码模块。

### 不放什么

- 多模型共享的 diffusion、serving 或 model-executor 机制。

### 目录内容

| 遇到什么 | 查看哪里 |
|---|---|
| 修改公开入口、prompt、AR→DiT、`model_extras`、shared task examples、条件图、size、seed 或 MoE expert mapping | [[hunyuan-image3-rules-1]]（开发快速入口和 rules；源锚点 #direct-开发快速入口） |

- （以下为原表格，按行改写为条目）
- 遇到什么：Scheduler-managed paged KV、prepared layout、CFG logical prefix、Hunyuan Q/K/V spans 或空 hash 边界
  - 查看哪里：[[paged-kv-control-plane]]（shared paged KV control plane）
- 遇到什么：理解模型和 vLLM-Omni 代码地图
  - 查看哪里：[[hunyuan-image3-architecture]]（architecture）
- 遇到什么：HF 接入常见偏差
  - 查看哪里：[[hf-alignment-pitfalls]]（HF alignment pitfalls）
- 遇到什么：运行 HF baseline
  - 查看哪里：[[hf-baseline-runbook-1]]、[[hf-baseline-runbook-2]]（HF baseline runbook）
- 遇到什么：对齐 HF 与 Omni 输出
  - 查看哪里：[[hf-omni-alignment-method-1]]、[[hf-omni-alignment-method-2]]（HF/Omni alignment method）
- 遇到什么：调查 img-to-img 差距
  - 查看哪里：[[it2i-gap-1]]、[[it2i-gap-2]]（it2i gap）
- 遇到什么：核对官方 prompt 格式
  - 查看哪里：[[official-prompt-format]]（official prompt format）
- 遇到什么：运行 image generation demo
  - 查看哪里：[[run-image-gen-demo]]（run image-gen demo）
- 遇到什么：调查模型专有错误
  - 查看哪里：[[hunyuan-image3-incidents-overview]]（incidents）
- 遇到什么：查询已结束的历史分析
  - 查看哪里：[[hunyuan-image3-history-overview]]（history）
- [[rules-rocm]]（HunyuanImage3 ROCm VAE 与 accuracy 合同）。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, models, hunyuan-image3；created: 2026-07-10；updated: 2026-09-22
- 来源（sources）：PR #5541；PR #6563；PR #4048；vllm_omni/diffusion/models/hunyuan_image3/pipeline_hunyuan_image3.py；vllm_omni/diffusion/models/hunyuan_image3/hunyuan_image3_transformer.py；vllm_omni/diffusion/models/hunyuan_image3/hunyuan_image3_tokenizer.py
  - vllm_omni/diffusion/models/hunyuan_image3/request_layout.py
