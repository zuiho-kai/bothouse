# bothouse 软件架构

DSH 首次向导另走 /setup/dsh/status 与 /setup/dsh/install，复用 dsh/install.sh 安装 web profile；不写 bridge 的机器人/CLI/人设配置。安装后交接 dsh web 启动命令，后续配置归 DSH 页面。安装器及插件资源当前从源码目录定位。

bothouse 把聊天平台与本机智能体连接起来，在会话层增加团队协作、进展反馈与可选的共享记忆。平台入口、模型后端和记忆目录分别配置。

## 消息如何流动

```mermaid
flowchart LR
  P[Discord / 飞书 / 自建网页频道] --> A[platform 适配器]
  A --> E[Engine 与频道会话]
  E --> C[agent 适配器]
  C --> L[本机 CLI 或 ACP 智能体]
  L --> C
  C --> E
  E --> A
  A --> P
  E <--> G[可选 gate]
  G <--> W[共享 wiki]
```

接入 DSH 智能体的 ACP 协议与接入 DSH 网页聊天入口是两个方向；后者通过 DSH 原生插件安装，向导负责首次安装与交接启动命令。

DSH 忙时插话（steer）要给 dsh-acp 打 integrations/dsh-acp-steer 的补丁，对端握手声明 `dsh/steer` 后适配器才走插话，否则排队。

子 Agent 状态仍由适配器采集，经可选 core.SubTaskReporter 交给现有表格渲染。Codex 原生协作事件直接映射；DSH 由 ACP 自有通知通道转发生命周期元数据，父会话 ID 与运行 ID 共同隔离事件。core 不解析各后端协议，普通工具完成不代表子任务完成。见[集成说明](../integrations/dsh-acp-subtasks/README.md)。

## 模块与数据归属

| 模块 | 职责 |
| --- | --- |
| `bridge/core/` | Engine、频道会话、队列、管理 API、向导、技能及上下文注入 |
| `bridge/agent/` | 各 CLI / ACP 后端的启动、事件、权限与会话恢复 |
| `bridge/platform/` | 各聊天平台的身份、收发消息与卡片 |
| `bridge/contrib/gate/` | 可选的消息判定与 wiki 检索服务 |
| `role-household/rh/hub.py` | 随程序分发的自建网页频道，通过 cloud_web WebSocket 接入角色 |
| `companion/` | 保留的电脑语音、活动采集与归档扩展，独立配置 |
| `integrations/`、`skills/` | 智能体集成与工作约定 |

core 通过接口使用后端能力；agent 与 platform 适配器不互相导入。模型会话归各后端所有，共享 wiki 保存有来源的记录，凭据与运行数据留在仓库之外。

## 团队与记忆

- 平台把作者、点名和是否来自机器人带进 Engine。未触发回复的队友消息可作为上下文，作者身份保留。
- 主角色与队员的路由通过 gate 与 fallback 配置决定。`team_lead_bot` 把被主角色派发任务的最终回复交回主角色；这不自动迁移另一个角色已经运行的任务。
- 自建平台多角色向导给每位成员写稳定的 `mention_id`，给队员写交回对象，并在人设的标记行说明自建平台上的队伍。手写且没有向导标记的人设保留。
- 共享记忆需要另行安装和配置 wiki / gate。检索出的主题页按需提供给角色；原会话的恢复仍由后端负责，两者不能互相替代。
- 工具审批、公开进展和任务卡按项目启用；一次任务有结果与真人已验收是不同状态。

协议与使用方法见 [自建平台协议](../bridge/docs/cloud-web.md)、[wiki 配置](ccm-and-wiki.md)、[公开进展](PUBLIC_PROGRESS.md)、[工具代批](DELEGATED_PERMISSIONS.md)。

## 构建与发布

`make hubsrc` 把自建平台源码复制到 Go 嵌入目录，前端构建后随 cc-connect 二进制分发。安装脚本只下载当前仓库 Release 里的预编译包。发布从审核合入 main 的提交构建，流程见 [CONTRIBUTING.md](../CONTRIBUTING.md)。

## Collaboration helper packaging

`bridge/embed_lead.go` owns the embedded lead scripts and selected gate dependencies.
`core.InstallLeadTools` extracts their sibling layout under the configured data directory
and adds role instructions; `setup lead install` is the explicit CLI entry.
The DSH adapter maps runtime session identity to `CC_SESSION` before subprocess
credential filtering. Gate services and platform credentials are configured separately.

## Usage ledger

The bridge entry point creates one `core.UsageLedger` per configured data directory and shares it with all engines and the management API. Agent adapters emit authoritative per-turn token categories on terminal events; core does not infer billing from context-window snapshots. Daily files contain individual records plus date/hour/role/model buckets. Read-only management endpoints provide dashboard aggregations with optional configured pricing. Unknown usage remains explicit. See [usage API](api/usage.md).

## DSH 语音公开答复

[公开答复插件](../integrations/dsh-public-output/README.md) 区分模型历史与展示：模型历史保留统一 JSON，配套 ACP 只输出解码正文。语音的实时正文经私密 relay 切句，由 companion 顺序合成并提供设备音频块，终态不重复。协议、失败行为及远程识别兼容见 [按句语音](VOICE_SENTENCE_STREAM.md)。
