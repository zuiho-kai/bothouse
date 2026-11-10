---
name: feature-a2ui
description: A2UI 生成式界面功能知识入口：职责与 Web-only 边界、finalizer.py 的 A2UIResponseFinalizer 等接口入口、a2ui.enabled 等四个配置键、设计取舍、关联功能与验收步骤
metadata:
  scope: 只收 A2UI 的功能概览与六个 facet 摘要；配置默认值与环境变量优先级、finalize 流程等实现细节归 feature-depth-a2ui，owner 级取舍与前端架构归 knowledge-a2ui
---
# A2UI 生成式界面 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/a2ui/feature-a2ui.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/a2ui/runtime/finalizer.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/A2UI.md
- 源页字段（feature）：a2ui
- 入口（entry_points）：jiuwenswarm/server/runtime/a2ui/runtime/finalizer.py
- 源页字段（source_globs）：jiuwenswarm/server/runtime/a2ui/runtime/finalizer.py；jiuwenswarm/server/runtime/a2ui/*；jiuwenswarm/channels/web/frontend/src/features/a2ui/actionBridge.ts；jiuwenswarm/server/runtime/a2ui/prompt_instructions.py；jiuwenswarm/server/runtime/a2ui/protocol.py
  - jiuwenswarm/server/control/a2ui_config.py；jiuwenswarm/channels/web/frontend/src/features/a2ui/a2uiContent.ts；jiuwenswarm/channels/web/frontend/src/features/a2ui/fieldBinding.ts；jiuwenswarm/channels/web/frontend/src/features/a2ui/formDefaults.ts
  - jiuwenswarm/channels/web/frontend/src/features/a2ui/A2UIErrorBoundary.tsx；jiuwenswarm/channels/web/frontend/src/features/a2ui/A2UIMessageContent.tsx；jiuwenswarm/channels/web/frontend/src/features/a2ui/CheckBoxWithDefaults.tsx
  - jiuwenswarm/channels/web/frontend/src/features/a2ui/DateTimeInputWithDefaults.tsx；jiuwenswarm/channels/web/frontend/src/features/a2ui/MultipleChoiceWithDefaults.tsx；jiuwenswarm/channels/web/frontend/src/features/a2ui/SliderWithDefaults.tsx
  - jiuwenswarm/channels/web/frontend/src/features/a2ui/TextFieldWithDefaults.tsx；jiuwenswarm/channels/web/frontend/src/features/a2ui/TextWithDefaults.tsx；jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ChatPanel.css
  - jiuwenswarm/agents/harness/common/rails/response_prompt_rail.py；jiuwenswarm/server/runtime/a2ui/protocols/__init__.py；jiuwenswarm/channels/web/frontend/src/features/a2ui/rendererRegistry.tsx；jiuwenswarm/server/runtime/a2ui/parser.py
  - jiuwenswarm/server/runtime/agent_adapter/interface.py；jiuwenswarm/server/runtime/a2ui/__init__.py；jiuwenswarm/server/runtime/a2ui/config.py；jiuwenswarm/server/runtime/a2ui/integration.py
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- 后端 A2UI 处理与 Web 渲染器共同承载动态界面和用户事件。协议有效、界面已渲染与客户端事件已交付是不同阶段，非 Web 频道不能直接继承此能力。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/server/runtime/a2ui/runtime/finalizer.py:L1–L169](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/a2ui/runtime/finalizer.py#L1-L169)；
  - [docs/zh/A2UI.md:L1–L93](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/A2UI.md#L1-L93)。

### 接口与调用入口（API）

- 可定位的实现声明包括 `A2UIFinalizationResult`；`has_a2ui_protocol_marker(content)`；`should_finalize_a2ui_content(content)`；`A2UIResponseFinalizer [finalize, finalize_result]`。这些是源码定位入口，具体公共用户操作沿功能文档查证；本页不把内部符号直接当成稳定 HTTP API。参数、返回类型、错误传播和生命周期应在所列实现与调用方一起核对。
- 源码与文档：[jiuwenswarm/server/runtime/a2ui/runtime/finalizer.py:L1–L169](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/a2ui/runtime/finalizer.py#L1-L169)；
  - [docs/zh/A2UI.md:L1–L93](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/A2UI.md#L1-L93)。

### 配置入口与生效条件

- 上游 YAML 示例的配置键包括 `a2ui.enabled`、`a2ui.protocol_version`、`a2ui.stream_validation_enabled`、`a2ui.non_web_fallback_enabled`。这些是示例字段，不单独证明源码默认值或全部优先级。 修改设置时还要检查配置加载位置与本功能的装配或连接时机，不能只由“保存成功”判断当前运行实例已经采用新值。
- 源码与文档：[jiuwenswarm/server/runtime/a2ui/runtime/finalizer.py:L1–L169](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/a2ui/runtime/finalizer.py#L1-L169)；
  - [docs/zh/A2UI.md:L1–L93](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/A2UI.md#L1-L93)。

### 设计取舍

- **设计推断**：标准化 UI 消息让 Web 渲染器提供表单和结构化确认，减少自由文本交互的歧义；代价是 Agent 响应终结、前端组件和客户端事件必须遵循同一协议。当前仅 Web 原生支持，非 Web 频道不能仅凭后端启用继承渲染能力。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/server/runtime/a2ui/runtime/finalizer.py:L1–L169](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/a2ui/runtime/finalizer.py#L1-L169)；
  - [docs/zh/A2UI.md:L1–L93](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/A2UI.md#L1-L93)。

### 数据流与关联功能

- 后端 A2UI 处理与 Web 渲染器共同承载动态界面和用户事件。协议有效、界面已渲染与客户端事件已交付是不同阶段，非 Web 频道不能直接继承此能力。 联调时结合[[feature-web-chat-1]]、[[feature-web-chat-2]]（Web 对话与流式状态）、[[feature-e2a]]（E2A 统一请求响应协议）、[[feature-applications]]（Application Plugin 与前端贡献）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/server/runtime/a2ui/runtime/finalizer.py:L1–L169](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/a2ui/runtime/finalizer.py#L1-L169)；
  - [docs/zh/A2UI.md:L1–L93](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/A2UI.md#L1-L93)。

### 怎样验证

- 生成最小 A2UI 表单或确认，核对后端消息有效、Web 渲染与交互事件回传。覆盖无效 UI 消息、重复事件、取消和禁用；通过其他频道确认响应退化方式而非假定具有相同组件。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/server/runtime/a2ui/runtime/finalizer.py:L1–L169](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/a2ui/runtime/finalizer.py#L1-L169)；
  - [docs/zh/A2UI.md:L1–L93](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/A2UI.md#L1-L93)。
