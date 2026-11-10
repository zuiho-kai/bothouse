---
name: tui-client-overview
description: tui-client 模块入口：目录列表、代码快速入口表（命中 autofix-pr.ts、autofix-pr.watch.ts、index.ts）与指向 app-state 状态中枢页的链接
metadata:
  scope: 只收 tui-client 入口列表、快速入口表和一条指向状态中枢页的链接；状态中枢说明归 tui-client-knowledge，根级声明归 tui-client-contracts-01，功能知识归 feature-tui 与 feature-autofix
---
# tui-client

## 现状

- 理解该代码 owner 的职责、接口、配置与相关功能时查这里；通用审查方法不属于本目录。
- [[feature-tui]]（TUI 对话与命令 功能知识）
- [[feature-autofix]]（已有 PR 自动修复功能知识）
- [[tui-client-contracts-01]]（tui-client 源码接口与集成边界 01）
- [[core-overview]]（core）
- [[core-commands-overview]]（core-commands）
- [[core-keybindings-overview]]（core-keybindings）
- [[core-supervision-overview]]（core-supervision）
- [[core-utils-overview]]（core-utils）
- [[ui-overview]]（ui）
- [[ui-components-overview]]（ui-components）
- [[ui-rendering-overview]]（ui-rendering）
- [[feature-depth-tui]]（TUI 对话与命令：实现深读）
- [[feature-depth-autofix]]（已有 PR 自动修复：实现深读）

### 代码快速入口（Direct）

<!-- kb-init:quick-map -->

- 触发词：tui client。PR 描述或改动命中下表一行时，先读该行的规则，再读页面其余部分。

| PR 描述在做什么 | 精确规则 | 第一批 live 源码 |
|---|---|---|
| tui client | 入口 | `jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.ts`、`jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts`、`jiuwenswarm/channels/tui/frontend/src/index.ts` |

- [[tui-client-knowledge]]（tui-client：CliPiAppState 应用状态中枢（app-state.ts））

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/tui-client/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
