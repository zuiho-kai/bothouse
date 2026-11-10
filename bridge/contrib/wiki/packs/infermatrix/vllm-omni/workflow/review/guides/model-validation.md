---
name: model-validation
description: "新模型接入验证：2026-05-26 PR #3474 GO-1-Air 反例（load_state_dict 0 missing 但 timestep cos/sin 顺序、activation、token order、DPM-Solver、pad==eos 掩码全偏离上游），以及 Evidence Matrix 必补的 S1–S5 语义列与一句话规则"
metadata:
  scope: 只收 shape / clean load 不等于语义等价的验证规则与 S1–S5 矩阵；PR body 中的证据分层写法归 pr-body-model-evidence，模型适配完整性归 model-adaptation-guardrails-1、model-adaptation-guardrails-2，审查入口归 review-guides-overview
---
# 新模型接入验证

## 关键事实

- 源页：`knowledge/repos/vllm-omni/review/guides/model-validation.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, review；created: 2026-07-10；updated: 2026-07-16
- 来源（sources）：#3474

### 新模型接入验证：shape / clean load 不等于语义等价

- **新模型 PR Evidence Matrix 必须补语义列**：

| ID | 必填项 | 要求 |
| --- | --- | --- |
| S1 | Upstream semantic parity matrix | scheduler / denoising loop、embedding basis 与 `cos/sin` 顺序、activation、token / joint order、special token 与 pad/eos、attention mask、preprocess / resize / mask、noise contract |
| S2 | Real checkpoint fail-fast | tokenizer 缺失、processor 缺失、strict load mismatch、关键 config 缺字段必须早炸；禁止 silent fallback 到 stub / zero input |
| S3 | Stub vs real separation | stub smoke 只能证明 plumbing；real checkpoint / official input / e2e 结论必须单独列证据 |
| S4 | Negative input contract | pad==eos、mask shape、batch size mismatch、noise/action shape mismatch、image shape / dtype mismatch 必须有坏路径测试或明确 early error |
| S5 | Owner audit | 至少一轮 module owner + omni project owner 视角，分别审语义对齐与集成面 |

- **一句话规则**：新模型接入的验证目标不是“能 load、shape 对、stub 能跑”，而是“每个 shape-compatible 语义选择都有 upstream 证据或显式偏离说明”。

## 决策与踩坑

### 新模型接入验证：shape / clean load 不等于语义等价

- **2026-05-26 PR #3474 GO-1-Air 反例**：重构后 `load_state_dict` 做到 `0 missing / 0 unexpected`，stub smoke 能跑，输出 shape / NaN / Inf 都干净；但双 owner 视角审核后仍暴露一组 shape-compatible semantic bugs：
  - timestep embedding 顺序写成 `sin, cos`，上游是 `cos, sin`
  - state/action/final MLP activation 写成 `SiLU`，上游是 tanh GELU
  - joint token order 写成 `freq,time,state,action`，上游语义是 `time,freq,state,action`
  - denoising loop 手写 alpha-bar Euler，没对齐上游 DPM-Solver scheduler
  - attention mask 用 `input_ids != pad_id`，但 tokenizer `pad_id == eos_id` 时会把 EOS 当 padding
  - real checkpoint tokenizer 加载失败后被 stub / zero-action 路径掩盖，导致 smoke 结果冒充 real checkpoint 验证
- 这些 bug 都不会被 shape、strict weight load、no-NaN smoke 抓住，因为 tensor contract 成立但模型语义已经偏离 upstream。
