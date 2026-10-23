# DSH Discord：在 DeepSeek Harness 里做「Discord + 多种 AI + 外接设备」

Issue [#229](https://github.com/Zssan12/conest/issues/229)。基于 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（MIT），钉在 `687f282e86`（0.2.1-rc.2，2026-10-17），见 [upstream.pin.json](upstream.pin.json)。本仓库的 cc-connect 桥接（`bridge/`）、语音陪伴（`companion/`）和设备协议（`role-household/`）是复用来源。

## 目录与用法

这里不放 DSH 源码，只放 CoNest 自己的部分（做法同 FlyBot 对 DS Bot 的处理）：

| 路径 | 内容 |
| --- | --- |
| `upstream.pin.json` | 上游 DSH 仓库与固定提交 |
| `packages/` | 自有 DSH 包，同步时放到 DSH 的 `packages/experimental/` 下 |
| `patches/` | 对上游文件的最小改动（目前只登记 TypeScript 工程引用） |
| `scripts/sync.sh` | 检出固定提交、放入自有包、打补丁 |
| `collab/` | 阶段 1 频道服务插件，直接按绝对路径加载，不参与同步 |

首次准备使用一个尚不存在的新目录：

~~~sh
# 在 CoNest 根目录执行，把路径换成新的绝对路径
CONEST_SOURCE="$PWD"
DSH_CHECKOUT=/absolute/path/to/new-dsh-checkout
DSH_PIN=$(node -p "require('./dsh/upstream.pin.json').commit")
git clone --filter=blob:none https://github.com/deepseek-ai/deepseek-harness.git "$DSH_CHECKOUT"
git -C "$DSH_CHECKOUT" checkout "$DSH_PIN"
cp -R "$CONEST_SOURCE/dsh/packages/client-ui-discord" "$DSH_CHECKOUT/packages/experimental/client-ui-discord"
git -C "$DSH_CHECKOUT" apply "$CONEST_SOURCE/dsh/patches/0001-register-overlay-packages.patch"
cd "$DSH_CHECKOUT"
corepack pnpm install
corepack pnpm run build:artifacts
~~~

原 `scripts/sync.sh` 会强制重置并清理目标目录，本轮未使用；不要用它更新已有工作目录。修改保存在 CoNest 的 `dsh/` 下，再逐文件复制到独立 DSH checkout 验证。升级上游时更新 `upstream.pin.json` 并核对 `patches/`。

**当前状态（2026-10-21）**：频道服务、DSH 原生成员和 cloud_web 网关已实现，真实 cc-connect + Claude Code 已在隔离环境回复。原生 `client-ui-discord` 已提供侧栏「频道」、频道切换、消息流、成员/工作状态、中英文本和主题适配；用户已确认页面正常。本轮补齐断线恢复、快速切换与发送草稿回归。真实 DeepSeek 回复尚待验证，阶段 2 的创建频道、@ 菜单等仍未完成，未部署。安装、验证和边界见 [collab/README.md](collab/README.md)。

## 目标

1. **频道**：网页里是 Discord 的样子——服务器栏、频道、消息流、成员列表。真人和 AI 都是频道成员，@谁谁干活。
2. **多种 AI**：成员背后可以是任意模型（DeepSeek、Claude、GPT、Gemini、本地模型），也可以是现成的 Agent（Claude Code、Codex、Cursor、Gemini CLI、OpenCode……）。
3. **接出去**：同一个成员可以出现在外部入口——真 Discord / 飞书、语音、实体设备（ESP32 圆屏、小智），说话陪伴。

前端交互参考 FlyBot（发言归属、@ 菜单、审批卡、任务状态），代码自己写。

## 核心判断：LLM 直接接 vs. 外部 Agent 接入 —— 两种都要，分两层

| | A. 模型接入（DSH 原生成员） | B. Agent 接入（外部成员） |
| --- | --- | --- |
| 是什么 | DSH 自己的 Agent 循环 + 任意模型 | 别人的 Agent 运行时，我们只收发消息 |
| 怎么接 | `llm-pi-ai`：Anthropic / OpenAI / Gemini / OpenAI 兼容网关 / 本地模型，改设置即生效 | 复用 conest 的 cc-connect：已有 16 个适配器（claudecode、codex、cursor、gemini、opencode、kimi、qoder、acp……），有会话续接、流式、权限审批、额度、压缩 |
| 得到什么 | DSH 全部能力：会话持久化、工具、审批卡、Agent Teams、任务板、投影、子 Agent | 「真正的 Claude Code」行为、用户自己的订阅/登录态、成熟的 Discord 实战修复 |
| 代价 | 不是 Claude Code 本体，只是 DSH 用了 Claude 模型 | 工具过程对 DSH 不透明，只拿公开回复和进度 |
| 适合 | 默认成员、团队协作、要审批和任务板的工作 | 用户已有的 CLI 订阅、想要原汁原味的某个 Agent |

**为什么不用 DSH 自带的 `subagent-claude-code` / `subagent-codex` / `subagent-acp` 做频道成员：** 这三个的当前封装都是「一次任务、一个新进程、只回最终答案」，没有续接、没有流式、权限一律自动拒绝/允许、不能问人。适合当 DSH 成员的工具（让 DSH 成员临时派活给 Claude Code），不适合当长期在线的频道成员。

**为什么不在 TS 里重写 16 个适配器：** conest 已经有 `platform/cloud-web`——cc-connect 以 WebSocket 客户端身份连一个「频道服务」（`/cloud-web/ws`，协议版本 1，能力含 text/image/file/audio/card/buttons/typing/update_message/preview/subtask_table）。role-household 的 hub 就是这样被接入的。**DSH Discord 的频道服务实现同一协议（含 hub 的历史接口等隐藏约定，见下方审查修正），cc-connect 基本不改就能把它所有 Agent 带进来。** 这就是「cv 比 dev 快」。

## 架构

```
                 ┌──────────────── DSH Discord（DSH 进程内的插件） ────────────────┐
  浏览器 ──────▶ │  Discord 外壳 UI（client-ui-discord）                           │
                 │        │                                                     │
                 │  collab 频道服务（Host 插件）                                 │
                 │   服务器 / 频道 / 成员 / 消息 / @ 路由 / 投递游标 / 去重         │
                 │   ├── DSH 原生成员：每个 (频道, 成员) 绑定一条 DSH Session      │
                 │   │      模型任意（llm-pi-ai），可用 Agent Teams、审批、工具    │
                 │   ├── 外部成员网关：实现 conest cloud-web 协议（WS）            │
                 │   └── 设备网关：start / audio / stop / receipt 四事件           │
                 └───────────┬──────────────────────────────┬─────────────────────┘
                             │                              │
              conest cc-connect（Go）              conest companion/voice（Python）
              claudecode / codex / cursor /        ASR → 成员发言 → TTS
              gemini / opencode / acp ...          Qwen3-TTS / 豆包；ESP32 圆屏、小智固件
              + 真 Discord / 飞书 平台适配器
```

要点：

- **频道消息是 collab 自己的事实**，不是某条 Session 的记录。DSH 成员的 Session 只是它的「脑子」：被 @ 时把频道上下文（谁说了什么）作为输入投递进去，回复再写回频道。外部成员同理，只是脑子在 cc-connect 那边。这样不同运行时的成员能在同一个频道里平等出现。
- **成员 = 名字 + 头像 + 运行时类型（`dsh` / `external` / `human`）+ 运行时绑定**。UI 不关心成员背后是什么。
- **接出去分两类**：
  - 文字平台（真 Discord、飞书）：先走 conest 现成路径（cc-connect 直连 Discord）；后续在 collab 加「频道镜像」，让 DSH 频道和 Discord 频道双向同步，同一任务两边可见，带 `platform + channel + messageId` 映射和来源标记防回环。
  - 语音和硬件：设备网关沿用 role-household 的四事件协议（已有真机/网页虚拟头实现），设备订阅某个成员；语音识别结果作为真人消息进入该成员的私聊频道，回复按句合成推给设备，收到回执再交棒。陪伴场景是一个成员 + 一个私聊频道 + 一台设备，但设备注册、播放归属和断线处理要另做，排在后面。

## 交叉审查修正（2026-10-21，gpt-6-astra，结论已逐条对照源码核实）

1. **「cc-connect 零改动接入」有条件成立。** cloud-web 不只是一条 WebSocket，服务端至少要实现：
   - `/cloud-web/ws`，token 鉴权（凭据只走 `Authorization` / `X-Cloud-Web-Token` 请求头，查询参数不传 token；`?bot=` 可选，只在带上时与凭据比对）；`register → register_ack`，能力必须显式列出（空列表会被当成全部支持）；心跳。
   - 入站 `message` 帧带频道、用户、回复上下文、mentioned、from_bot；出站收 `reply`。声明 preview 就要实现 `preview_start → preview_ack` 及更新/删除，客户端最多等 10 秒。
   - **隐藏耦合**：离线补历史硬编码 `GET /api/rooms/{id}/messages?before=&limit=`，房间 ID 用 `hub-` 前缀，消息字段为 `id/author_kind/author/name/text/created_at/card/from_turn`（`bridge/platform/cloud-web/history.go`）。不实现就丢离线上下文。
   - hub 还负责 @ 转换、过滤进度/状态消息、防止 bot 自回声（`role-household/rh/cloudweb.py`），不能只转发文本。
   - 普通 reply 没有持久化回执，不能承诺断线不丢。
2. **投递恢复与身份是最可能卡住的地方。** 每个「频道 × 成员」绑定一条 Session，用稳定 requestId 调 `session/prompt`，待投递记录先落盘、串行提交。现有去重检查与入队之间有异步窗口，不是并发幂等。回复用 `session/follow` 取，按 Session+seq 去重写回频道；重连后用 `session/page` 从保存的游标补齐。principal 来自调用方 Peer，要经带 Peer 的 Gateway 调用，否则全记成 owner。
3. **审批不是现成的。** role-household hub 没声明 card/buttons，cc-connect 会降级成文字。审批按钮要自己做渲染、授权、过期，再回 `card_action`；多人审批仍受 Gateway「只有 owner 能回答」限制。
4. **Host 插件可行，存储有上限。** HTTP 用 `webServer.register`，WS 用 `registerUpgrade`；这些裸路由不经 Gateway ACL，bot 和设备鉴权要自己做。storageDomain 打开时全量载入、只有单记录操作，首期够用，但不是分页数据库，消息量大了要换存储。
5. 对 `subagent-*` 的准确说法是「当前封装不支持持续交互」，不是底层协议不能流式。
6. **语音并不是最简单的一块。** 四事件只是播放协议，还缺设备注册、播放归属和断线处理（参考 `role-household/rh/hub.py`）。

## 分阶段（按审查调整：先打通最小纵切，再铺外壳）

| 阶段 | 交付 | 验收 |
| --- | --- | --- |
| 1. 最小纵切 | collab Host 插件：一个频道、一个 DSH 成员、一个经 cloud-web 接入的外部成员（cc-connect + Claude Code）；最简消息页 | @ 两个成员各自回答；重启 DSH 和 cc-connect 后历史还在、离线期间的消息补发、不重复执行 |
| 2. Discord 外壳 | 服务器栏、频道列表、成员列表、@ 菜单；多模型 DSH 成员（llm-pi-ai） | 浏览器建服务器/频道，加不同模型的成员，切换频道正常 |
| 3. 审批 | 卡片/按钮渲染与 `card_action` 回传；DSH 审批卡进频道 | 外部和 DSH 成员的工具权限请求都能在频道里批准/拒绝，过期失效 |
| 4. 真 Discord / 飞书 镜像 | collab 频道 ↔ 外部平台双向同步 | Discord 里发起、网页里继续、结果两边都能看到，不重复执行 |
| 5. 语音 / 设备 | 设备注册、播放归属、断线处理 + 四事件播放 + companion 语音 | 对设备说话 → 指定成员回答并播报；打断能停；设备掉线有明确状态 |
| 6. 多人 | 邀请登录、非 owner Peer、频道授权、审批 ticket | 两个真人各自登录同一频道；无权者看不到、不能审批 |

## 约束

- 遵守上游 `AGENTS.md` / `packages/client/AGENTS.md` 的插槽与分层规则；新代码放新包，尽量不改上游包，必须改的记在本文件。
- 凭据、CLI 登录态、录音只留本机，不进仓库。
- 已实现、已部署、真人已验收分开写。
