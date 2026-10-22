# bothouse「频道」原生 DSH 客户端插件 — 实现设计说明

> 调研时间：2026-10-21 23:00 前后（UTC+8）。只读调研，未改代码。
> 基线：bothouse `main`（含 PR #3）；DSH 上游按 [dsh/upstream.pin.json](https://github.com/zuiho-kai/bothouse/blob/main/dsh/upstream.pin.json) 的 `687f282e8625c6b8d11ff58211a90524be2e4317`（0.2.1-rc.2）。
> 记号：`B:` = `https://github.com/zuiho-kai/bothouse/blob/main/`，`D:` = `https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/`

## 0. 结论

- **方案 A 不用从零开始写，大部分已经在 `client-ui-discord` 里了。** 它已经是 React 写的 DSH 原生客户端插件，通过 `ctx.slots` 挂在 `sidebar.panellist`（左栏入口）和 `main`（中间面板）；它走的是 collab 的 `/collab/api/*` 和 SSE `/collab/api/events`，**不复用 `/collab` 页面（page.html）的逻辑**。样式基本用 DSH 的 `--dsw-*` token（86 处 `var(--`），只有 **4 处硬编码颜色（含弹窗遮罩）和 1 个头像色板**要改。
- 主要差距：
  1. 单文件 `ChannelsPage.tsx`（411 行）要拆成几个组件。
  2. **停止只有一半**：#20 已加 8a（DSH 成员走 `agent.cancel`），8b（cloud_web 停止协议）未做；原来只有 `maxRelay` 接力上限。
  3. 重连后靠全量 `refresh` 补状态，没有按 `after` 做增量补消息，也没有退避。
  4. 进度卡只渲染 title/state 两个字段；`relay_limit` 卡片没有 title，且「等批准」的任务在频道里看不见。
  5. 头像色、在线绿点和弹窗遮罩不跟随主题。
  6. 手机端（≤900px）切不了频道。
- 落地顺序按 owner 复核后的优先级：主题收口 → 页面测试接进 CI → 数据层（整窗对账、退避重连、乐观发送）→ 手机端 → 停止和继续 → 组件拆分 →（可选）卡片与审批入口。详见 §10。
- **本阶段不含**：派活回交（agent 之间自动把结果交回发起者）与记忆管理（共享记忆 / wiki 的读写）。这五个 issue 只把「频道这个入口」做扎实，不是把愿景做完，做完五步也不等于主线收尾。另外「等批准」的处理入口（§9）单独一期，不塞进这五步。

## 1. 现状差距

| 项目 | 现状 | 证据 | 差距 |
|---|---|---|---|
| 左栏入口和主面板 | 已有，`sidebar.panellist` 的 order 是 5，`main` 的 key 是 `channels` | [B:dsh/packages/client-ui-discord/src/client/index.ts](https://github.com/zuiho-kai/bothouse/blob/main/dsh/packages/client-ui-discord/src/client/index.ts) | 无 |
| 频道视图 | React 单组件，包含频道列表、消息、输入框、成员栏 | [B:.../ChannelsPage.tsx](https://github.com/zuiho-kai/bothouse/blob/main/dsh/packages/client-ui-discord/src/client/ChannelsPage.tsx) | 需要拆分 |
| 数据层 | 不依赖 React 的 `createChannelSource`，基于 `ObservableSnapshot`；第一个订阅者出现时才开 SSE，最后一个离开就关 | [B:.../channel-source.ts](https://github.com/zuiho-kai/bothouse/blob/main/dsh/packages/client-ui-discord/src/client/channel-source.ts) | 重连只有全量 refresh，没有退避；改成整窗对账见 §4.3，已由 #18 实现 |
| 重连对账 | `main` 的 `channel-source.ts` 重连时从缓存窗口最早一条重读，注释写明 *cards can be edited/deleted while offline* | [B:.../channel-source.ts](https://github.com/zuiho-kai/bothouse/blob/main/dsh/packages/client-ui-discord/src/client/channel-source.ts) | **不能退化成只补新增**，否则离线期间被改/被删的卡片会一直显示旧状态；正确做法是整窗对账（§4.3） |
| 复用 /collab 页面 | **不复用**。page.html 是独立的最简页面，跟原生插件只共用后端 API | [B:dsh/collab/page.html](https://github.com/zuiho-kai/bothouse/blob/main/dsh/collab/page.html) | 原生插件稳定后可以把 page.html 降级成调试页 |
| @ 补全 | 已有 `activeMention`、`rankMembers` 等函数，并有测试 | [B:.../mention-complete.ts](https://github.com/zuiho-kai/bothouse/blob/main/dsh/packages/client-ui-discord/src/client/mention-complete.ts) | 弹层的键盘交互要单独做成组件 |
| 成员管理 | MemberDialog 支持增、改、删，能选模型 | [B:.../MemberDialog.tsx](https://github.com/zuiho-kai/bothouse/blob/main/dsh/packages/client-ui-discord/src/client/MemberDialog.tsx) | 无 |
| 工作状态 | 后端发 `thinking` 事件，前端按频道显示 | [B:dsh/collab/hub.mjs](https://github.com/zuiho-kai/bothouse/blob/main/dsh/collab/hub.mjs) | 无 |
| 停止 | `main` 里**没有**；#20 已加 `POST /collab/api/rooms/{id}/stop`、`/continue`，DSH 成员用 `agent.cancel({kind:'user'},{keepInbox:true})`（`dsh-member.mjs:286`） | [B:dsh/collab/plugin.mjs](https://github.com/zuiho-kai/bothouse/blob/main/dsh/collab/plugin.mjs) | 8a 有实现；8b（cloud_web 停止协议）未做，只能屏蔽旧输出，见 §8 |
| 待批准 | 页面只渲染卡片 `title`/`state`；collab 只做了 `permissionPresets.set`（`dsh-member.mjs:277`），没有把 approval 请求转出来 | [B:.../ChannelsPage.tsx](https://github.com/zuiho-kai/bothouse/blob/main/dsh/packages/client-ui-discord/src/client/ChannelsPage.tsx) | 「等批准」的任务在频道里看不见，处理入口要单独设计（§9） |
| 手机端 | ≤900px 直接把 `.rooms`、`.members` 设为 `display: none`，没有替代入口（`ChannelsPage.module.css:375`） | [B:.../ChannelsPage.module.css](https://github.com/zuiho-kai/bothouse/blob/main/dsh/packages/client-ui-discord/src/client/ChannelsPage.module.css) | 手机上切不了频道（§7） |
| 页面测试 | `channels-page.client.spec.tsx` 不在 `dsh/vitest.config.mjs` 的 include 白名单里，仓库没装 jsdom / @testing-library | [B:dsh/vitest.config.mjs](https://github.com/zuiho-kai/bothouse/blob/main/dsh/vitest.config.mjs) | 页面零覆盖，「测试跟着组件迁移」是空话，要先接进 CI |
| 接力上限 | 后端 `maxRelay`（默认 6），超过后发一条系统消息 | [B:dsh/collab/dsh-member.mjs](https://github.com/zuiho-kai/bothouse/blob/main/dsh/collab/dsh-member.mjs) 第 14–15、167–170 行 | 前端没有专门提示，也没有"继续"按钮 |
| 主题 | 86 处 `var(--dsw-*)`；硬编码有 `#fff`（第 126、565 行）、`#23a55a`（第 351 行，在线点）；头像 `PALETTE` 有 8 个 Discord 色 | [B:.../ChannelsPage.module.css](https://github.com/zuiho-kai/bothouse/blob/main/dsh/packages/client-ui-discord/src/client/ChannelsPage.module.css)、`ChannelsPage.tsx` 第 26 行 | 改成 token |

## 2. 左栏入口挂载方式

- Slot 名：`sidebar.panellist`（左栏图标入口），主面板用 `main`，再配合 `@deepseek-ai/dsh-client-ui-layout` 的 `MainPanelId` 和 `selectPanel()`（[D:packages/client/ui-layout/src/client/service.ts](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-layout/src/client/service.ts)）。
- 上游示例：插件管理面板 [D:packages/client/ui-plugin-manager/src/client/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-plugin-manager/src/client/index.ts)（第 144 行起 `ctx.slots.inject('sidebar.panellist', …)`），图标组件参考 `PluginsPanelIcon.tsx`、`ui-schedule/TaskManagerIcon.tsx`。
- 官方 agent-team 的挂法：[D:packages/experimental/client-ui-agent-team/src/client/mount.ts](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/experimental/client-ui-agent-team/src/client/mount.ts)，挂在 `conversation.session.header.actions`，并用 `ctx.uiWorkspace.openSession()` 打开子会话。频道里点某个 DSH 成员时，可以用同一个 API **跳到它绑定的 Session**。
- 现有写法保持不变（`index.ts`）：

```ts
export const inject = ['slots', 'locale']
ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS, inject: injected }, ChannelsPage))
ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 5, locale: NS, ... }, ChannelsIcon))
```

- 路由：查不到 DSH 有基于 URL 的面板路由，面板切换靠 layout service 的 `activePanelId`。直接用深链打开某个频道，**目前没有办法**；需要的话可以在插件内部用 `location.hash` 记住当前 roomId（待定）。

## 3. 组件拆分

```
ChannelsPage (容器：读 snapshot、分发 actions)
├─ RoomList            频道列表 + 新建频道（createRoom）
├─ RoomView
│  ├─ RoomHeader       #名称、工作中成员、StopButton（三态文案）
│  ├─ MessageList      虚拟/分页滚动，向上翻用 before=
│  │  ├─ MessageRow    作者、时间、文本
│  │  ├─ ProgressCard  card JSON 渲染；relay_limit 卡片没有 title，要单独渲染
│  │  │                （「继续」按钮就放在这张卡上）
│  │  ├─ ApprovalCard  「等批准」卡片，允许一次 / 拒绝（§9，单独一期）
│  │  └─ SystemNotice  接力上限等系统消息 + “继续”按钮
│  └─ Composer         输入框 + MentionPopover（mention-complete.ts）
├─ MemberPanel         分组（人/DSH/外部 bot）、在线/工作中/等批准、编辑入口
│  └─ MemberDialog     （已有）
├─ MobileDrawer        ≤900px 的频道抽屉 / 成员抽屉（§8）
└─ StatusBanner        phase: loading/unavailable/unauthorized/error/重连中
```

- 停止按钮和系统提示共用一份三态文案（`confirmed` / `requested` / `unsupported`），别各写一套（§7.1）。
- 现有测试 `tests/channels-page.client.spec.tsx` 拆开放到各个组件。**前提是它先被接进 CI**，否则「测试跟着迁移」没有意义（§1、§10 PR2）。
- 每个组件配一个自己的 `*.module.css`，只用 token。

## 4. 数据层

### 4.1 collab 现有接口（来自 [B:dsh/collab/plugin.mjs](https://github.com/zuiho-kai/bothouse/blob/main/dsh/collab/plugin.mjs)）

浏览器侧接口都要求 owner 身份（`ctx.connection.requestRejection(req) === undefined`，即 DSH 的登录 cookie）：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/collab` | 旧的最简页面 |
| GET | `/collab/api/state` | `{ me, rooms, members, thinking }` |
| GET | `/collab/api/events` | SSE，`data: <json>`，每 25 秒发一次 `: ping` |
| GET | `/collab/api/rooms/{id}/messages?after=&before=&limit=` | 增量或翻页 |
| POST | `/collab/api/rooms/{id}/messages` | `{ text, client_key }`，`client_key` 用来去重 |
| POST | `/collab/api/rooms` | `{ name }`，1–32 个字符、不能有空格 |
| GET | `/collab/api/models` | `{ routes }` |
| POST/PATCH/DELETE | `/collab/api/members[/{id}]` | 成员增、改、删 |
| GET | `/api/rooms/{id}/messages?before=&limit=` | 给 cc-connect 补历史用（bot token 或 owner） |
| WS | `/cloud-web/ws` | 给 cc-connect 外部 bot 用，前端不用 |

错误码映射：`room-missing`/`member-missing` → 404，`conflict` → 409，`read-only` → 403，其他 → 400。

### 4.2 SSE 事件（来自 [B:dsh/collab/hub.mjs](https://github.com/zuiho-kai/bothouse/blob/main/dsh/collab/hub.mjs)、plugin.mjs、[B:dsh/collab/cloudweb.mjs](https://github.com/zuiho-kai/bothouse/blob/main/dsh/collab/cloudweb.mjs)）

- `{type:'message', message}`：新增或更新消息（cloudweb 的 preview/update 也会走这个事件）
- `{type:'deleted', id, room_id}`
- `{type:'members', members}`：成员全量
- `{type:'thinking', room_id, members}`：某个频道里正在工作的成员
- `{type:'rooms', rooms}`：频道全量

### 4.3 前端 store 和重连策略

- 继续用 `ObservableSnapshot`（`@deepseek-ai/dsh-client-store`），React 侧用 `useSyncExternalStore` 或 DSH 的 hooks 注入（现有的 `hooks.channels`）。
- 状态按 `messagesByRoom: Map<roomId, {items, oldestId, newestId, hasMore}>` 缓存，切换频道时不丢数据。
- 消息以 `id` 为键合并（`message` 事件既可能是新增也可能是更新），`deleted` 事件删掉对应条目。
- 乐观发送：先插一条带 `client_key` 的临时消息，收到服务端回执或 SSE 推送后替换。失败时标红，可以重试，重试沿用同一个 `client_key`，后端会去重。
- 重连：
  - `onerror` 后进入 `reconnecting` 状态，按 1、2、4、8 秒退避，最长 30 秒，再加随机抖动（等待落在 `[base/2, base]`，`base = min(1000·2^n, 30000)`，所以抖动后也不超过 30 秒）。
  - `onopen` 后先拉 `/collab/api/state`。
  - 然后**对当前频道的整段本地缓存做对账**：从缓存里最早那条的 id 开始，用 `after=` 逐页（每页 200）读到最新，服务端仍然返回的行以服务端内容覆盖，缓存区间内服务端不再返回的行删掉。**唯独不要全量重拉整个频道历史**：缓存的起点是本地最早一条，不是房间最早一条。
  - 为什么必须整窗而不是只补新增：`after=` 只报告「仍然存在的行」，看不到编辑和删除。进度卡会被反复改写，离线期间被改的卡若只补新增就会一直显示旧进度（见 §1「重连对账」与 owner 复审第 1 条）。只重读最新一页同样不够——`loadOlder` 翻上来的更早卡片仍会停在旧内容。
  - 空页也是权威信息：重读区间返回空，说明缓存区间内的行在离线期间被删光了，要一并清掉。
  - 页面隐藏时不强制断开，恢复可见时如果连接已断，立即重连。
- 向上翻页（`before=oldestId&limit=100`）：
  - 每个房间同时只允许一个翻页请求，**按房间加闩**：一个房间的请求在飞时，另一个房间照样能翻页。
  - 请求回来时校验房间，切换过频道就丢弃这一页，不能把旧房间的行并进新房间。

## 5. 主题

- token 来源：[D:packages/client/ui-theme/src/styles/design-platform.css](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-theme/src/styles/design-platform.css)，分三层：`--dsw-static-*` 原色、`--dsw-alias-*` 语义、`--dsw-specific-*` 组件。浅色定义在 `body`，深色在 `body[data-ds-dark-theme]`。
- 切换机制：[D:packages/client/ui-theme/src/client/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-theme/src/client/index.ts) 根据设置（light/dark/system，system 跟随 `prefers-color-scheme`）给 `body[data-ds-dark-theme]` 设值；启动时的 [boot-theme.ts](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-theme/src/boot-theme.ts) 负责防止闪屏。
- 约束：插件**只用 `--dsw-alias-*` 和少量 `--dsw-radius-*`、`--dsw-focus-ring-*`**，不直接读 `--dsw-static-*`，也不在 JS 里判断深浅色。
- 要改的地方（token 名按 owner 复审更正，以下均已在上游 `design-platform.css` 核实行号）：
  - 蓝底按钮和头像上的文字：**用 `--dsw-alias-label-primary-foreground`**（浅色 `design-platform.css:220` = `#fff`，深色 `:338` = `#0f1115`），它和 `button-primary-fill` 是配套的一对。
    - **不要用 `--dsw-alias-label-primary-inverted`**：它存在（`:221` / `:339`），但语义不对——深色取到 `neutral-bluish-800`（`#353638` 一类深灰），压在 `#7aaaff` 蓝底上就是深灰字，对比度不够。
  - `#23a55a`（在线点）→ `var(--dsw-alias-state-success-primary)`；离线用 `--dsw-alias-state-idle-primary`；工作中可以用 `--dsw-alias-state-business-primary`
  - 头像 `PALETTE`：改成基于 token 的少量色（business/success/warn/error 加上 `bg-layer-2`），或者用 hash 取 `hsl()` 但亮度依赖 CSS 变量（比如自定义 `--collab-avatar-l`，深浅色各定义一次）。优先选前一种。
  - **弹窗遮罩**（`ChannelsPage.module.css:515` 的 `rgb(0 0 0 / .45)`）也要换：用 `var(--dsw-alias-bg-mask-1)`（浅色 `:174` = `rgba(0,0,0,0.24)`，深色 `:292` = `rgba(0,0,0,0.5)`）。这是原来漏算的第 4 处硬编码。**不要**用 `--dsw-alias-overlay-backdrop`，上游没有这个变量。
  - `box-shadow` 的回退值 `rgb(0 0 0 / .24)` 可以删掉：**`--dsw-elevation-panel` 已核实存在**（主题里就是 stroke 加两层阴影）。
- 验收：设置里切换"浅色 / 深色 / 跟随系统"三种模式，频道页没有任何不跟着变的颜色；在 CSS 里 grep 不到 `#[0-9a-f]`，也 grep 不到 `rgb(`/`rgba(` 的字面色值（回退值除外）。
- 截图口径：截图必须是**跑起来的 DSH 里**截的。用脚本按写死的颜色渲染出来的静态模拟图不能当验收证据，只能自己看样式，且必须在 PR 里标明是模拟图。

## 6. 文件布局

```
dsh/packages/client-ui-discord/src/client/
  index.ts                 挂载（不变）
  channel-source.ts        数据层（PR3 改造）
  mention-complete.ts      （不变）
  locales.ts
  components/
    ChannelsPage.tsx  RoomList.tsx  RoomView.tsx  RoomHeader.tsx
    MessageList.tsx  MessageRow.tsx  ProgressCard.tsx  SystemNotice.tsx
    Composer.tsx  MentionPopover.tsx  MemberPanel.tsx  MemberDialog.tsx
    StatusBanner.tsx  StopButton.tsx  Avatar.tsx
    *.module.css
  theme.ts                 头像色映射（只用 token 名）
tests/ 与组件一一对应
dsh/collab/                后端（#20 已加 stop/continue；审批入口单独一期）
```

## 7. 停止和继续（原 PR4 / #8）

「停止」不能只写「发个信号、thinking 清空」。两条硬事实：

- `dsh-member.mjs:224` 的 `finally` **无条件** `setThinking(false)`，所以**界面状态清空根本不能证明任务停了**。
- `cloudweb.mjs:12` 的 `CAPABILITIES` 只有 `text / reconstruct_reply / typing / preview / update_message / delete_message`，没有 stop；外部 bot 的停止帧会被 `default` 吞掉。

因此拆成两半，并按**三种结果**呈现：

### 7.1 8a：DSH 成员（有实现）

- 服务端调 `agent.cancel({ kind: 'user' }, { keepInbox: true })`（`dsh-member.mjs:286`）。只撤回本频道这一轮，Web UI 里排队的输入不动。
- 接口按成员逐个返回 `{ member, outcome }`，`outcome` 只取三态之一：
  - `confirmed`：已确认终止——这一轮确实退出了。
  - `requested`：已请求停止——发出取消但 5 秒内没确认退出，照实说「已请求，未确认」。
  - `unsupported`：不支持终止——只能屏蔽旧输出，不能说成已停止。
- 频道里的系统提示也按这三态分开写，不能只贴一句「已停止。」
- **只有外部 bot 在干活时**（没有 DSH 任务），停止也必须贴一条「不支持终止，只屏蔽旧输出」，不能什么都不贴。

### 7.2 8b：cloud_web 停止协议（本期不做）

- 要做真停止，得先给 `CAPABILITIES` 加 capability，再定停止帧，并让 cc-connect 侧认这个帧。这是一个跨仓库协议改动。
- **本期明确不做**。现在只能按 epoch 屏蔽旧输出，结果一律报 `unsupported`。PR 正文要写清「8b 未做」。

### 7.3 被中断的轮次怎么显示

- 保留半截正文，并在后面贴 `（这一轮没有正常结束：aborted：user）`（`collab.test.mjs` 已有断言）。
- **丢掉半截正文属于擅自改需求**：owner 把「半截正文 + 未正常结束标记」写成现有行为并要求进验收，所以要改的是验收说明，不是行为。

### 7.4 「继续」到底继续什么

- 只把**因接力上限被挡下的那一条**重新派发一次；重复点继续不能再派（服务端按任务状态幂等，不是靠 `client_key`——`client_key` 只能挡消息重复，挡不住重复起 turn）。
- **停止时被取消的任务不恢复**：继续不等于撤回停止。
- 暂停期间进来的新消息只进历史，不自动派；要重新 @。
- 停止还在收尾时点继续，返回 409，不要静默排队。

## 8. 手机端（原漏掉的一项）

- 现状：`ChannelsPage.module.css:375` 在 ≤900px 把 `.rooms` 和 `.members` 都 `display: none`，没有 hamburger、抽屉或切换器。**手机上根本切不了频道**，而「不在电脑前用手机遥控」是最明确的场景。
- 方案（≤900px）：
  - 顶栏加一个「频道」按钮，打开左侧抽屉放 `RoomList`；选中频道后抽屉自动收起。
  - 成员栏改成从右侧抽屉打开，`@` 成员仍然走 Composer 的 `MentionPopover`。
  - 进度卡和停止按钮在窄屏必须可触达（按钮 ≤ 44px 高度，不靠 hover）。
  - StatusBanner 固定在顶部，不占抽屉。
- 验收：375×667 视口下能切频道、能 @ 成员、能看到任务卡状态、能点停止；页面没有横向滚动；抽屉打开时背景可点关闭。
- 优先级：owner 定为最高优先，排在组件拆分之前。

## 9. 等批准的任务（permission 转发到频道）

现在「等批准」的任务在频道里是**看不见的**：页面只渲染卡片 `title`/`state`，collab 侧只做了 `permissionPresets.set`。这一节只给方案，**不写代码**。

### 9.1 上游接口（已核实）

- 应用侧发起：`ctx.approval.request(req)`（`interaction/user-approval/src/index.ts:215`），要求在一个打开的 turn 内。
- 应答侧：`ctx.on('approval/request', (request, next) => …)` 的 waterfall 监听器，返回一个结果或调 `next()` 放行给下一个 answerer。先例：ACP 桥 `acp/src/index.ts:159`，它只发一次性选项，**从不从陌生客户端的回答推断长期授权**。
- 请求体字段：`agent`、`toolName`、`callId?`、`reason?`、`displayReason?`、`signal?`。
- 结果词汇是封闭四值：`allowed-once` / `rejected` / `cancelled` / `unavailable`。**没有 answerer 或 answerer 抛错一律 `unavailable`（fail closed）**，这条要利用而不是绕开。
- 审计：`approval/asked` 与 `approval/decided` 是持久 session 事件，由服务自己写，频道只是入口。

### 9.2 方案

1. **归属**：`request.agent.session.id` → 找到这个会话当前绑定的 job → 得到 `room_id`。找不到（不是本频道触发的会话，比如用户在 DSH Web UI 里自己聊出来的）就 `next()` 放行，不接管。
2. **展示**：往该频道插一条系统卡片（`toolName`、`reason`、成员名、过期时间），SSE 加一个事件 `{type:'approval', approval:{id, member, tool, reason, expires_at}}`；成员状态标成「等批准」。卡片上两个按钮：**允许一次** / **拒绝**。
3. **决定**：新增 `POST /collab/api/approvals/{id}`，body `{decision:'allow-once'|'reject'}`，只接受 owner 身份；**一次性**，重复提交返回 409；过期或 `request.signal` 中止就返回 `cancelled`/`unavailable`。
4. **闭环**：决定到达后卡片改成结果；请求结束（含超时）后卡片置为终态，不留在「等批准」。

### 9.3 边界与风险

- **绝不默认允许**：没人看、超时、渠道异常，一律 `unavailable`，让工具调用失败而不是挂住或放行。
- 默认超时 10 分钟，可配；超时前 1 分钟在频道里提醒一次。
- 只接**一次性允许**，不做「一直允许」；持久授权继续走 DSH 自己的 permission preset。
- **不把审批转发到外部平台**（Discord / 飞书）。外部 bot 没有 approval capability，一律 `unsupported`。
- 分期：单独一个 PR，排在组件拆分和手机端之后，因为要复用 §3 的卡片组件。

## 10. 分步 PR 和验收标准

（步骤按 owner 复核后的优先级重排：手机可用和消息可靠性在前，组件拆分在后。）

1. **PR1 主题收口**（#5）：去掉 4 处硬编码和 PALETTE，加一个「CSS 里不允许出现十六进制颜色」的 lint 测试。
   验收：深浅色和跟随系统三种模式在真实 DSH 里截图正常；测试通过。**脚本渲染的模拟图不算验收证据。**
2. **PR2 页面测试接进 CI**（#6 前置）：把 `channels-page.client.spec.tsx` 加进 `dsh/vitest.config.mjs` 的 include，补 jsdom 与 @testing-library 依赖，让 CI 真的跑页面测试。
   验收：CI 里能看到页面测试执行；本地 `npx vitest run` 文件数和用例数都包含页面 spec。
3. **PR3 数据层**（#7）：按频道缓存、退避重连、**整窗对账**、乐观发送（`client_key`）、向上翻页（`before`，按房间加闩）、StatusBanner 显示重连中。
   验收：假服务端按 `before`/`after`/`limit` 真实返回；断线重连后不丢不重；**离线期间被改的卡片显示新内容、被删的卡片消失，翻页翻上来的更早卡片同样对得上**；切频道时翻页结果不串房间。
4. **PR4 手机端**：§8 的抽屉和切换器。
   验收：375×667 下能切频道、@ 成员、看任务卡、点停止，无横向滚动。
5. **PR5 停止和继续**（#8）：§7 的 8a 与三态呈现、继续的幂等。「8b 未做」写进 PR 正文。
   验收：三个状态各有测试和对应文案；只有 cloud_web 在跑时也贴提示；中断轮次保留半截正文并带 `aborted：user` 标记；重复点继续不会重复派发。
6. **PR6 组件拆分**（#6）：按 §3 拆分，不改行为。优先级最低，别排在手机可用和消息可靠性前面。
   验收：拆分前后页面测试全过、行为一致。
7. **PR7（可选，#9）**：卡片对齐 DSH 样式、点成员跳 Session、§9 的审批入口。

## 11. 未查清 / 待确认

- DSH 是否有面板级 URL 路由（深链）：没查到。现在只能靠 layout service 的 `activePanelId`，频道深链要在插件内部用 `location.hash` 记 roomId（待定）。
- ~~DSH Session 的取消 API~~：**已核实**，`agent.cancel({ kind: 'user' }, { keepInbox: true })`，见 §7.1。
- ~~`--dsw-elevation-panel` 是否存在~~：**已核实存在**，见 §5。
- `ChannelsPage.tsx` 内部细节（滚动、草稿）只粗看了函数列表，没有逐行审读。
- cloud_web 被停过之后，不带最新 `reply_ctx` 的帧会被丢弃（含定时任务这类主动消息），要等频道来了新消息才恢复——这属于 #20 的 8b 风险，本设计只管入口。
