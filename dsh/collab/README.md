# collab：DSH 里的频道服务（阶段 1 最小纵切）

Issue [#229](https://github.com/Zssan12/conest/issues/229)。一个以绝对路径加载的 DSH Host 插件（纯 ESM，无需构建），在 DSH Web 进程里提供：

- **频道**：消息存在 `dataDir/collab.sqlite3`，重启不丢；数字消息 ID 与 role-household hub 一致。
- **DSH 原生成员**：每个「成员 × 频道」绑定一条普通 DSH Session（在 DSH 网页里也能打开，标题 `#频道 · 成员名`）。被 @ 时把频道里它没看过的消息作为一条用户消息投递，取这一轮最后一条非空回复写回频道。模型可按成员指定，默认用 DSH 当前默认模型。
- **外部 Agent（cc-connect）**：实现 cloud_web WebSocket 服务端（`/cloud-web/ws`）与离线补历史接口（`GET /api/rooms/{id}/messages`），协议行为照搬 `role-household/rh/cloudweb.py`，cc-connect 无需改代码。
- **最简消息页**：`/collab`，Discord 式三栏，SSE 实时更新。用 DSH 网页的登录 cookie 鉴权，跨源请求被 DSH 的 Host/Origin 校验拒绝。

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
           # maxRelay: 6        # Agent 连续接力上限，超过后需要真人再 @
           # ownerName: 我
   ~~~

3. 启动：`dsh --profile web --patch ./collab.yml`（源码仓库里用 `node --import tsx/esm apps/cli/src/bin.ts --profile web --patch ./collab.yml`），浏览器先打开终端打印的登录链接，再访问 `/collab`。

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

- **新建频道**：频道列表标题旁的 `+`。
- **添加 DSH 成员**：成员栏顶部「添加成员」，填名字（@ 时用，不能有空格，与所有成员不重名）、模型（下拉框列出 DSH 已注册路由的模型；某条路由读不到时会注明原因）、人设。成员存进 `collab.sqlite3`，重启后保留。
- **编辑 / 移除**：网页里建的成员悬停时出现「编辑」「移除」；配置文件里的 `dshMembers` 作为种子写入，网页里只读（标 ⚙）。移除后历史消息保留。
- **身份与人设**：每次投递都在提示词开头写明「你是频道 #x 的成员『名字』，底层模型 provider/model」，再附人设；频道里其他成员的自我介绍不会被当成它自己的。配置文件里也可以给 `dshMembers` 写 `persona`。
- **模型变更即时生效**：写了 `model` 的成员每次请求都用它；在网页里改模型，已绑定的会话下一次请求就切换，并在会话日志里记一条 `model/selection`（DSH 网页里显示的模型随之变化）。
- 接口（都需要 DSH 登录）：`GET /collab/api/models`、`POST /collab/api/rooms`、`POST /collab/api/members`、`PATCH|DELETE /collab/api/members/{id}`。

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

同一个 bot id 再次连接会顶掉旧连接。成员 id 不能与 DSH 成员或 `owner`/`user`/`system` 重名。

## 行为约定

- **至多执行一次**：DSH 成员的每次 @ 是一条持久 job（成员 × 触发消息唯一），与消息在同一个 SQLite 事务里写入，消息存下就一定有 job。投递前记下 Session 位置和输入的消息 id；回复只取「消费了这条输入的那一轮」，所以同一 Session 在 DSH 网页里直接对话的轮次不会被发到频道。重启后：已结束的那一轮从 Session 日志补发；输入还在 DSH 收件箱里没被消费的，撤回并说明；中途被打断的标记为「被重启打断」。任何情况都不自动重发。
- **顺序**：同一成员在同一频道的投递、重启恢复和 Session 续接走同一个队列，不会并发续接同一个 Session。插件卸载时先停队列再关数据库，未完成的 job 留给下次启动的恢复流程。
- **防循环**：Agent 消息里点名或 @ 了 DSH 成员也会触发它，但从上一条真人消息起 Agent 连续发言超过 `maxRelay` 条后暂停，并在频道里说明。
- **转发规则**（与 hub 一致）：系统消息、进度卡片、cc-connect 状态提示（📬 ✅ ↪ …）不转给成员；回复末尾的「模型 · 用量」尾注在转发前去掉；自己说的话不回给自己。

## 验证

### 停止和继续接口（Issue #8，前端按钮待接入）

两个接口沿用 DSH 登录校验，只接受 POST，可发空 body：

- `/collab/api/rooms/{id}/stop`：先持久化频道暂停和旧消息截止点，再将该频道 pending/sent jobs 标为 interrupted。仅撤回频道自己的 inbox input；对已加载且正在处理该输入的 Agent 调 `cancel({kind:'user'}, {keepInbox:true})`。不会为了停止去 resume Session。
- `/collab/api/rooms/{id}/continue`：解除暂停并重置接力预算；到上限时暂存的触发消息只重新派发一次，不重复写历史。手动停止取消的 jobs 不重跑；暂停期间新消息只进历史，继续后不自动补投，需要重新 @。

stop 返回 `{room_id, stopped:true, cancelled_jobs, unconfirmed, stopped_members, output_only, recalled}`。每个 DSH Agent 最多等待 5 秒，超时也清除 thinking，并把未确认退出的成员 id 放进 unconfirmed；这不代表其底层工具已结束。用户取消显示「已停止」，半截回答不触发下一轮接力。continue 返回 `{room_id, resumed, stopped:false}`；重复调用不会再投递或重置预算；停止请求尚在收尾时返回 409。未登录为 401、房间不存在为 404、非 POST 为 405。

cloud_web 没有停止确认协议：这里清显示状态，并按 reply_ctx 的 epoch 屏蔽旧回复/typing/preview。网关为每个已连接 bot 记住每个频道最近下发的 6 条 msg_id（cc-connect 排队上限 5 条加 1 条在跑），停止时逐条发 `{type:'message_recall', msg_id:'hub-<id>', chat_id:'room-N'}`，cc-connect 据此停掉正在跑的那一轮、删掉排队中的消息，然后清空记录；bot 断开时记录也清掉。收到过撤回的 bot 列入 recalled。停止时仍显示工作中的外部 bot 列入 output_only：在 recalled 里的报 requested（已请求停止，bridge 不回确认），不在的报 unsupported（只屏蔽旧输出）。新请求的 chat_id 不变，reply_ctx 变为 `room-N:epoch-E`；客户端须原样回显。预览编辑/删除没有 reply_ctx，按原消息 id 与停止截止点校验。

`GET /collab/api/state` 增加 room_controls；SSE 增加 `{type:'room_control',room_id,stopped,epoch,cutoff,relay_after}`。接力上限提示的 card 为 `{type:'relay_limit',room_id}`，供同一 PR 后续前端接继续按钮。暂停状态和接力待续消息持久化，迁移为 SQLite schema 4；回滚到旧代码需同时恢复升级前数据库备份。

测试使用真实 SQLite、Hub 和本地 HTTP 服务，DSH Agent / WebSocket 为测试替身。pin 的 Inbox.remove 只移除输入、不发 discarded 事件；实现不依赖该事件，测试同时覆盖有/无事件。尚未在真实 DSH host、真实模型或浏览器上验收，不等于已部署。

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
- 审批：cloud_web 未声明按钮/卡片，cc-connect 的权限请求会降级成文字；DSH 成员的审批要到 DSH 网页里对应 Session 处理。
- DSH 成员的 Session 也可以在 DSH 网页里直接对话；那样的轮次不会写回频道，频道也看不到。
- 频道和成员只能在配置里声明，页面上不能新建。
- 原生页面首次加载最近 100 条，重连补齐当前窗口；尚无向上翻历史控件。
- 当前窄屏（小于 900px）隐藏频道和成员栏，不能切换频道。
- 尚无服务器创建、成员编辑、@ 自动补全和可交互审批卡。
