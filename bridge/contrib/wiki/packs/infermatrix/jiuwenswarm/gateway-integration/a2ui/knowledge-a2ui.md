---
name: knowledge-a2ui
description: a2ui owner 知识：Web-only 边界与对模型输出缺陷的容错、既有验证入口、前端 dispatchA2UIAction 动作分发、配置键与布尔归一化差异、*WithDefaults 组件覆盖、前端解析渲染与事件分发架构
metadata:
  scope: 只收 a2ui owner 的设计取舍、验证入口与前端行为；功能概览归 feature-a2ui，后端 finalize 实现细节归 feature-depth-a2ui
---
# a2ui owner — A2UI 生成式界面（后端集成与 Web 前端渲染）

## 现状

- **Web-only 边界与对模型输出缺陷的防御性容错**
- Inference / 设计推断（非作者历史意图）：
- 设计取舍（文档有明确记录）：A2UI 完整闭环依赖可控的浏览器 runtime（React/DOM、surface 状态、client_event 回传），因此 channel 策略集中在 `is_a2ui_channel`，当前仅 `web` 为真；非 Web 渠道直接 bypass，包括不做文本 fallback（`apply_non_web_text_fallback_to_payload` 现为透传的兼容 hook），换取 IM 渠道不感知 A2UI、普通聊天流程不受影响。
  - 推断（代码注释佐证但非作者完整陈述）：前端大量容错是针对模型输出质量的花费——`cleanActionContext` 修复模型生成的 `[object Object]` context 键，`extractTextFromMalformedA2UI` 从坏 JSON 中抢救可读文本；这些启发式提高可用性但可能丢失或改写原始语义。
- Sources / 来源：[jiuwenswarm/server/runtime/a2ui/integration.py:L120–L140](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/a2ui/integration.py#L120-L140),
  - [docs/zh/A2UI-IM-channel-analysis.md:L100–L122](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/A2UI-IM-channel-analysis.md#L100-L122),
  - [jiuwenswarm/channels/web/frontend/src/features/a2ui/actionBridge.ts:L36–L99](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/a2ui/actionBridge.ts#L36-L99),
  - [jiuwenswarm/channels/web/frontend/src/features/a2ui/a2uiContent.ts:L169–L211](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/a2ui/a2uiContent.ts#L169-L211)
- **既有验证入口**
- 文档列出测试位置：`tests/unit_tests/a2ui/`、`tests/system_tests/test_a2ui_system_flow.py` 和前端脚本 `channels/web/frontend/scripts/test-a2ui-action-defaults.mjs`，并给出 pytest/npm build/ node 脚本的验证命令；
  - Web-only PR 记录称 `test_integration_bridge.py`、`test_web_only_prompt_rail.py`、`test_feature_config.py` 覆盖 channel 策略、非 Web bypass 等行为（记录为 18 passed，是否当前仍通过未在本证据中复验）。
  - 前端各组件带稳定 `data-testid`（如 `a2ui-message-content`、`a2ui-multiplechoice`、`a2ui-textfield-input`），且 `A2UIMessageContent` 在 DEV 模式下用 requestAnimationFrame 检测横向溢出容器，可支撑 UI 级断言与调试。
- Sources / 来源：[docs/zh/A2UI.md:L72–L87](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/A2UI.md#L72-L87),
  - [docs/zh/A2UI-web-only-pr-record.md:L19–L35](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/A2UI-web-only-pr-record.md#L19-L35),
  - [jiuwenswarm/channels/web/frontend/src/features/a2ui/A2UIMessageContent.tsx:L124–L155](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/a2ui/A2UIMessageContent.tsx#L124-L155)
- **动作分发与事件转模型的入口契约**
- `dispatchA2UIAction(message)` 是前端交互出口：`open_form` 和 `close_modal` 被列为 frontend-only 动作直接跳过（注释说明是为了避免 chat.send 取消仍在渲染 A2UI surface 的流）；没有注册 handler 时记录开发警告并返回，重复的 in-flight 动作按 surfaceId+componentId+name 去重。
  - 后端入口 `build_user_prompt_if_a2ui_event(content, channel, language)` 仅当 channel 为 web、A2UI 开启且 content 是 `type == "a2ui.client_event"` 的 dict 时委托 `build_a2ui_client_event_prompt`，否则返回 None 让普通 prompt 流程继续。后端解析入口 `parse_a2ui_response` 先尝试整体 JSONL/JSON，再用 SDK 的 tagged 解析，返回 text/a2ui part 列表。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/src/features/a2ui/actionBridge.ts:L125–L199](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/a2ui/actionBridge.ts#L125-L199),
  - [jiuwenswarm/server/runtime/a2ui/integration.py:L65–L87](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/a2ui/integration.py#L65-L87),
  - [jiuwenswarm/server/runtime/a2ui/parser.py:L92–L118](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/a2ui/parser.py#L92-L118)
- **配置键、默认值与前后端布尔归一化差异**
- 文档给出 `config.yaml` 默认 `a2ui.enabled: false`（另有 protocol_version "0.8"、stream_validation_enabled、non_web_fallback_enabled），可通过 Web 配置页开关、`config.yaml` 或 `JIUWENSWARM_A2UI_ENABLED` 控制；代码中 `get_default_a2ui_config_payload` 也以 `a2ui_enabled: "false"` 作为兜底。
  - 注意前后端布尔归一化并不等价：后端 `_to_bool` 只把 true/1/yes/on 视为真，前端 `normalizeA2UIEnabled` 把除 0/false/no/off 之外的一切（含缺失值）视为真；且 `validate_a2ui_config_update` 只校验并返回映射到 config.yaml 键的更新（`a2ui_enabled` → `enabled`），本身不写配置。
- Sources / 来源：[docs/zh/A2UI.md:L37–L55](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/A2UI.md#L37-L55),
  - [jiuwenswarm/server/runtime/a2ui/integration.py:L36–L45](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/a2ui/integration.py#L36-L45),
  - [jiuwenswarm/channels/web/frontend/src/features/a2ui/featureConfig.ts:L34–L43](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/a2ui/featureConfig.ts#L34-L43),
  - [jiuwenswarm/server/runtime/a2ui/integration.py:L146–L155](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/a2ui/integration.py#L146-L155)
- **前端组件覆盖与组件变体行为**
- 前端通过 `ComponentRegistry` 用 `*WithDefaults` 组件覆盖 Text、CheckBox、DateTimeInput、MultipleChoice、Slider、TextField 六种组件：覆盖在模块加载时提前注册一次，并在渲染器首次渲染时检查 `TextField` 是否仍是本组件、被库的惰性初始化覆盖时才重新应用。
  - MultipleChoice 支持三种呈现——`type === 'chips'` 渲染为可选中的按钮 chips，多选（variant/type 为 chips/checkbox 或 maxAllowedSelections > 1）渲染为复选框列表，否则渲染为单选 `<select>` 下拉；过滤搜索框（filterable 为 true 或选项 ≥10 时显示）只出现在 chips 和复选框两种变体中，单选下拉不渲染搜索。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/src/features/a2ui/rendererRegistry.tsx:L22–L59](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/a2ui/rendererRegistry.tsx#L22-L59),
  - [jiuwenswarm/channels/web/frontend/src/features/a2ui/MultipleChoiceWithDefaults.tsx:L91–L110](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/a2ui/MultipleChoiceWithDefaults.tsx#L91-L110),
  - [jiuwenswarm/channels/web/frontend/src/features/a2ui/MultipleChoiceWithDefaults.tsx:L150–L169](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/a2ui/MultipleChoiceWithDefaults.tsx#L150-L169),
  - [jiuwenswarm/channels/web/frontend/src/features/a2ui/MultipleChoiceWithDefaults.tsx:L254–L287](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/a2ui/MultipleChoiceWithDefaults.tsx#L254-L287)
- **A2UI 前端架构：解析、渲染与事件分发职责**
- Web 前端 A2UI 逻辑集中在 `channels/web/frontend/src/features/a2ui/`：`A2UIMessageContent` 解析 assistant message 中的 `<a2ui-json>` 块（`parseA2UIContent`），按协议版本从 `rendererRegistry` 取 renderer，将每个 surface 包在 `A2UIErrorBoundary` 内渲染，并把消息命名空间化后交给 `processMessages`。
  - 用户交互走 `dispatchA2UIAction`：它把消息直接传给已注册的 handler（不在此处包装协议信封），并做 frontend-only 动作短路、in-flight 去重与 context 清洗；包装为 `a2ui.client_event` 信封是独立的 `buildA2UIClientEventContent` 职责。后端 Runtime 侧 `server/runtime/a2ui/config.py` 只做薄转发：字典/env 解析留在 Control，避免 Front 配置查询导入 Runtime。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/src/features/a2ui/A2UIMessageContent.tsx:L60–L96](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/a2ui/A2UIMessageContent.tsx#L60-L96),
  - [jiuwenswarm/channels/web/frontend/src/features/a2ui/A2UIMessageContent.tsx:L157–L205](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/a2ui/A2UIMessageContent.tsx#L157-L205),
  - [jiuwenswarm/channels/web/frontend/src/features/a2ui/actionBridge.ts:L101–L123](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/a2ui/actionBridge.ts#L101-L123),
  - [jiuwenswarm/channels/web/frontend/src/features/a2ui/actionBridge.ts:L125–L199](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/a2ui/actionBridge.ts#L125-L199),
  - [jiuwenswarm/server/runtime/a2ui/config.py:L1–L31](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/a2ui/config.py#L1-L31)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/a2ui/knowledge-a2ui.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/a2ui/integration.py:L120-L140；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/A2UI-IM-channel-analysis.md:L100-L122
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/a2ui/actionBridge.ts:L36-L99
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/a2ui/a2uiContent.ts:L169-L211；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/A2UI.md:L72-L87
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/A2UI-web-only-pr-record.md:L19-L35；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/a2ui/A2UIMessageContent.tsx:L124-L155
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/a2ui/actionBridge.ts:L125-L199；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/a2ui/integration.py:L65-L87
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/a2ui/parser.py:L92-L118；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/A2UI.md:L37-L55
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/a2ui/integration.py:L36-L45；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/a2ui/featureConfig.ts:L34-L43
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/a2ui/integration.py:L146-L155；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/a2ui/rendererRegistry.tsx:L22-L59
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/a2ui/MultipleChoiceWithDefaults.tsx:L91-L110
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/a2ui/MultipleChoiceWithDefaults.tsx:L150-L169
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/a2ui/MultipleChoiceWithDefaults.tsx:L254-L287
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/a2ui/A2UIMessageContent.tsx:L60-L96
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/a2ui/A2UIMessageContent.tsx:L157-L205
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/a2ui/actionBridge.ts:L101-L123；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/a2ui/config.py:L1-L31
