---
name: glm-image-rules
description: "GLM-Image token-ID handoff 规则 GLMIMAGE-IDS-1a：generated IDs 走 cumulative_token_ids、source-image IDs 保持 ids.prior_image，TOKEN_IDS 类型只改共享 naming/retention，辅助 hidden 不能替代 ar2diffusion bridge 的离散 IDs（PR #7843）"
metadata:
  scope: 只收 GLMIMAGE-IDS-1a 一条规则及其代码入口表；AR→DiT 数据流归 glm-image-architecture，共享的输出 parsing / accumulation 合同归 rules-output-contract
---
# GLM-Image token-ID handoff 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/glm-image/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, diffusion；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #7843
- 置信度（confidence）：high

### Direct 代码快速入口

- （以下为原表格，按行改写为条目）
- PR 描述信号：TOKEN_IDS、generated/source IDs、AR→DiT、auxiliary hidden
  - 规则组：`GLMIMAGE-IDS-1a`；共享 naming/accumulation 另查 [[rules-output-contract]]（输出合同）
  - 第一批源码：`vllm_omni/model_executor/stage_input_processors/glm_image.py::ar2diffusion`；`vllm_omni/outputs/output_modality.py`、`vllm_omni/outputs/output_processor.py`；`tests/model_executor/stage_input_processors/test_glm_image.py`

### [GLMIMAGE-IDS-1a] generated IDs 与 source-image IDs 必须保留各自 handoff

- 触发：修改 GLM-Image engine_output_type、AR auxiliary output 或 ar2diffusion bridge。
- 强制：generated IDs 仍走 cumulative_token_ids，source-image IDs 保持 ids.prior_image；TOKEN_IDS 类型只改变共享 naming/retention，不为 GLM 另加 generic hidden 的特殊重命名。辅助 hidden 即使命名为 token_ids，值也仍是原 tensor，不能替代 bridge 的真实离散 IDs。
- 验收：T2I 与 I2I 分别断言 generated/source IDs 到达正确输入、EOS 处理与已有语义保持；若新增 auxiliary consumer，另核实其 dtype/shape/value 和命名含义。^[PR #7843]
- 共享 parsing 与 accumulation 见 [[rules-output-contract]]（输出合同）；AR→DiT 数据流见 [[glm-image-architecture]]（模型架构）。

## 决策与踩坑

- [GLMIMAGE-IDS-1a] 禁止：为 output-type 改名重写已正确的 ar2diffusion；把仅 eager 单 NVIDIA T2I/I2I 的 matched PNG parity 视为 NPU/optional auxiliary producer 或全模式表示验证。
