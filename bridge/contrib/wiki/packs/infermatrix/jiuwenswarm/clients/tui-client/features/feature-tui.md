---
name: feature-tui
description: TUI 对话与命令功能知识：终端 UI 的职责边界、parseCliArgs 与 closeUi 入口、--session/--url/--token/--budget/--project 选项、本地与后端 slash 指令分层及验证步骤
metadata:
  scope: 只收 TUI 对话与命令的功能知识；实现深读归 feature-depth-tui，autofix 功能知识归 feature-autofix
---
# TUI 对话与命令 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/tui-client/feature-tui.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/index.ts；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/TUI使用指南.md
- 源页字段（feature）：tui
- 入口（entry_points）：jiuwenswarm/channels/tui/frontend/src/index.ts
- 源页字段（source_globs）：jiuwenswarm/channels/tui/frontend/src/index.ts；jiuwenswarm/channels/tui/*；jiuwenswarm/gateway/routing/agent_request_timeout.py；jiuwenswarm/server/runtime/gateway_adapter/harmonyos_adapter.py；jiuwenswarm/channels/tui/frontend/src/ui/app-screen.ts
  - jiuwenswarm/server/runtime/gateway_adapter/memory_adapter.py；jiuwenswarm/agents/harness/common/memory_rpc.py；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/memory.ts；jiuwenswarm/channels/tui/frontend/src/ui/memory-view.ts
  - jiuwenswarm/server/runtime/agent_adapter/statusline_setup_agent.py；jiuwenswarm/gateway/channel_manager/tui/tui_connect.py；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/chrome.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/collapse.ts
  - jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/color.ts；jiuwenswarm/channels/tui/frontend/src/core/attachments.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/auto-harness-issue-fix.ts；jiuwenswarm/channels/tui/frontend/src/app-state.ts
  - jiuwenswarm/channels/tui/frontend/src/ui/components/messages/content-components.ts；jiuwenswarm/channels/tui/frontend/src/ui/components/checkbox-list.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/auto-harness.ts
  - jiuwenswarm/channels/tui/frontend/src/core/modes.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/clipboard.ts；jiuwenswarm/server/runtime/session/project_store.py；jiuwenswarm/channels/tui/frontend/src/core/commands/helpers.ts
  - jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/config.ts；jiuwenswarm/common/config_panel/tui_models_handlers.py；jiuwenswarm/channels/tui/frontend/src/core/tui-config-store.ts；jiuwenswarm/channels/tui/frontend/src/core/compression-formatters.ts
  - jiuwenswarm/channels/tui/frontend/src/core/event-handlers.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/context.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/copy.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/debug.ts
  - jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/diff.ts；jiuwenswarm/channels/tui/frontend/src/ui/components/messages/diff-component.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/evolve.ts
  - jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/export.ts；jiuwenswarm/channels/tui/frontend/src/core/utils/editor.ts；jiuwenswarm/channels/tui/frontend/src/core/final-content.ts；jiuwenswarm/channels/tui/frontend/src/core/history-parser.ts
  - jiuwenswarm/channels/tui/frontend/src/ui/components/messages/history-entry.ts；jiuwenswarm/channels/tui/frontend/src/ui/components/messages/presentation-rules.ts；jiuwenswarm/channels/tui/frontend/src/ui/components/messages/render-compact-entry.ts
  - jiuwenswarm/channels/tui/frontend/src/ui/components/messages/render-detailed-entry.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/hooks.ts；jiuwenswarm/channels/tui/frontend/src/ui/components/messages/meta-components.ts
  - jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/init.prompts.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/init.ts；jiuwenswarm/channels/tui/frontend/src/ui/keymap.ts；jiuwenswarm/channels/tui/frontend/src/core/keybindings/actions.ts
  - jiuwenswarm/channels/tui/frontend/src/core/keybindings/defaultBindings.ts；jiuwenswarm/channels/tui/frontend/src/core/keybindings/reserved.ts；jiuwenswarm/channels/tui/frontend/src/core/keybindings/resolver.ts；jiuwenswarm/channels/tui/frontend/src/core/keybindings/store.ts
  - jiuwenswarm/channels/tui/frontend/src/core/keybindings/template.ts；jiuwenswarm/channels/tui/frontend/src/core/keybindings/types.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/keybindings.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/mcp.ts
  - jiuwenswarm/channels/tui/frontend/src/ui/components/messages/shared.ts；jiuwenswarm/gateway/channel_manager/tui/tui_channel.py；jiuwenswarm/channels/tui/frontend/src/core/pasted-text.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/persist.ts
  - jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/plan.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/plugin.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/recap.ts
  - jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/reload-plugins.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/review.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/sandbox.ts
  - jiuwenswarm/channels/tui/frontend/src/ui/screen-layout.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/security-review.ts；jiuwenswarm/channels/tui/frontend/src/core/session-state.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/branch.ts
  - jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/cancel.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/clear.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/compact.ts
  - jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/session.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/simplify.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/skills.ts
  - jiuwenswarm/channels/tui/frontend/src/core/commands/types.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/CommandService.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/_placeholder.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/registry.ts
  - jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/status.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/statusline.ts；jiuwenswarm/channels/tui/frontend/src/core/statusline-runner.ts
  - jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/swarmflow.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/theme.ts；jiuwenswarm/channels/tui/frontend/src/ui/theme.ts
  - jiuwenswarm/channels/tui/frontend/src/ui/components/tools/search-tool-renderers.ts；jiuwenswarm/channels/tui/frontend/src/ui/components/tools/tool-group-message.ts；jiuwenswarm/channels/tui/frontend/src/ui/components/tools/tool-kind-utils.ts
  - jiuwenswarm/channels/tui/frontend/src/ui/components/tools/tool-line-renderers.ts；jiuwenswarm/channels/tui/frontend/src/ui/components/tools/tool-render-shared.ts；jiuwenswarm/channels/tui/frontend/src/core/app-state-helpers.ts
  - jiuwenswarm/channels/tui/frontend/src/ui/components/tools/collapsed-tool-group-message.ts；jiuwenswarm/channels/tui/frontend/src/ui/components/tools/compact-tool-renderers.ts；jiuwenswarm/channels/tui/frontend/src/ui/components/tools/command-tool-renderers.ts
  - jiuwenswarm/channels/tui/frontend/src/ui/components/tools/detailed-tool-renderers.ts；jiuwenswarm/channels/tui/frontend/src/ui/components/tools/file-tool-renderers.ts；jiuwenswarm/channels/tui/frontend/src/ui/components/tools/tool-structured-data.ts
  - jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/expand.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/fold.ts；jiuwenswarm/channels/tui/frontend/src/ui/transcript-entry-selection.ts；jiuwenswarm/channels/tui/frontend/src/ui/transcript-renderer.ts
  - jiuwenswarm/channels/tui/frontend/src/core/transcript-timeline.ts；jiuwenswarm/channels/tui/frontend/src/core/tui-trusted-dirs-store.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/usage.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/view.ts
  - jiuwenswarm/channels/tui/frontend/src/ui/welcome.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/workspace-dir.ts；jiuwenswarm/channels/tui/frontend/src/core/ws-client.ts
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- 终端 UI 展示会话、命令、运行事件和人工交互。TUI 局部指令与发给后端的 slash 指令在不同位置解析，因此连接成功并不证明每条命令由同一组件实现。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/channels/tui/frontend/src/index.ts:L1–L276](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/index.ts#L1-L276)；
  - [docs/zh/TUI使用指南.md:L1–L780](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/TUI%E4%BD%BF%E7%94%A8%E6%8C%87%E5%8D%97.md#L1-L780)。

### 接口与调用入口（API）

- 可定位的实现声明包括 `parseCliArgs`；`isRemoteUrl`；`buildUiLifecycle`；`notifyDisconnectBeforeExit`；`closeUi`。这些是源码定位入口，具体公共用户操作沿功能文档查证；本页不把内部符号直接当成稳定 HTTP API。参数、返回类型、错误传播和生命周期应在所列实现与调用方一起核对。
- 源码与文档：[jiuwenswarm/channels/tui/frontend/src/index.ts:L1–L276](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/index.ts#L1-L276)；
  - [docs/zh/TUI使用指南.md:L1–L780](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/TUI%E4%BD%BF%E7%94%A8%E6%8C%87%E5%8D%97.md#L1-L780)。

### 配置入口与生效条件

- 文档中的调用选项包括 `--session`、`--url`、`--token`、`--help`、`--budget`、`--project`，适用命令与前置条件沿文档确认。 修改设置时还要检查配置加载位置与本功能的装配或连接时机，不能只由“保存成功”判断当前运行实例已经采用新值。
- 源码与文档：[jiuwenswarm/channels/tui/frontend/src/index.ts:L1–L276](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/index.ts#L1-L276)；
  - [docs/zh/TUI使用指南.md:L1–L780](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/TUI%E4%BD%BF%E7%94%A8%E6%8C%87%E5%8D%97.md#L1-L780)。

### 设计取舍

- **设计推断**：TUI 将本地 UI 指令与后端控制指令分层解析，便于处理终端专有交互；代价是命令排障需要先判断解析位置。同 Gateway 可以承载多个窗口，但同 session 同时占用受到限制；增加窗口不等于创建独立后端实例。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/channels/tui/frontend/src/index.ts:L1–L276](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/index.ts#L1-L276)；
  - [docs/zh/TUI使用指南.md:L1–L780](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/TUI%E4%BD%BF%E7%94%A8%E6%8C%87%E5%8D%97.md#L1-L780)。

### 数据流与关联功能

- 终端 UI 展示会话、命令、运行事件和人工交互。TUI 局部指令与发给后端的 slash 指令在不同位置解析，因此连接成功并不证明每条命令由同一组件实现。 联调时结合[[feature-cli]]（交互式命令行）、[[feature-instances]]（单机多实例）、[[feature-autofix]]（已有 PR 自动修复）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/channels/tui/frontend/src/index.ts:L1–L276](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/index.ts#L1-L276)；
  - [docs/zh/TUI使用指南.md:L1–L780](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/TUI%E4%BD%BF%E7%94%A8%E6%8C%87%E5%8D%97.md#L1-L780)。

### 怎样验证

- 在交互式 TTY 验证连接、消息流和审批，再检查非 TTY 的启动行为。开启两个窗口核对独立会话，尝试占用同一 session 验证冲突；分别测试本地 slash 指令与发往 Gateway 的命令。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/channels/tui/frontend/src/index.ts:L1–L276](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/index.ts#L1-L276)；
  - [docs/zh/TUI使用指南.md:L1–L780](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/TUI%E4%BD%BF%E7%94%A8%E6%8C%87%E5%8D%97.md#L1-L780)。
