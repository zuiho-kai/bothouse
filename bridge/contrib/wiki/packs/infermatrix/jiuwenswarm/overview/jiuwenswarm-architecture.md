---
name: jiuwenswarm-architecture
description: JiuwenSwarm 全仓架构地图：入口到 Gateway、E2A、AgentServer、Harness 的数据流，各代码区域与对应 docs 文档对照表，已知过期文档与代码快速入口
metadata:
  scope: 只收全仓进程与数据流、区域-代码-文档对照和文档过期提示；审查规则归 jiuwenswarm-rules，功能导航归 jiuwenswarm-feature-map，仓库入口说明归 jiuwenswarm-overview
---
# JiuwenSwarm 仓库经验入口 — architecture

## 现状

- **怎么用这页**
- 本页是一张地图，只列出每块代码在哪里、改它之前该先读哪篇仓库文档。如果审查时发现文档与源码不一致，应要求在同一个 PR 里把文档改对。总导航见 `docs/README.md`（中文）和 `docs/README_EN.md`（英文）。
- **进程与数据流**
- 入口（Web / TUI / 飞书 / 微信 / 小艺 / ACP / A2A）→ Gateway：ChannelManager 注册频道 → MessageHandler → E2A（请求 E2AEnvelope / 响应 E2AResponse）→ AgentServer 运行时（agent_adapter、a2ui）→ Agent harness（prompts / tools / rails / skills）与 Team / SwarmFlow
- Gateway 的入口是 `jiuwenswarm/gateway/app_gateway.py`，启动命令为 `python -m jiuwenswarm.gateway.app_gateway`。它会读取 `~/.jiuwenswarm/config/.env` 并注册各个频道。主进程的启动命令是 `python -m jiuwenswarm.app`。
- Gateway 和 AgentServer 之间只通过 `jiuwenswarm/common/e2a/` 里定义的信封通信。外部协议（A2A、ACP）先在 Gateway 边界转换成 E2A。
- TUI 是单独发布的 pip 包 `jiuwenswarm-tui`。已提供的文档没有介绍 `jiuwenbox/`、`packages/`、`sdks/` 这三个目录，审查它们时先看目录里的 README 和代码。
- **各区域的代码与文档**
- （以下为原表格，按行改写为条目）
- Gateway 与频道
  - `jiuwenswarm/gateway/`（`channel_manager/`、`message_handler/`、`app_gateway.py`）
  - `docs/zh/A2A.md` §0–§2（模块表，以及 Web、ACP、A2A 三种频道的对照）
  - 改频道注册、消息派发、端口和环境变量绑定时
- E2A 内部协议
  - `jiuwenswarm/common/e2a/`（`models.py`、`adapters.py`、`constants.py`）
  - `docs/zh/E2A-protocol.md`，英文版 `docs/en/E2A-protocol.md`
  - 改信封或响应字段、`method` 的两种含义、`response_kind`/`status`、ACP/A2A 投影时
- A2A 入站
  - `jiuwenswarm/gateway/channel_manager/protocol/a2a/`
  - `docs/zh/A2A.md` §3–§9
  - 改 AgentCard、A2A parts 与 `Message` 的互转、reasoning 输出、`A2A_SERVER_*` 变量、可选依赖 `jiuwenswarm[a2a]` 时
- ACP 接入
  - `scripts/run_gateway_acp.sh`、`scripts/run_gateway_acp.cmd`、`jiuwenswarm-acp` 命令
  - `docs/zh/ACP插件使用.md`
  - 改 ACP 启动脚本、命令入口或 VS Code 接入步骤时
- A2UI（只支持 Web）
  - 后端 `jiuwenswarm/server/runtime/a2ui/`；前端 `jiuwenswarm/channels/web/frontend/src/features/a2ui/`
  - `docs/zh/A2UI.md`（模块关系表、边界原则）、`docs/zh/A2UI-IM-channel-analysis.md`、`docs/zh/A2UI-web-only-pr-record.md`
  - 任何 A2UI 改动，尤其是想让非 Web 频道也支持 A2UI 的 PR
- AgentServer 运行时
  - `jiuwenswarm/server/`（如 `runtime/agent_adapter`）
  - `docs/zh/A2UI.md` 模块表中 agent_adapter 那一行、`docs/zh/模式系统.md`
  - 改输入输出适配、`mode` / `work_mode` 的处理时
- Agent harness、Team、Skills、记忆
  - `jiuwenswarm/agents/`（如 `agents/harness/common/rails`）
  - `docs/zh/AgentTeam.md`（§2.4 技能可见性、§2.5 团队记忆、§2.6 SwarmFlow 启停、Q6 本地与分布式模式下的会话规则）、`docs/zh/AgentTeam人类成员联机协作.md`、`docs/zh/SwarmSkills.md`、`docs/zh/记忆.md`
  - 改 Leader/Teammate 协作、`skills-visibility.json`、团队记忆、SwarmFlow 生命周期，或人类成员的 `/join`、`$成员名` 语法时
- Auto Harness
  - 已提供的文档没有给出代码目录，按 PR 的实际路径定位
  - `docs/zh/AutoHarness.md`
  - 改 `/auto-harness` 命令、Meta/Expert pipeline、Harness Package 热加载、GitCode issue 自动处理时
- Web 前端
  - `jiuwenswarm/channels/web/frontend/`
  - `docs/zh/A2UI.md`（其中对 `useWebSocket.ts` 的约束）、`docs/zh/Quickstart.md`
  - 改前端组件、WebSocket hook、构建脚本时
- 默认配置与资源
  - `jiuwenswarm/resources/`（`config.yaml`、`.env.template`）
  - `docs/zh/配置信息.md`、`docs/zh/A2UI.md` 的配置一节、`docs/zh/FAQ.md` 的模型配置部分
  - 改默认配置、环境变量名、`jiuwenswarm-init` 初始化流程时
- 测试与 CI
  - `tests/`、`pytest.ini`、`run_tests.sh`、`.gitcode/workflows/`
  - `TESTING.md`、`tests/README.md`
  - 新增或修改测试、CI 失败时
- 打包与部署
  - `pyproject.toml`、`uv.lock`、`MANIFEST.in`、`Makefile`、`Dockerfile.claw`、`docker/`、`deploy/`
  - `docs/zh/安装指南.md`、`docs/zh/FAQ.md`
  - 改依赖、可选依赖（如 `a2a`）、镜像或发布流程时
- **文档里已知的过期内容**
- `TESTING.md` 写于 JiuwenClaw 时期，和现状有出入：它同时写了 `tests/unit/` 和 `tests/unit_tests/` 两种路径；CI 部分写的是 `.github/workflows/`，而仓库实际用的是 `.gitcode/`。遇到分歧时，以 `pytest.ini`、`.gitcode/workflows/` 和 `tests/` 的实际结构为准。
- 由于改过名，仓库里可能还留着 `claw` 字样，例如 `Dockerfile.claw` 和旧的 `JIUWENCLAW_*` 环境变量。`docs/zh/A2UI.md` 已声明 A2UI 不再支持旧前缀，只认 `JIUWENSWARM_A2UI_*`。
- `docs/zh/A2A.md` §7 说明：出站 A2A（Agent 通过 MCP Hub 调外部）目前不在仓库里。遇到相关 PR 时，以实际接线的代码为准。
- `docs/zh/FAQ.md` 要求和 `docs/en/FAQ.md` 同步更新。改动只涉及其中一种语言的文档时，要检查另一种语言的版本有没有一起更新。

### 代码快速入口（Direct）

<!-- kb-init:quick-map -->

- 触发词：gateway、网关、channel、频道、channel_manager、message_handler、feishu、飞书、wechat、微信、xiaoyi、小艺。PR 描述或改动命中下表一行时，先读该行的规则，再读页面其余部分。

| PR 描述在做什么 | 精确规则 | 第一批 live 源码 |
|---|---|---|
| gateway、网关、channel、频道、channel_manager、message_handler、feishu、飞书、wechat、微信、xiaoy… | 入口 | `docs/README.md`、`docs/README_EN.md`、`jiuwenswarm/gateway/app_gateway.py` |

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/architecture.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-09-30；updated: 2026-09-30
