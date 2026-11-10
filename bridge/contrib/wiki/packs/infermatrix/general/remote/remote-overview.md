---
name: remote-overview
description: 远端任务 目录总览：什么时候查这里、不放什么，以及目录内容的入口说明
metadata:
  scope: 只收源目录 general/remote 索引页里的使用时机、收录边界和入口说明；具体方法归入口所指的各页
---
# 远端任务

## 现状

- 什么时候查这里：
  - 使用 SSH、容器、tmux、超时、清理或远端长跑任务。
- 不放什么：
  - 真实服务器地址、账号、私钥和某台机器的 cache 路径。
  - 某个仓库专有的测试命令。

## 关键事实

- 源页：`knowledge/general/remote/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: general, remote；created: 2026-07-10；updated: 2026-07-10；sources: 无

### 目录内容

- 遇到什么：SSH、容器、Slurm、长跑和清理
  - 查看哪里：远端指南（源链接 `guides/_index.md`，本 pack 中为 `remote/guides/README.md`）
  - 说明：通用远端工作方法
- 遇到什么：调查通用 SSH、Slurm、venv 和清理错误
  - 查看哪里：[[remote-incidents-overview]]（远端错题）
  - 说明：已验证的具体失败
- 遇到什么：记录本机服务器信息
  - 查看哪里：目录归属中的 local 规则（源链接 `../../../doc/knowledge/contributing/layout.md#local`，不在本 pack 内）
  - 说明：实例文件仍由 Git 忽略
