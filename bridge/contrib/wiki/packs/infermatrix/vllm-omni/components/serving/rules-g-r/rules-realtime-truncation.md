---
name: rules-realtime-truncation
description: "规则 RT-TRUNC-1：Realtime 自动截断只移动独立的 first-item model cursor，完整 conversation items 仍可 retrieve / delete；预算探测用无 cache 的 speculative render 并预留输出预算，只把 input_text / input_tokens 超限当作可截断错误（PR #8566）"
metadata:
  scope: 只收 Realtime model-context 自动截断这一条规则；预算预检与替换 response 的 cache 合同（SERV-RT-1h）及 transcript truncate（SERV-RT-1d、SERV-RT-1i）归 rules-realtime-openai
---
# Realtime model-context 自动截断合同

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/serving/rules-realtime-truncation.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components；created: 2026-10-09；updated: 2026-10-09
- 来源（sources）：PR #8566
- 置信度（confidence）：high
- [RT-TRUNC-1] 截断只移动 model cursor，保留可操作的 conversation history
  - 触发：修改 Realtime prompt budget、conversation item 插入/删除或自动截断。
  - 强制：完整 items 仍可 retrieve/delete；模型上下文从独立 first-item cursor 取后缀，cursor item 删除时前移，cursor 已在末尾时新 append 可进入模型上下文。预算探测用无 cache 的 speculative render，预留输出预算，按后缀探测可容纳输入；只把 input_text/input_tokens 超限识别为可截断错误。
  - 验收：覆盖 retrieve/delete、cursor 删除/末尾追加、超长历史、输出预算和无关错误传播；检查实际送入模型的 prompt，若最终 render 变化需另验证预算。 ^[PR #8566]

## 决策与踩坑

- [RT-TRUNC-1] 禁止：为缩短 prompt 删除用户历史；吞掉无关 render/model 错误；把 preflight 探测说成对最终再次 render 的无条件长度保证。
