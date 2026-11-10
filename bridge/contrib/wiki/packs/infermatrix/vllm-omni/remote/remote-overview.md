---
name: remote-overview
description: vLLM-Omni 远端验证入口：什么时候查（远端验证模型、PR、benchmark、profiling）、不放什么（真实服务器地址、账号、本机路径、跨仓库通用 SSH 与容器方法）、guides 与 incidents 两个子目录的指向
metadata:
  scope: 只收远端验证目录的入口说明与子目录对照表；远端调试路由归 remote-debug-strategy，远端运行时错题表归 remote-incidents-overview
---
# vLLM-Omni 远端验证

## 现状

### 什么时候查这里

- 在远端机器验证 vLLM-Omni 模型、PR、benchmark 或 profiling。

### 不放什么

- 真实服务器地址、账号和本机路径。
- 跨仓库通用的 SSH 和容器方法。

### 目录内容

| 遇到什么 | 查看哪里 |
|---|---|
| 查询仓库专有远端调试入口 | remote guides（源链接 `guides/_index.md`） |
| 调查远端运行时和验证错误 | [[remote-incidents-overview]]（remote incidents） |

## 关键事实

- 源页：`knowledge/repos/vllm-omni/remote/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, remote；created: 2026-07-10；updated: 2026-07-10
