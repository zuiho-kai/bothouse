---
name: jiuwenswarm-overview
description: JiuwenSwarm 仓库知识入口：本仓库（openJiuwen-ai/jiuwenswarm，原 JiuwenClaw）的查阅场景、不收录范围与页面导航
metadata:
  scope: 只收仓库入口说明（什么时候查、不放什么、本仓库页面链接）；全仓协议与进程数据流归 jiuwenswarm-architecture，审查规则归 jiuwenswarm-rules，功能导航表归 jiuwenswarm-feature-map
---
# JiuwenSwarm 仓库经验入口

## 现状

- 本页是 `openJiuwen-ai/jiuwenswarm`（JiuwenSwarm，原名 JiuwenClaw，v0.2.0 起改为现名）的知识入口。它按功能与代码 owner 连接架构、API、配置、设计取舍、关联功能、验证方法和审查规则。解释性知识引用固定版本的源码与文档；完整接口定义和当前行为仍以仓库自己的文档与源码为事实来源。
- **什么时候查这里**
- 理解功能、API 配置、设计取舍或跨组件关系时，从下面的功能知识导航选择入口。
- 审查 jiuwenswarm 的 PR 时，用来判断改动属于哪一块：Gateway 与频道、E2A/A2A/ACP 协议、A2UI、AgentServer 运行时、Agent Team/Harness/Skills、Auto Harness、Web 前端、默认配置、测试与 CI、打包部署，或文档。
- 想知道某块代码该先读哪篇文档时查这里。中文文档在 `docs/zh/`，英文文档在 `docs/en/`，总导航是 `docs/README.md` 和 `docs/README_EN.md`。
- **不放什么**
- 不复述仓库文档。协议字段、命令用法、配置项、环境变量都以 `docs/` 和源码为准；文档和源码冲突时以源码为准（`docs/zh/A2A.md`、`docs/zh/E2A-protocol.md` 开头都这样声明）。
- 不放换到其他仓库也成立的通用审查方法，这些放在 `general/`。
- 不放产品使用教程和安装步骤。需要时直接读 `README_CN.md`、`docs/zh/安装指南.md`、`docs/zh/Quickstart.md`、`docs/zh/FAQ.md`。
- **本仓库页面**
- [[jiuwenswarm-feature-map]]（功能、API、配置与设计取舍导航） — 理解功能、配置与设计时查；连接九个组件的架构、契约、关联功能与验证入口。
- [[jiuwenswarm-architecture]]（JiuwenSwarm 仓库经验入口 — architecture）
- [[jiuwenswarm-rules]]（JiuwenSwarm 仓库审查规则）
- 每次审查 jiuwenswarm 的 PR 都先读这份通用审查规则；本仓库自己的约束在 rules 页。（源链接 `../../general/review/rules.md`）
- PR 新增或修改测试、或 CI 失败时读。先看 tests/ 下已有的用例（如 tests/unit_tests/a2ui/）和 pytest.ini 的约定；TESTING.md 里有过期路径，不能照抄。（源链接 `../../general/ci/guides/inspect-existing-tests-first.md`）
- jiuwenswarm components（源链接 `components/_index.md`）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: jiuwenswarm；created: 2026-09-30；updated: 2026-10-01
