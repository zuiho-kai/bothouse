# collab：DSH 里的频道与多成员协作

上游 DSH 项目（未公开）的 Issue #229。一个以绝对路径加载的 DSH Host 插件（纯 ESM，无需构建），在 DSH Web 进程里提供：

- **频道**：消息存在 `dataDir/collab.sqlite3`，重启不丢；数字消息 ID 与 role-household hub 一致。
- **DSH 原生成员**：每个「成员 × 频道」绑定独立 DSH Session，由插件作为内部会话管理，不出现在普通 DSH 对话列表中，标题为 `#频道 · 成员名`。被 @ 时把频道里它没看过的消息作为一条用户消息投递，取对应轮次的回复写回频道。多个成员可以选择同一个模型，各自保留会话和人设。
- **本机 CLI 成员**：在原生频道页选择 Claude Code、Codex 或 Gemini；同一种 CLI 可以添加成多个不同成员，按成员创建运行实例、按成员和频道维护 ACP 会话。
- **外部 Agent（cc-connect）**：实现 cloud_web WebSocket 服务端（`/cloud-web/ws`）与离线补历史接口（`GET /api/rooms/{id}/messages`），协议行为照搬 `role-household/rh/cloudweb.py`，cc-connect 无需改代码。
- **最简消息页**：`/collab`，Discord 式三栏，SSE 实时更新。用 DSH 网页的登录 cookie 鉴权，跨源请求被 DSH 的 Host/Origin 校验拒绝。

## 数据存在哪里

用 `install.sh` 装进 profile 时，配置来自 `cordis.patch.yml`：`dataDir` 默认取环境变量 `CONEST_COLLAB_DATA`，没设就是 `~/.conest-collab`（频道消息 `collab.sqlite3` 存在这里）；`workspacePath` 默认取 `CONEST_COLLAB_WORKSPACE`，没设就是启动 DSH 时的当前目录。测试或多开时把 `CONEST_COLLAB_DATA` 指到别的目录，免得写进默认库。

团队工作台（`/collab/desk`）的输入来自任务板共享目录：`BOARD_DIR` 下的 `board-events.jsonl` 提供派活/交回事件，同目录的 `<project>.json` 提供各 bot 忙闲。忙闲目录可单独用 `teamStatusDir`（或 `CONEST_TEAM_STATUS_DIR`）指定；不设时沿用 `BOARD_DIR`。插件只读这些文件，不写任务板，也不改桥。状态文件里的 project 先按成员 id、再按显示名匹配；匹配不到就跳过，不新建成员。

Wiki 星河（`/collab/wiki-galaxy`）把一本 markdown wiki 画成可旋转的星系：每页一颗星，`[[链接]]` 和相对 `.md` 链接是星之间的连线，顶层目录是不同颜色的星团，点星看标题、描述和前几行。wiki 目录用 `wikiDir`（或 `CONEST_WIKI_DIR`）指定，不设时是 `~/wiki`。插件只读这个目录，不跟符号链接，不写任何文件；页面自带全部代码，离线可用。团队工作台右上角有入口。

频道、团队工作台、bothouse 面板、其他电脑在 DSH「插件 → bothouse」里各是一行，用 DSH 自带的开关分别开关（#1044）：新装只开频道，另外三项默认关；打开哪项，左边栏马上出现哪项，关掉马上消失，不用重启。老版本升级上来时，原来左边栏有的照旧开着（只做一次，之后按你在插件页的选择）。关掉的项只是左边栏不显示，`/collab/desk` 等地址照样能打开。这三项的网页端各是一个小包（`dsh/packages/bothouse-dsh-*`，由 `dsh/packages/bothouse-embeds/build.mjs` 生成）。打开后，「团队工作台」在主区域里直接显示团队工作台；「bothouse」在主区域里显示整个 bothouse 管理面板（概览、角色、用量等页都在里面；Wiki 星河也收在这块面板里，作为它自己的「Wiki 星河」子页，不再单独占左边栏一项），经 `/collab/panel/*`（只给主人）在服务端转发到主桥管理接口：插件每次请求时读 `bridgeConfig` 指的主桥配置文件里 `[management]` 段的地址和令牌，自己给请求签名，令牌不到浏览器；面板首页的 `<base href>` 改成 `/collab/panel/`，并加一个标记让面板不再要求登录。`bridgeConfig` 不设时依次用 `BOTHOUSE_CONFIG`、`$BOTHOUSE_DATA_DIR/config.toml`、`~/.bothouse/config.toml`；管理接口关着或连不上时框里显示原因。面板页面要用支持子路径的版本（`bridge/web` 里资源和接口都按 `<base href>` 走），旧版主桥带的面板挂在这里会打不开资源。

## 只用一个模型或一种 CLI 组队

原生 DSH 成员遇到上游 `Internal error` 重试时，频道会立即显示提示；同一回合连续三次失败后停止自动重试。对应成员的工作区任务会暂停，工作区和所属聊天频道都会收到原因，其他成员的任务不受影响。成功输出或进入新步骤会清零连续失败计数；本机 CLI 返回终止性的 `Internal error` 时也会暂停任务。服务恢复后重新派活，不会自动重放可能已经做过的步骤。

在原生 DSH 网页的「频道」→「添加成员」中，连续添加三个不同名字的成员：

- 都用 DeepSeek：成员类型选「DSH 模型」，三次明确选同一个提供方和模型，人设分别写规划、实现和检查。
- 都用 Codex：成员类型选「本机 CLI」，三次都选 Codex，填写不同名字和职责。本机只需装好并配置一次 CLI。
- 选择主角色，将「派活方式」设为「完全团队」，再用 @ 让它们分工交接。「单模型多进程」是派给角色自己的子任务，不会自动创建这些常驻成员。

创建成员不要求模型或 CLI 唯一，名字和成员 ID 才需要唯一。公共频道消息会提供给成员，私有会话不会因后端相同而合并；共享 wiki 和工作文件仍可能传递信息。当前成员共用 `workspacePath`，会话独立不是文件或权限隔离。完整步骤、恢复行为和检查清单见[同模型多成员指南](../../docs/single-cli-team.md)（[English](../../docs/single-cli-team.en.md)）。

## 启用

1. 生成 bot 共享 token，放进环境变量（不要写进配置文件）：`export CONEST_COLLAB_BOT_TOKEN=$(openssl rand -hex 24)`。
2. 写一个 overlay，例如 `collab.yml`：

   ~~~yaml
   - insert:
       - id: conest-collab
         name: /absolute/path/to/conest/dsh/collab/plugin.mjs
         config:
           dataDir: /absolute/path/to/collab-data
           workspacePath: /absolute/path/to/project   # DSH 成员 Session 的工作目录
           rooms:
             - { id: 1, name: general }
           dshMembers:
             - { id: ds, name: DeepSeek, persona: '可选：它是谁、负责什么' }   # 不写 model：首次请求前固定为 DSH 默认模型，之后跟随该 Session 自己的选择
             # - { id: claude, name: Claude, model: { provider: <provider id>, model: <model id> } }   # 写了 model：每次请求都用它，改配置会带动已绑定的 Session
           # maxRelay: 6        # Agent 连续接力上限（实例默认）；频道可在「频道设置 → 派活」里单独设 6–20
           # maxUploadBytes: 1073741824   # 单个附件上限（字节），默认 1 GB；见「附件上限」
           # ownerName: 我
   ~~~

3. 启动：`dsh --profile web --patch ./collab.yml`（源码仓库里用 `node --import tsx/esm apps/cli/src/bin.ts --profile web --patch ./collab.yml`），浏览器先打开终端打印的登录链接，再访问 `/collab`。

## 每频道工作目录

`rooms` 中可为每个聊天频道设置绝对路径 `workspacePath`，例如
`{ id: 1, name: general, workspacePath: /absolute/path/to/game }` 和
`{ id: 2, name: office, workspacePath: /absolute/path/to/office }`。
省略、空字符串或 null 使用实例的 `workspacePath`，旧配置保持原行为。
工作区在创建会话时继承当前所属聊天频道的目录；CLI 成员也按目录分别创建进程。
原生频道页也可在「频道设置 → 工作目录」保存已存在的绝对目录，界面保存的值优先于启动配置并在重启后保留。保存后会询问是否立即重建该频道所有 DSH 成员的会话（清空当前对话上下文）；选「稍后」保留现有会话，下次 `/new` 或新建会话才用新目录。工作目录只影响写入范围和相对路径，不影响读取。外部 cc-connect bot 的目录仍由它自己的配置管理。

频道设置中的主角色按聊天频道独立保存，工作区继承父频道。未设置时，频道只有一个机器人成员就由它自动接话；多个成员默认不接无 @ 消息，可在频道设置里选主角色。默认接话和 `/new` 按当前频道取值；派活票据的兼容逻辑仍保留旧全局回退。接口为 `GET|PATCH /collab/api/rooms/{id}/settings`（`lead_id`、`workspace_path`）及 `POST /collab/api/rooms/{id}/renew`，均需 owner 登录。

## 成员按频道归属

配置成员可写 `rooms: [1]` 或 `rooms: [1, 2]`；省略或空数组沿用全频道可见的兼容行为。每次启动都以配置覆盖该成员的归属，因此从配置删除 `rooms` 后，该配置成员会恢复全频道可见。
原生频道界面添加成员时默认全频道可见，编辑名字或模型不会清空已有归属。
工作区的成员列表、点名候选、队友状态及派活按所属聊天频道筛选。
升级时，未设置归属（数据库 NULL）的旧成员保持全局可见；未指定 `rooms` 或显式设置空数组的成员也对所有频道可见，包括以后新建的频道。已有明确归属不变，配置成员仍按配置处理；通过频道界面新建的成员默认全局可见。离线成员仍显示在所属频道，状态显示为离线。新频道未选主角色时，单成员自动接未 @ 消息，多成员不接；全局主角色不会替新频道自动做选择。

桥连接可在 WebSocket URL 加 `room=1`（也接受 `room=room-1`）；不写仍按旧行为接收各频道消息。
不同频道可有同名 bot，同一频道与其他成员重名会被拒绝；bot ID 仍须在整个实例内唯一。
连接断开后 bot 从成员列表移除，历史消息保留。

开发验收可在仓库根目录运行 `node dsh/collab/verify-multichannel.mjs`。这是验收脚本，非运行时依赖，启动插件不需要执行它；退出码 2 表示自动测试通过但人工验收尚未完成。

## 安装原生「频道」入口

先按 [DSH 构建说明](../README.md#目录与用法)准备固定版本的独立 checkout 并完成 `build:artifacts`。原生入口需要额外安装前端包并加入 overlay；原有 `/collab` 页面仍可使用。

在该 DSH checkout 中执行，安装与启动必须使用同一个隔离 `DSH_HOME`：

~~~sh
export DSH_HOME=/absolute/path/to/isolated-dsh-home
node --import tsx/esm apps/cli/src/bin.ts plugin --profile web add link:/absolute/path/to/new-dsh-checkout/packages/experimental/client-ui-discord
~~~

在前面的 `collab.yml` 末尾追加（保留 `conest-collab` 配置）：

~~~yaml
- insert:
    - id: conest-channels-ui
      name: '@deepseek-ai/dsh-experimental-client-ui-discord'
~~~

再从同一 checkout 启动：

~~~sh
node --import tsx/esm apps/cli/src/bin.ts --profile web --patch /absolute/path/to/collab.yml
~~~

打开终端打印的登录链接，点左栏「频道」。Enter 发送、Shift+Enter 换行，输入法确认键不发送。输入 `@` 弹出可点名的成员（Agent 在前，带类型、在线和工作状态），继续输入按名字或 id 过滤，↑↓ 选择、Enter / Tab 确认、Esc 关闭；输入框旁的 `@` 按钮和右侧成员栏也能直接插入 `@成员名`。发送未确认时保留草稿并阻止该频道重复提交，失败信息和草稿留在原频道。断线恢复会重新获取成员/工作状态及当前消息窗口，补齐遗漏消息和卡片编辑/删除。

## 在网页里管理频道和成员（单人多 bot）

- **标题栏与活动**：右上角显示当前频道实际生效的主角色头像与状态；响应状态来自当前频道及其工作区的实时 working 事件，其他频道的工作不会计入。活动栏默认收起，点标题栏「展开活动栏」（手机为「活动」）打开。顶部「任务板」打开原有协作任务板，继续使用既有任务数据与审核接口。此入口不是原生置顶板的完整快照，也不推断等待用户数量。
- **新建频道**：频道列表标题旁的 `+`。
- **频道设定**：右侧成员栏「派活方式」下的「频道设置」打开面板，设置派活方式、谁当家（主角色）及频道名称；侧栏快捷入口共用原有数据，主角色候选按当前频道筛选。主角色按频道保存；未选择时单成员自动接话，多成员不接话，也可清空已选主角色恢复此规则。
- **频道改名**：登录的 owner 调用 `PATCH /collab/api/rooms/{id}`，body `{ "name": "新名称" }`。名称为 1–32 字符且不能含空白，工作区名称不能改。改名保留 room id、消息及绑定，已有 DSH 会话标题同步为 `#新名称 · 成员名`，所属工作区的会话同样使用父频道名。数据库中的频道名在重启时保留；配置中的 rooms 名称仅初始化缺失频道。
- **添加成员**：原生频道页成员栏的「添加成员」，填名字（@ 时用，不能有空格，与所有成员不重名）、类型和人设。「DSH 模型」列出 DSH 已注册路由的模型；「本机 CLI」列出可检测到的 Claude Code、Codex、Gemini。成员存进 `collab.sqlite3`，重启后保留；检测到 CLI 不代表登录或适配器已可用，保存后要实际 @ 验证。
- **编辑 / 移除**：网页里建的成员悬停时出现「编辑」「移除」；配置文件里的 `dshMembers` 作为种子写入，网页里只读（标 ⚙）。移除后历史消息保留。
- **身份与人设**：每次投递都在提示词开头写明「你是频道 #x 的成员『名字』，底层模型 provider/model」，再附人设，并提醒成员区分频道里其他人的自我介绍。配置文件里也可以给 `dshMembers` 写 `persona`。
- **模型变更即时生效**：写了 `model` 的成员每次请求都用它；在成员表单里改模型，已绑定的会话下一次请求就切换，并在会话日志里记一条 `model/selection`。
- **重新开始对话**：在频道里发 `@成员名 /new`，只重置被点名成员在当前频道的会话，从该命令之后继续读取消息；其他成员、频道历史和 wiki 不因此清空。
- 接口（都需要 DSH 登录）：`GET /collab/api/models`、`POST /collab/api/rooms`、`POST /collab/api/members`、`PATCH|DELETE /collab/api/members/{id}`。
- Claude CLI 成员的 `model` 是 CLI 模型 ID 字符串（例如 `"sonnet"`），DSH 成员仍使用 `{ "provider": "...", "model": "..." }`。`PATCH /collab/api/members/{id}` 和 `/collab/api/panel/members/{id}` 都保留未传字段；`model: null` 清除覆盖，Claude 已有会话在下一轮恢复其初始默认模型。切换在发出下一轮提示词前应用，失败时停止该轮并报错，不默默沿用旧模型。配置文件成员仍只读。
- 建团队接口的成员项可写 `{ "name": "Claude", "cli": "claude", "model": "sonnet" }`；省略 `model` 使用该 CLI 的默认模型，省略 `cli` 保留原有 DSH 成员行为。

## 接入 cc-connect 成员

在 cc-connect 的项目里加一个 cloud_web 平台（和接 role-household hub 相同）：

~~~toml
[[projects]]
name = "ju"

[[projects.platforms]]
type = "cloud_web"

[projects.platforms.options]
transport = "websocket"
token = "${CONEST_COLLAB_BOT_TOKEN}"
base_url = "http://127.0.0.1:<DSH 端口>"
ws_url = "ws://127.0.0.1:<DSH 端口>/cloud-web/ws?bot=ju&name=%E6%A9%98"   # bot=成员 id，name=显示名（URL 编码），可加 &mention_id=<数字>
allow_from = "*"
share_session_in_channel = true
group_reply_all = false       # 见下方「只在被 @ 时回答」
~~~

**只在被 @ 时回答**：cc-connect 的 `gate_fallback` 只在配置了 gate 服务（`gate_url`）且 gate 出错时才生效（`bridge/core/gate.go`），没有 gate 时 `group_reply_all = true` 会把频道里每一句都交给 Agent。两种配法：

- 没有 gate：`group_reply_all = false`。只处理 @ 它的消息；代价是看不到频道里其他人的发言（离线补历史也只在 gate 路径上运行）。
- 有 gate（线上 maomao 的做法）：`group_reply_all = true`，加 `gate_url` 与 `gate_fallback = "context"`。没 @ 的消息只听不答，被 @ 时带上频道上下文，掉线期间的消息经本插件的历史接口补回。

**桌面版（端口每次随机）**：DSH 桌面版启动 Web 宿主时端口固定传 0，主桥配不了固定地址。给桌面 profile 的 conest-collab 配 `botPort: <端口>`（或环境变量 `CONEST_COLLAB_BOT_PORT`），插件另开 `127.0.0.1:<端口>`，只接 `/cloud-web/ws` 握手和 `/api/rooms/…` 补历史，口令同上；主桥再给每个项目加一段 cloud_web 指向这个端口。不配不开。

同一个 bot id 再次连接会顶掉旧连接。成员 id 不能与 DSH 成员或 `owner`/`user`/`system` 重名。

## 行为约定

- **至多执行一次**：DSH 成员的每次 @ 是一条持久 job（成员 × 触发消息唯一），与消息在同一个 SQLite 事务里写入，消息存下就一定有 job。投递前记下 Session 位置和输入的消息 id；回复只取「消费了这条输入的那一轮」，不会把同一 Session 中其他来源的轮次当作频道回复发布。重启后：已结束的那一轮从 Session 日志补发；输入还在 DSH 收件箱里没被消费的，撤回并说明；中途被打断的标记为「被重启打断」。任何情况都不自动重发。
- **顺序**：同一成员在同一频道的投递、重启恢复和 Session 续接走同一个队列，不会并发续接同一个 Session。插件卸载时先停队列再关数据库，未完成的 job 留给下次启动的恢复流程。
- **防循环**：Agent 消息里点名或 @ 了 DSH 成员也会触发它，但从上一条真人消息起 Agent 连续发言超过接力上限后暂停，并在频道里说明。上限默认取实例的 `maxRelay`（未配置时 6），每个频道可在「频道设置 → 派活 → 接力上限」里单独设 6–20 的整数，即时生效、刷新和重启后保留；工作区读写所属频道的那份值（#445）。
- **转发规则**（与 hub 一致）：系统消息、进度卡片、cc-connect 状态提示（📬 ✅ ↪ …）不转给成员；回复末尾的「模型 · 用量」尾注在转发前去掉；自己说的话不回给自己。

## 附件上限

一个附件走的是单独的流式上传接口（`POST /collab/api/attachments`，源码 `dsh/collab/attachments.mjs` `saveStream`）：网页把文件按块直接写盘，不经过消息 JSON，也不整块读进内存，所以上限不再由消息体（8 MiB）决定，而是由配置项 `maxUploadBytes` 决定，默认 1 GB（`DEFAULT_MAX_UPLOAD_BYTES`）。

- **默认值来源**：用户 2026-11-05 21:01「需要大一些 尽可能大」。实测（本机 macOS，`node --test dsh/collab/attachments.test.mjs`，同一个真实 HTTP 路由）：100 MB 用时 70–75 ms、进程 RSS +8～12 MB；500 MB 用时 350–520 ms、RSS 基本不涨；1 GB 用时 650–1050 ms、RSS 基本不涨。写入是流式的，内存不随文件变大。
- **调小**：`collab.yml` 里加 `maxUploadBytes: 104857600`（100 MB）之类即可；也可用环境变量覆盖，改完重启 DSH 生效。超限时网页的待发文件条会写明「超过单个文件上限 X」，发送前就拦下；把文件拖进来时也会先按「频道设置」里读到的上限检查。
- **磁盘**：附件存在数据目录的 `attachments/`，1 GB 的文件就占 1 GB 磁盘。上限调大前先确认这台机器余量。
- **给机器人**：一条消息的附件合计不超过 50 MiB（`MAX_BOT_ATTACHMENT_BYTES`，沿用 cc-connect 的 `DefaultMaxAttachmentSize`）时照旧转成图片/文件帧；单个更大的文件不进连接，机器人在提示里拿到它在本机的绝对路径（`oversizedNote`），自己去读。
- **图片看图**仍是 5 MiB、png/jpeg/gif/webp 四种格式（`MAX_IMAGE_BYTES`、`INLINE_IMAGE`），这次没有改动；heic 会在看图路径上被跳过。

## 验证

~~~sh
node --test dsh/collab/*.test.mjs
~~~

单测覆盖存储去重与分页、@ 改写、cloud_web 帧行为、DSH 成员投递/去重/恢复、接力上限与配置校验。

2026-10-21 在隔离的 `DSH_HOME` 上对 DSH 0.2.1-rc.2 源码做了真机联调：

- 真实 cc-connect（本仓库 bridge 构建，Claude Code / haiku）经 cloud_web 接入，@ 后在频道回复。（更正：先前记录的「`gate_fallback = "context"` 下没 @ 的消息静默」不成立——没有 gate 时该项不生效，那次静默是模型自己选择不回；见上方「只在被 @ 时回答」。）
- DSH 成员走真实 DSH Session 与真实 DeepSeek 适配器，模型端为 DSH 自带的 mock LLM 服务；回复写回频道并转给 cc-connect 成员，一次 @ 只产生一次模型请求。
- 重启 DSH 后历史保留；cc-connect 的真实 `ChannelHistory` 读取本插件的历史接口，字段、系统消息过滤、`from_turn` 标记正确。
- 上述后端联调未验证真实 DeepSeek 模型回复、cc-connect 配 gate 时的自动补历史；原生页面随后获用户确认正常。

本轮收尾验证（2026-10-21）：后端 15 项、前端 11 项通过；数据源 5 项异步竞态回归和组件 2 项草稿回归均先红后绿。DSH host/client aggregate `build:check`、插件打包和 client package verifier 通过。浏览器自动登录被本地文件 URL 安全策略阻止，本轮未重新完成浏览器验收；没有真实模型调用或生产部署。

使用 Node 22.12+，在 CoNest 根目录运行数据源回归（仅覆盖不依赖 React 的传输层）：

~~~sh
npm ci --prefix dsh --no-audit --no-fund
npm test --prefix dsh
~~~

CI 将同一份 package.json/package-lock.json 复制到每次 job 新建的 RUNNER_TEMP 子目录，执行 npm ci，再调用该目录的 Vitest 跑相同配置。依赖版本和完整依赖树入库，避免 npx 每轮重新解析；本机安装目录与上游 DSH checkout 独立。

完整前端测试和类型检查在上述 DSH checkout 中运行：

~~~sh
corepack pnpm exec vitest run packages/experimental/client-ui-discord/tests
corepack pnpm run build:check
~~~

仓库级检查另有未通过项：本机 `go test -tags no_web -p 1 -count=1 ./...` 的安装向导测试 `TestAnnounceSetupWizardAlwaysPrintsLink` 被宿主 `LC_ALL=C.UTF-8` 覆盖测试内的 `LANG`；清除 `LC_ALL/LC_MESSAGES` 后该项通过。`TestSetupCLIsHint` 仍失败：测试清空 PATH 后预期 `[]`，探测器仍搜索 Homebrew 固定路径与 `/Applications/WorkBuddy.app`。本轮没有修改 bridge 源码或测试；保留此失败，PR 维持草稿，不能称仓库全量通过。

## 已知限制

- 单人：浏览器端只有 DSH owner 一个真人身份（多人见阶段 6）。
- 会话：DSH 原生成员是插件管理的内部会话，普通对话列表没有独立私聊入口。非频道轮次不会自动当作频道任务回复发布，这不保证模型以后不会在公开回答里引用已知内容。
- 配置来源：原生频道页可以新建频道、添加/编辑成员；来自配置文件的种子成员在网页只读，要到原配置中修改。
- 共享边界：成员共用配置的工作目录；启用的 wiki、工具和宿主机权限仍需单独管理，不能把独立 session 当作强隐私边界。
- 原生页面首次加载最近 100 条，重连补齐当前窗口；尚无向上翻历史控件。
- 原生窄屏页面通过抽屉打开频道和成员栏；审批可在频道卡片中处理。不同入口的能力不能仅凭内部会话是否可见来判断。

### @ 叫醒规则与页面着色的已知偏差

页面上的 @ 徽章是在渲染后的 DOM 上打的，后端是在原文上切的，两条路只对齐了「代码里的 @ 不算」这一族。下面这些是**本来就有的偏差**，不是这次改动引入的；列在这里是为了不把「没对齐」当成「已经对齐」（#259、#271）：

- `~~~` 波浪线围栏：页面当代码渲染、不着色，后端只认 ```，所以里面的名字后端仍会叫醒。
- `$$` 数学块：页面把它当成段落结束，后端不认，于是跨 `$$` 的反引号片段在后端仍算一段（谁都不叫醒，页面两个名字都着色）。
- GFM 表格分隔行（`|---|`）：同上，页面段落结束、后端仍算一段，结果是谁都不叫醒而页面两个名字都着色。
- 四空格缩进代码块（`    @肥鱼 看下`）：页面当代码渲染、不着色，后端没有缩进代码块的判断，会叫醒。脚注共用这一条：`    [^1]: 注 @肥鱼` 在页面上是代码块、整行隐藏，后端也不把它当定义，所以会叫醒；同样，只写在四空格行上的 `[^2]` 页面不当作引用，后端会当作引用，从而把 `[^2]:` 那条脚注显示出来。
- 嵌套脚注定义（定义行比外层正文的内容列多缩进四格或更多）：页面把它嵌在外层脚注里、只在它自己的标号被引用时显示；后端只收 0-3 格的定义，那一行从来不算定义，它的标号也不算标号。于是两边给的答案一致却不是页面的答案，两个方向都反：`[^1]: a` 换行四空格 `[^2]: 注 @名字` 再空行 `见 [^1]`，后端会叫醒，页面外层脚注只显示 `a`、一个徽章都没有；同样内容末尾改成 `见 [^2]`，后端谁都不叫，页面却有这个徽章。`bdd67b4` 上也是这个结果，不是 #271 引入的；#323 只更正了说明，没有扩大实现范围。
- 开括号落在块行上（`# ` 加反引号加名字）：段落在那行之前就结束了，页面不会把它当代码片段、两个名字都着色；`endsParagraph` 只看两个反引号**之间**的行，所以后端仍当成一段、谁都不叫醒。

### One-shot member follow-ups

All three member types can register a one-shot wake with `POST /collab/api/rooms/{id}/later` (owner session or bot bearer token): `{ "member": "role-id", "delay": "10m", "title": "Check build", "todo": "Read the build log and report failures" }`. Native and local CLI prompts also contain the local `node later.mjs <database> <member> <room> <delay> <title> <todo>` command. The SQLite queue survives restart; offline members retain their pending wake. Attachment inputs share the existing `wire()` MIME/5 MB image policy; larger or unsupported images are files.
