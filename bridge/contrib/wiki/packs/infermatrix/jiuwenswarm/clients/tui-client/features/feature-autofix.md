---
name: feature-autofix
description: TUI /autofix-pr 已有 PR 自动修复：autofix-pr.ts 与 autofix-pr.watch.ts 的命令参数（--watch、--interval、--stop）、PrWatchController、默认 10 分钟 12 轮、运行内授权与设计取舍
metadata:
  scope: 只收 /autofix-pr 的功能知识；实现深读归 feature-depth-autofix，TUI 整体功能归 feature-tui
---
# 已有 PR 自动修复的命令、轮询与权限边界

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/tui-client/feature-autofix.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.ts
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/自动修复PR.md
- 源页字段（feature）：autofix
- 入口（entry_points）：jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts
- 源页字段（source_globs）：jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr*.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.prompts.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.status.ts
  - jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts
- 本页连接 TUI 命令、PR 状态轮询和上游使用说明，固定基线 `f0a69728c96b`。

### 职责与边界

- `/autofix-pr` 是 TUI 本地命令：在当前 checkout 构造修复提示，再发送普通 Code 模式请求；PR watch 也由客户端轮询，不依赖后端调度器。非 Code 模式拒绝启动修复，`--stop` 可以在任何模式执行。命令要求本地 git 和平台读取能力；GitHub 使用已登录的 `gh`，GitCode 状态由 REST 读取。
- 源码与文档：[jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.ts:L1–L200](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.ts#L1-L200)；
  - [jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts:L1–L147](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts#L1-L147)；
  - [docs/zh/自动修复PR.md:L1–L235](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E8%87%AA%E5%8A%A8%E4%BF%AE%E5%A4%8DPR.md#L1-L235)。

### 接口与调用入口（API）

- `createAutofixPrCommand()` 返回斜杠命令定义，接受可选 PR 号或 URL、`--watch`、`--interval <分钟>` 和 `--stop`。`PrWatchController(deps, config)` 通过注入的 `sendMessage`、`isBusy`、`isConnected` 与状态检查器管理轮次，对宿主暴露 `start()`、`stop(reason, opts)`、`active` 和 `rounds`；这些是客户端接口，用户入口是命令而非 HTTP 路由。
- 源码与文档：[jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.ts:L1–L200](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.ts#L1-L200)；
  - [jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts:L1–L147](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts#L1-L147)；
  - [docs/zh/自动修复PR.md:L1–L235](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E8%87%AA%E5%8A%A8%E4%BF%AE%E5%A4%8DPR.md#L1-L235)。

### 配置入口与生效条件

- watch 默认每 10 分钟检查，`--interval` 支持小数且下限 10 秒；默认最多运行 12 轮。启动 watch 前要求工作树干净、能定位开放 PR。每次运行询问是否自动批准命令，取消或失败时仍逐条批准；授权在本轮结束、watch 停止或 Ctrl+C 后清除，不能当成永久权限设置。
- 源码与文档：[jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.ts:L1–L200](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.ts#L1-L200)；
  - [jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts:L1–L147](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts#L1-L147)；
  - [docs/zh/自动修复PR.md:L1–L235](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E8%87%AA%E5%8A%A8%E4%BF%AE%E5%A4%8DPR.md#L1-L235)。

### 设计取舍

- 轮询复用普通会话消息，让每轮修复可见；会话忙或离线时跳过检查，降低重叠执行风险，代价是停止状态取决于客户端存活和下一次可读检查。实现只在真实读到绿、合并或关闭状态时停止，不把未知当完成；12 轮保险丝限制空转。GitCode 个人仓库可能没有可读流水线，因此不能保证等到绿信号。
- 源码与文档：[jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.ts:L1–L200](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.ts#L1-L200)；
  - [jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts:L1–L147](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts#L1-L147)；
  - [docs/zh/自动修复PR.md:L1–L235](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E8%87%AA%E5%8A%A8%E4%BF%AE%E5%A4%8DPR.md#L1-L235)。

### 数据流与关联功能

- 单轮路径是本地命令构造提示 → Agent 读取检查与评审意见 → 修改并本地验证 → 提交、推回已有 PR 分支。watch 立即先发一轮，再等待空闲会话检查 PR 状态，仍红时发送下一轮。它与只读 `/review` 和 Auto Harness 的 issue 到新 PR 流程各有入口；运行内授权通过 TUI 会话宿主与工具权限交互。
- 源码与文档：[jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.ts:L1–L200](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.ts#L1-L200)；
  - [jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts:L1–L147](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts#L1-L147)；
  - [docs/zh/自动修复PR.md:L1–L235](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E8%87%AA%E5%8A%A8%E4%BF%AE%E5%A4%8DPR.md#L1-L235)。

### 怎样验证

- 验证命令拒绝非 Code 模式、脏工作树不能启动 watch、无法定位 PR 时不发送修复请求。使用可注入的状态检查器验证绿、合并、关闭会停止，未知不停止，满 12 轮熔断，忙碌或离线不增加轮次；再验证 `--stop` 和中断会清理运行内授权。真实集成还需检查提交留在原 PR 分支且本地验证证据可追溯；此页未声称已运行这些上游集成检查。
- 源码与文档：[jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.ts:L1–L200](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.ts#L1-L200)；
  - [jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts:L1–L147](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts#L1-L147)；
  - [docs/zh/自动修复PR.md:L1–L235](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E8%87%AA%E5%8A%A8%E4%BF%AE%E5%A4%8DPR.md#L1-L235)。
