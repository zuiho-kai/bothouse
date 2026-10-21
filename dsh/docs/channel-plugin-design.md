# bothouse「频道」原生 DSH 客户端插件 — 实现设计说明

> 调研时间：2026-10-21 23:00 前后（UTC+8）。只读调研，未改代码。
> 基线：bothouse `main`（含 PR #3）；DSH 上游按 [dsh/upstream.pin.json](https://github.com/zuiho-kai/bothouse/blob/main/dsh/upstream.pin.json) 的 `687f282e8625c6b8d11ff58211a90524be2e4317`（0.2.1-rc.2）。
> 记号：`B:` = `https://github.com/zuiho-kai/bothouse/blob/main/`，`D:` = `https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/`

## 0. 结论

- **方案 A 不用从零开始写，大部分已经在 `client-ui-discord` 里了。** 它已经是 React 写的 DSH 原生客户端插件，通过 `ctx.slots` 挂在 `sidebar.panellist`（左栏入口）和 `main`（中间面板）；它走的是 collab 的 `/collab/api/*` 和 SSE `/collab/api/events`，**不复用 `/collab` 页面（page.html）的逻辑**。样式基本用 DSH 的 `--dsw-*` token（86 处 `var(--`），只有 **3 处硬编码颜色和 1 个头像色板**要改。
- 主要差距：
  1. 单文件 `ChannelsPage.tsx`（411 行）要拆成几个组件。
  2. **后端没有"停止"接口**，只有 `maxRelay` 接力上限，到上限后写一条系统消息。
  3. 重连后靠全量 `refresh` 补状态，没有按 `after` 做增量补消息，也没有退避。
  4. 进度卡只渲染 title/state 两个字段。
  5. 头像色和在线绿点不跟随主题。
- 推荐 4 个小 PR：主题收口 → 组件拆分 → 数据层（增量补齐、退避重连、乐观发送）→ 停止和接力控制（前后端一起改）。

## 1. 现状差距

| 项目 | 现状 | 证据 | 差距 |
|---|---|---|---|
| 左栏入口和主面板 | 已有，`sidebar.panellist` 的 order 是 5，`main` 的 key 是 `channels` | [B:dsh/packages/client-ui-discord/src/client/index.ts](https://github.com/zuiho-kai/bothouse/blob/main/dsh/packages/client-ui-discord/src/client/index.ts) | 无 |
| 频道视图 | React 单组件，包含频道列表、消息、输入框、成员栏 | [B:.../ChannelsPage.tsx](https://github.com/zuiho-kai/bothouse/blob/main/dsh/packages/client-ui-discord/src/client/ChannelsPage.tsx) | 需要拆分 |
| 数据层 | 不依赖 React 的 `createChannelSource`，基于 `ObservableSnapshot`；第一个订阅者出现时才开 SSE，最后一个离开就关 | [B:.../channel-source.ts](https://github.com/zuiho-kai/bothouse/blob/main/dsh/packages/client-ui-discord/src/client/channel-source.ts) | 重连只有全量 refresh，没有退避、没有按 `after` 增量补 |
| 复用 /collab 页面 | **不复用**。page.html 是独立的最简页面，跟原生插件只共用后端 API | [B:dsh/collab/page.html](https://github.com/zuiho-kai/bothouse/blob/main/dsh/collab/page.html) | 原生插件稳定后可以把 page.html 降级成调试页 |
| @ 补全 | 已有 `activeMention`、`rankMembers` 等函数，并有测试 | [B:.../mention-complete.ts](https://github.com/zuiho-kai/bothouse/blob/main/dsh/packages/client-ui-discord/src/client/mention-complete.ts) | 弹层的键盘交互要单独做成组件 |
| 成员管理 | MemberDialog 支持增、改、删，能选模型 | [B:.../MemberDialog.tsx](https://github.com/zuiho-kai/bothouse/blob/main/dsh/packages/client-ui-discord/src/client/MemberDialog.tsx) | 无 |
| 工作状态 | 后端发 `thinking` 事件，前端按频道显示 | [B:dsh/collab/hub.mjs](https://github.com/zuiho-kai/bothouse/blob/main/dsh/collab/hub.mjs) | 无 |
| 停止 | **没有**，后端查不到 stop、abort、cancel 接口 | [B:dsh/collab/plugin.mjs](https://github.com/zuiho-kai/bothouse/blob/main/dsh/collab/plugin.mjs) | 需要新增后端接口 |
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
│  ├─ RoomHeader       #名称、工作中成员、StopButton
│  ├─ MessageList      虚拟/分页滚动，向上翻用 before=
│  │  ├─ MessageRow    作者、时间、文本
│  │  ├─ ProgressCard  card JSON 渲染（复用 DSH 风格）
│  │  └─ SystemNotice  接力上限等系统消息 + “继续”按钮
│  └─ Composer         输入框 + MentionPopover（mention-complete.ts）
├─ MemberPanel         分组（人/DSH/外部 bot）、在线/工作中、编辑入口
│  └─ MemberDialog     （已有）
└─ StatusBanner        phase: loading/unavailable/unauthorized/error/重连中
```

- 每个组件配一个自己的 `*.module.css`，只用 token。
- 现有测试 `tests/channels-page.client.spec.tsx` 拆开放到各个组件。

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
  - `onerror` 后进入 `reconnecting` 状态，按 1、2、4、8 秒退避，最长 30 秒，再加随机抖动。
  - `onopen` 后先拉 `/collab/api/state`，再对当前频道用 `after=newestId` 补齐，**不要全量重拉**。
  - 页面隐藏时不强制断开，恢复可见时如果连接已断，立即重连。

## 5. 主题

- token 来源：[D:packages/client/ui-theme/src/styles/design-platform.css](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-theme/src/styles/design-platform.css)，分三层：`--dsw-static-*` 原色、`--dsw-alias-*` 语义、`--dsw-specific-*` 组件。浅色定义在 `body`，深色在 `body[data-ds-dark-theme]`。
- 切换机制：[D:packages/client/ui-theme/src/client/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-theme/src/client/index.ts) 根据设置（light/dark/system，system 跟随 `prefers-color-scheme`）给 `body[data-ds-dark-theme]` 设值；启动时的 [boot-theme.ts](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-theme/src/boot-theme.ts) 负责防止闪屏。
- 约束：插件**只用 `--dsw-alias-*` 和少量 `--dsw-radius-*`、`--dsw-focus-ring-*`**，不直接读 `--dsw-static-*`，也不在 JS 里判断深浅色。
- 要改的地方：
  - `#fff` → `var(--dsw-alias-label-primary-inverted)`
  - `#23a55a`（在线点）→ `var(--dsw-alias-state-success-primary)`；离线用 `--dsw-alias-state-idle-primary`；工作中可以用 `--dsw-alias-state-business-primary`
  - 头像 `PALETTE`：改成基于 token 的少量色（business/success/warn/error 加上 `bg-layer-2`），或者用 hash 取 `hsl()` 但亮度依赖 CSS 变量（比如自定义 `--collab-avatar-l`，深浅色各定义一次）。优先选前一种。
  - `box-shadow` 的回退值 `rgb(0 0 0 / .24)` 可以保留，因为有 `--dsw-elevation-panel` 时不会用到；能确认这个 token 存在的话就去掉回退值。**我没有在 design-platform.css 里核实 `--dsw-elevation-panel` 是否存在。**
- 验收：设置里切换"浅色 / 深色 / 跟随系统"三种模式，频道页没有任何不跟着变的颜色（截图对比）；在 CSS 里 grep 不到 `#[0-9a-f]`。

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
dsh/collab/                后端（PR4 加 stop/continue）
```

## 7. 分步 PR 和验收标准

1. **PR1 主题收口**：去掉 3 处硬编码和 PALETTE，加一个"CSS 里不允许出现十六进制颜色"的 lint 测试。
   验收：深色、浅色、跟随系统三种模式截图都正常；测试通过。
2. **PR2 组件拆分（不改行为）**：按第 3 节拆分 ChannelsPage，测试跟着迁移。
   验收：现有 vitest 全过；页面行为和截图跟改前一致。
3. **PR3 数据层**：按频道缓存消息、`after` 增量补齐、退避重连、乐观发送（`client_key`）、向上翻页（`before`）、StatusBanner 显示重连中。
   验收：在 vitest 里用假的 EventSource 模拟断线，重连后不丢消息也不重复；手动重启 DSH 后页面自动恢复；切换频道后草稿和滚动位置保留。
4. **PR4 停止和接力**：
   - 后端新增 `POST /collab/api/rooms/{id}/stop`：中止该频道里正在跑的 DSH 成员这一轮（需要 dsh-member 里接入 Session 的取消机制，**DSH 的取消 API 还没核实**），对 cloud_web bot 发停止或忽略后续消息；再新增 `POST /collab/api/rooms/{id}/continue`，用来重置接力计数。
   - 前端加 StopButton，显示 SystemNotice 和"继续"按钮。
   验收：@ 一个长任务后点停止，10 秒内 thinking 状态清空；两个 bot 互相 @ 到上限后显示提示，点继续后能接着跑。
5. **PR5（可选）**：ProgressCard 和审批卡对齐 DSH 的 `ui-approval` 和 `ui-chat` 风格；点 DSH 成员时用 `ctx.uiWorkspace.openSession` 跳到它的 Session；评估是否下线 page.html。

## 8. 未查清 / 待确认
- DSH 是否有面板级 URL 路由（深链）：没查到。
- DSH Session 的取消 API 怎么调（PR4 需要）：没核实。
- `--dsw-elevation-panel` 是否在 design-platform.css 中定义：没核实。
- `ChannelsPage.tsx` 内部细节（滚动、草稿）我只粗看了函数列表，没有逐行审读。
