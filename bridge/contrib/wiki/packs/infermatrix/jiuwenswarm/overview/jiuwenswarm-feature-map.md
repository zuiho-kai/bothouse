---
name: jiuwenswarm-feature-map
description: JiuwenSwarm 功能导航：功能、架构与 API 入口、配置、关联功能、设计取舍对照表，阅读证据的判断原则，以及逐项功能覆盖清单
metadata:
  scope: 只收功能入口总表、阅读证据原则和功能覆盖清单；仓库入口归 jiuwenswarm-overview，全仓协议概览归 jiuwenswarm-architecture，审查规则归 jiuwenswarm-rules
---
# JiuwenSwarm 功能、API、配置与设计取舍导航

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/feature-map.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 理解一项功能时，先沿下面的功能入口找职责、数据流与公共 API，再看实际配置、关联组件和设计取舍。源码事实采用现有知识页的固定基线 `f0a69728c96b`；设计取舍页把基于代码的推断明确标出，避免把分析写成作者历史决策。
- 本页只连接已有的唯一正文，不复制配置表或接口定义。审查必须执行的约束仍在各 owner 的规则页；知识用途也包括理解、配置、设计和排障。

| 功能或问题 | 架构与 API 入口 | 配置或数据契约 | 关联功能 | 设计取舍 |
|---|---|---|---|---|
| 启动、桌面与多实例 | [[jiuwenswarm]]（启动入口） | [[jiuwenswarm-instance-manager]]（实例配置与端口） | 共享配置、Runtime 生命周期 | [[launch-design-tradeoffs]]（实例隔离与导入时机） |
| 命令行、机器执行与会话操作 | [[jiuwenswarm-channels-process-cli]]（进程式 CLI） | [[jiuwenswarm-process-cli-machine]]（机器协议与租约） | Runtime、交互与取消 | [[gateway-channels-design-tradeoffs]]（本地调用与结果交付） |
| 模型选择、权限与 MCP | [[jiuwenswarm-common-1]]、[[jiuwenswarm-common-2]]（共享配置） | [[jiuwenswarm-common-model-catalog]]（模型目录与校验） | 登录模型、Runtime、Cron | [[common-core-design-tradeoffs]]（缓存与运行时视图） |
| 登录、凭据透传与续期 | [[jiuwenswarm-common-auth]]（登录鉴权） | [[jiuwenswarm-login-models]]（模型目录与凭据句柄） | 配置目录、请求身份、模型调用 | [[login-auth-design-tradeoffs]]（并发续期与跨进程同步） |
| 扩展与应用插件 | [[jiuwenswarm-extensions]]（注册与加载） | [[jiuwenswarm-application-plugins]]（应用绑定与前端贡献） | 频道方法、共享加解密 | [[extensions-plugins-design-tradeoffs]]（元数据加载与插件启用） |
| 轨迹采集、查看与保留 | [[jiuwenswarm-observability]]（轨迹管线） | [[jiuwenswarm-trajectory-retention]]（保留与查看器投影） | 执行事件、会话删除、前端查看 | [[observability-design-tradeoffs]]（有界队列与最终结果） |
| Agent 执行、会话协调与控制输入 | [[jiuwenswarm-runtime]]（公共 Runtime） | [[jiuwenswarm-runtime-session-1]]、[[jiuwenswarm-runtime-session-2]]（Session 协调器）、[[jiuwenswarm-runtime-control]]（交互与取消） | CLI、登录凭据、轨迹、调度 | [[agent-runtime-design-tradeoffs]]（租约与异步交付） |
| 定时任务与跨后端调度 | [[jiuwenswarm-runtime-cron]]（Cron 任务模型） | [[jiuwenswarm-cron-store]]（文件与 etcd 后端） | Runtime、模型绑定、输出频道 | [[cron-scheduling-design-tradeoffs]]（本地持久化与 HA） |
| 技能图谱、规划与经验演化 | [[jiuwenswarm-symphony]]（Symphony 集成） | [[jiuwenswarm-symphony-service]]（服务与候选安装）、[[jiuwenswarm-symphony-evolution]]（动态演化） | 技能、Runtime、配置、候选通知 | [[symphony-orchestration-design-tradeoffs]]（图谱复用与安装复核） |

### 阅读时怎样判断证据

- API、参数默认值、优先级和已实现行为沿正文中的固定源码引用核对；表里的名称不是完整 HTTP 或 WebSocket API 清单。
- 设计推断解释收益、代价与限制；没有明确文档或注释时，不推断作者曾考虑或放弃过某个方案。
- 验证入口说明既有测试在哪里、覆盖什么行为。静态知识不能单独证明测试已运行、真实 OAuth/模型端点可用或某个性能结论。
- owner 间的关系用于继续查证，不意味着一个组件继承另一个组件的规则或配置。
- 仓库入口见 [[jiuwenswarm-overview]]（JiuwenSwarm 知识索引），稳定代码边界见 组件索引（源链接 `components/_index.md`），全仓协议和服务概览见 [[jiuwenswarm-architecture]]（architecture）。

### 功能覆盖清单

- 以下清单把第一方客户端、SDK、沙箱与独立频道纳入功能范围。功能入口覆盖基础职责、接口、配置、关联能力、取舍和验证方法；不是完整字段手册或测试通过声明。对应机器清单由 adapter 的 knowledge-coverage.yaml 维护，功能清单综合固定基线的 README、文档导航、Harness 索引与客户端能力目录，并逐项核对源码入口；代码中尚未实现的流程在对应知识页标明。新增能力应先更新该清单，再重新审计。

| 功能 | 知识入口 |
|---|---|
| 初始化与服务启动 | [[feature-bootstrap]]（职责、接口与配置） |
| 单机多实例 | [[feature-instances]]（职责、接口与配置） |
| 桌面宿主与自动更新 | [[feature-desktop]]（职责、接口与配置） |
| 打包与部署 | [[feature-deployment]]（职责、接口与配置） |
| 机器执行与本地 CLI | [[feature-process-cli]]（职责、接口与配置） |
| 交互式命令行 | [[feature-cli]]（职责、接口与配置） |
| TUI 对话与命令 | [[feature-tui]]（职责、接口与配置） |
| Web 对话与流式状态 | [[feature-web-chat-1]]、[[feature-web-chat-2]]（职责、接口与配置） |
| Web 页面与功能入口 | [[feature-web-navigation]]（职责、接口与配置） |
| 项目、会话与历史管理 | [[feature-projects-sessions-1]]、[[feature-projects-sessions-2]]（职责、接口与配置） |
| Agent、Code 与 Team 模式 | [[feature-modes]]（职责、接口与配置） |
| 多智能体团队协作 | [[feature-team]]（职责、接口与配置） |
| 跨进程分布式 Team | [[feature-distributed-team]]（职责、接口与配置） |
| 人类团队成员与人工协作 | [[feature-human-team]]（职责、接口与配置） |
| SwarmFlow 工作流与 HITL | [[feature-swarmflow]]（职责、接口与配置） |
| Agent Loop 与 Rail 装配 | [[feature-harness]]（职责、接口与配置） |
| 任务规划与 Todo | [[feature-planning]]（职责、接口与配置） |
| 子代理派发与验证 | [[feature-subagents]]（职责、接口与配置） |
| 技能安装、挂载与发现 | [[feature-skills]]（职责、接口与配置） |
| 团队技能与能力复用 | [[feature-swarm-skills]]（职责、接口与配置） |
| Skill Hub 与市场流通 | [[feature-skill-hub]]（职责、接口与配置） |
| Skill 自演进 | [[feature-skill-evolution]]（职责、接口与配置） |
| Symphony 检索与图谱编排 | [[feature-symphony]]（职责、接口与配置） |
| Auto Harness 评测优化 | [[feature-auto-harness]]（职责、接口与配置） |
| Harness Package 与热激活 | [[feature-rsi-packages]]（职责、接口与配置） |
| FACT/TIP 双轨经验 | [[feature-ttse]]（职责、接口与配置） |
| 长期记忆 | [[feature-memory]]（职责、接口与配置） |
| 对话后自动记忆 | [[feature-auto-memory]]（职责、接口与配置） |
| Code 模式编码记忆 | [[feature-coding-memory]]（职责、接口与配置） |
| 任务经验检索与沉淀 | [[feature-task-memory]]（职责、接口与配置） |
| 上下文压缩与卸载 | [[feature-context]]（职责、接口与配置） |
| 工具权限与安全治理 | [[feature-permissions-1]]、[[feature-permissions-2]]（职责、接口与配置） |
| 生命周期 Hooks 与扩展 | [[feature-hooks]]（职责、接口与配置） |
| Application Plugin 与前端贡献 | [[feature-applications]]（职责、接口与配置） |
| 音视频双工扩展 | [[feature-video-duplex]]（职责、接口与配置） |
| E2A 统一请求响应协议 | [[feature-e2a]]（职责、接口与配置） |
| A2A 接入与 AgentCard | [[feature-a2a]]（职责、接口与配置） |
| ACP 与 stdio 桥接 | [[feature-acp]]（职责、接口与配置） |
| SSH 频道与远程终端 | [[feature-ssh]]（职责、接口与配置） |
| A2UI 生成式界面 | [[feature-a2ui]]（职责、接口与配置） |
| 浏览器服务与网页工具 | [[feature-browser-tools]]（职责、接口与配置） |
| Chromium 浏览器扩展 | [[feature-browser-client]]（职责、接口与配置） |
| VS Code 客户端 | [[feature-vscode]]（职责、接口与配置） |
| JetBrains 客户端 | [[feature-jetbrains]]（职责、接口与配置） |
| Python 与 TypeScript SDK | [[feature-sdk]]（职责、接口与配置） |
| JiuwenBox 隔离执行 | [[feature-sandbox]]（职责、接口与配置） |
| 模型平台与 API 配置 | [[feature-models]]（职责、接口与配置） |
| MCP 配置、凭据与资源 | [[feature-mcp]]（职责、接口与配置） |
| 账号登录与凭据续期 | [[feature-login]]（职责、接口与配置） |
| 定时任务与调度存储 | [[feature-cron]]（职责、接口与配置） |
| 执行轨迹与保留 | [[feature-observability]]（职责、接口与配置） |
| Debug Dump 与 OTel | [[feature-debug-trace]]（职责、接口与配置） |
| 多模态理解与媒体配置 | [[feature-multimodal]]（职责、接口与配置） |
| LSP 代码智能 | [[feature-lsp]]（职责、接口与配置） |
| Worktree 隔离工作 | [[feature-worktree]]（职责、接口与配置） |
| 已有 PR 自动修复 | [[feature-autofix]]（职责、接口与配置） |
| 飞书 频道 | [[feature-im-feishu]]（职责、接口与配置） |
| 微信 频道 | [[feature-im-wechat]]（职责、接口与配置） |
| 企业微信 频道 | [[feature-im-wecom]]（职责、接口与配置） |
| 钉钉 频道 | [[feature-im-dingtalk]]（职责、接口与配置） |
| 小艺 频道 | [[feature-im-xiaoyi]]（职责、接口与配置） |
| Slack 频道 | [[feature-im-slack]]（职责、接口与配置） |
| Telegram 频道 | [[feature-im-telegram]]（职责、接口与配置） |
| Discord 频道 | [[feature-im-discord]]（职责、接口与配置） |
| WhatsApp 频道 | [[feature-im-whatsapp]]（职责、接口与配置） |
| 智能体资产管理与工作区浏览 | [[feature-agent-management-1]]、[[feature-agent-management-2]]（职责、接口与配置） |
| JiuwenMemory 进程内 SDK 接入 | [[feature-jiuwen-memory-sdk]]（职责、接口与配置） |
| 图片生成与产物落盘 | [[feature-image-generation]]（职责、接口与配置） |
| JiuwenBox 推理隐私代理 | [[feature-sandbox-privacy-proxy]]（职责、接口与配置） |
| 群聊数字分身与 owner 权限 | [[feature-digital-avatar]]（职责、接口与配置） |
| 连接器市场与 MCP 授权流程 | [[feature-connectors]]（职责、接口与配置） |
| 外部 Claude 与 Codex CLI 智能体 | [[feature-external-cli-agents]]（职责、接口与配置） |
| 持续目标与会话控制 | [[feature-goal-mode]]（职责、接口与配置） |
| 计划模式与多入口切换限制 | [[feature-plan-mode]]（职责、接口与配置） |
| 绑定会话的心跳续跑任务 | [[feature-heartbeat]]（职责、接口与配置） |
| 会话产物列表、预览与下载 | [[feature-artifacts]]（职责、接口与配置） |
| 语音输入、回复朗读与停止 | [[feature-speech-interaction]]（职责、接口与配置） |
| SkillDev 创建、评测与打包边界 | [[feature-skill-development]]（职责、接口与配置） |
| 主动推荐、频率限制与主 Agent 交付 | [[feature-proactive-recommendation]]（职责、接口与配置） |
