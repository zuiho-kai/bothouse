---
name: reference-models
description: 新模型适配的钦定参照（main @ 5d44868e，2026-07-21 修订页面分级规则）：GLM-Image 作 AR+DiT 多 stage 的 IT2I 精度参照、BAGEL 作统一模型多形态部署参照（bagel / bagel_think / bagel_single_stage 三个 key）、Qwen2.5/3-Omni 作 thinker/talker 多 stage 参照，各自何时参考与落脚页
metadata:
  scope: 只收参照模型的用途定位和指向各落脚页的指针；入口细节归各模型页（glm-image-overview、bagel-overview、qwen-omni-overview），registry 定位归 models-catalog
---
# 新模型适配的钦定参照

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/reference-models.md`（InferMatrixCopilot@ecfb84d0）；title: 新模型适配的钦定参照（GLM-Image / BAGEL / Qwen-Omni 指针）；type: guide；tags: vllm-omni, models；created: 2026-07-16；updated: 2026-07-21
- 来源（sources）：vllm_omni/model_executor/models/registry.py；vllm_omni/config/pipeline_registry.py；vllm_omni/deploy/
- 树内多处把这几个模型当"参照基准"（blessed precedent）引用。2026-07-21 起全部 registry 家族都有落脚页（源码派生,`main @ 5d44868e`）;本页只保留 **参照定位**——按用途指路,不再重复入口细节。
- 页面分级规则（2026-07-21 修订）：源码派生的 `_index`/`architecture` 页是 **基线覆盖**,任何家族都可有;`rules.md`、guides、incidents 仍然只在**第一条模型专属稳定结论**出现时创建——不预建、不从源码猜规则。

### GLM-Image — AR+DiT 多 stage 的 IT2I 精度参照

- 何时参考：做 AR→DiT 桥接、IT2I 行为对齐时（hunyuan 的 [[it2i-gap-1]]、[[it2i-gap-2]]（it2i-gap） 与 [[hunyuan-image3-history-overview]]（ar-dit-bridge 历史） 均以它为基准）。
- 落脚页：[[glm-image-overview]]（glm-image）（token 桥、编辑 KV cache、魔数矩阵、MRoPE 隐性依赖）。

### BAGEL — 统一模型多形态部署参照

- 何时参考：一个模型要支持多种 stage 拓扑/思考形态时——pipeline registry 里同时有 `bagel`、`bagel_think`、`bagel_single_stage` 三个 key,deploy 三份。
- 落脚页：[[bagel-overview]]（bagel）（KV 桥、3 路 CFG 伴随请求、MoT）;派生家族 [[lance-overview]]（lance）。
- 相关硬规则：多 stage 共卡显存预算见 [[configuration-rules-1]]、[[configuration-rules-2]]、[[configuration-rules-3]]（Config 规则 CONF-1a）（Bagel 正是案例）。

### Qwen2.5/3-Omni — thinker/talker 多 stage 全家桶参照

- 已有独立目录：[[qwen-omni-overview]]（qwen-omni）（I2T blessed pattern、异步运行时的官方 worked example）。
- 对照形态：融合 thinker+talker 单 stage 见 [[mimo-audio-overview]]（mimo-audio）;文本桥（非 hidden 桥）talker 见 [[ming-flash-omni-overview]]（ming-flash-omni）。

### 相关

- 加模型的注册点清单见 [[adding-a-model]]（adding-a-model）。
- 语义验收（plumbing≠语义）见 [[model-adaptation-guardrails-1]]、[[model-adaptation-guardrails-2]]（model-adaptation-guardrails）。
