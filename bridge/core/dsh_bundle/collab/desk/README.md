# Team Desk (`/collab/desk`)

**English** ｜ [中文](#团队工作台)

An office-map view of the team. Every member sits at a fixed desk; a beam flies from the
dispatcher to the member who takes the work, and flies back when the work is handed in.
Seats show who is working, thinking, idle or offline, and any past time window can be
replayed. The page is one self-contained HTML file — no build step, no external assets.

- **Live by default.** A dispatch in a channel becomes a beam within seconds.
- **Replay.** Pick a time window and watch the same events again, faster.
- **Read-only.** It never writes to the board, never posts messages, never changes config.

## Open it

| URL | What you get |
| --- | --- |
| `/collab/desk` | Live desk |
| `/collab/desk?from=<ISO>&to=<ISO>` | That window loaded as replay, paused |
| `/collab/desk?fixture=1` | Built-in demo data, labelled "sample data, not real events" |
| `/collab/desk?fixture=1&autoplay=1` | The same demo, playing automatically |

The desk lives on the same host as the DSH web app and needs a signed-in browser session:
without one the server answers `401` with a one-line hint — open the DSH web app on that
host in the same browser first, then come back. There is no separate app or build; the same
URL works on a phone. `autoplay` only applies to the demo data — a replay opened with
`from`/`to` waits for you to press play.

## Live mode

The page opens an SSE stream on `/collab/api/events` and draws what arrives:

| Event | Drawn as |
| --- | --- |
| `task` (`created`, `assigned`, `returned`, `rejected`, `paused`, `done`) | Beam dispatcher → worker on dispatch; beam worker → dispatcher on hand-in; red flash on reject; state bubble on pause/done |
| `thinking` | The member's seat turns blue with a typing keyboard; the bubble shows the short task title |
| `message` | A thin beam between the author and every member mentioned in the text; the text itself is never drawn |
| `members` | Seat list and online state (offline seats grey out) |
| `lead` | Which seat is the lead |

So that nothing is drawn twice or backwards:

- `created` with an assignee and the following `assigned` are one dispatch: the first
  draws, the second is skipped.
- `returned` always flies worker → dispatcher (the event's `to` carries the worker).
- No events means a quiet office — the page never invents activity.

## Replay mode

Switch to **Replay** in the header, choose a start and end time, press Load, then Play. The
bar offers recent presets, 1×/4×/16× speed, and a progress bar that seeks by event count
(dragging rebuilds the scene from the start of the window).

- The endpoint merges board events and room messages for the window by time and returns
  **at most 200 events**; ask for a narrower window if you need more.
- Bad timestamps, or an end earlier than the start, return `400` with a message.
- Opening `?from=&to=` jumps straight into replay but leaves it paused.

## Where the data comes from

Three upstream sources; the page itself only reads two endpoints (`/collab/api/events` and
`/collab/api/desk/replay`).

1. **Board event log.** The gate's board command appends one JSON line per task change to
   `board-events.jsonl`, next to `board.jsonl` in the board directory (`BOARD_DIR` or the
   plugin's `boardDir`). The plugin tails the file once a second and forwards new lines as
   `task` events. It starts at the end of the file: changes written before the plugin
   started are replay material, not live beams.
2. **Hub events.** Member list, online state, per-room "thinking", room messages and the
   lead come from the collaboration hub — real sessions and channel traffic.
3. **Busy/idle files.** The bridge writes a small JSON per member (busy or not, in which
   chat, on what) into the configured team-status directory, refreshed every couple of
   seconds. The gate reads them to decide who is online before routing a dispatch. The desk
   does not read these files directly; it shows the resulting state through the hub's
   online and thinking events.

## Privacy boundary

- Only inter-role traffic is drawn: dispatcher → worker, worker → dispatcher, and @-mention
  pairs. Nothing else.
- No model accounts, provider names, API keys, token counts or per-member usage appear on
  the page.
- Message events are used only to compute mention pairs. Message text is never rendered or
  stored by the page.
- The shipped roster is plain data (project key, display name, avatar, aliases). Do not put
  secrets or private paths in it — it ships inside the page.

## On a phone

- The page sets `viewport-fit=cover` and reflows at 1180 / 900 / 760 / 420 px: seats stack,
  the replay bar wraps, the event log moves below the map.
- Prerequisite: the phone must reach the same DSH host (same LAN, or your usual VPN) and you
  must sign in there once in that phone's browser.
- No separate mobile entry point — open the same `/collab/desk` URL.

## Member avatars (roster)

`dsh/collab/desk/roster.json` maps each member to a display name and an avatar. The page
ships an inlined copy (the plugin serves only `index.html`) and a test keeps the two
identical — edit both.

| Field | Meaning |
| --- | --- |
| `project` | The stable key used by `task` events' `from`/`to` |
| `name` | What the seat shows; do not rely on the agent's own display name |
| `role` | `lead` or `sub` (the lead is still taken from the live hub state) |
| `avatar` | A slug from `dsh/collab/avatars/`, or `""` for the initial badge |
| `deployed` | `false` keeps the member off the map (no seat, no light) |
| `aliases` | Case-insensitive names used to resolve `who` text and @-mentions |

- Avatars come from the five shipped portraits in `dsh/collab/avatars/`. An empty avatar
  never borrows someone else's portrait: the seat shows the member's initial in a coloured
  circle.
- Uploaded avatars (`upload:<id>.png`) and full `http(s)` URLs, when present, win over the
  roster slug.
- To add a member: add a roster entry, mirror it into the inline copy, and make sure the hub
  knows the member — only members present in the live state get a seat.

## Look at it without a DSH host

```sh
node dsh/collab/desk/preview.mjs --port 8791
```

Then open `http://127.0.0.1:8791/collab/desk` (the preview server stubs state, events and
replay from sample data) or `http://127.0.0.1:8791/collab/desk?fixture=1` (the page's own
demo data, no server data needed).

## Tests

```sh
node --test dsh/collab/desk/desk.test.mjs
```

Covers the inline/data sync, member and avatar rules, beam direction, dispatch de-duping,
runtime lead, page self-containment and the preview server. The end-to-end driver test
(`node --test dsh/collab/desk-e2e.test.mjs`) needs a real DSH runtime and skips cleanly when
the environment lacks one.

## Limits

- Replay returns at most 200 merged events per request.
- Live tails start at the end of the log; use replay for anything earlier.
- Offline/idle is derived from hub events; with no hub events the desk stays quiet rather
  than guessing.

## 团队工作台

[English](#team-desk-collabdesk) ｜ **中文**

团队的一张办公室地图：每位成员有固定工位，派活时一道光从派活人飞向接活人，交回时再飞回去。工位显示谁在干活、谁在思考、谁在摸鱼、谁离线，也可以回放任意一段过去的时间。整个页面就是一个自包含的 HTML 文件，不用构建、不依赖外部资源。

- **默认实时。** 频道里派一次活，几秒内就会亮起一道光。
- **可回放。** 选一段时间窗，把同样的事件再快放一遍。
- **只读。** 不写任务板、不发消息、不改配置。

### 怎么打开

| 地址 | 看到什么 |
| --- | --- |
| `/collab/desk` | 实时工作台 |
| `/collab/desk?from=<ISO>&to=<ISO>` | 该时段载入为回放，暂停状态 |
| `/collab/desk?fixture=1` | 页面自带的演示数据，带「示例数据 · 非真实事件」角标 |
| `/collab/desk?fixture=1&autoplay=1` | 同一份演示数据，自动播放 |

页面和 DSH 网页在同一台主机上，需要同一个浏览器里已登录的会话：没登录时服务端返回 `401` 并附一句提示——先在同一个浏览器打开该主机的 DSH 网页，再回到这个地址。没有单独的手机应用或构建产物，同一个地址在手机上也能开。`autoplay` 只对演示数据有效；用 `from`/`to` 打开的回放会停在暂停状态，等你按播放。

### 实时模式

页面连上 `/collab/api/events` 的 SSE 流，收到什么画什么：

| 事件 | 画成什么 |
| --- | --- |
| `task`（`created`、`assigned`、`returned`、`rejected`、`paused`、`done`） | 派活：派活人 → 干活人一道光；交回：干活人 → 派活人一道光；打回闪红；暂停/完成弹状态 |
| `thinking` | 该成员的工位变蓝、键盘闪动，气泡里是任务短标题 |
| `message` | 作者与正文里被 @ 的每位成员之间一条细光；正文本身不画 |
| `members` | 刷新工位与在线状态（离线工位变灰） |
| `lead` | 哪个工位是主角色 |

为了不重复、不画反：

- 带接活人的 `created` 与随后的 `assigned` 是同一次派活：先到的画，后到的不再画。
- `returned` 一律是干活人 → 派活人（事件里的 `to` 是干活人）。
- 没有事件就是一间安静的办公室——页面不会凭空造活动。

### 回放模式

在页头切到**回放**，选起止时间，按「载入」，再按播放。回放条提供最近的几个预设、1×/4×/16× 速度和一根进度条；进度条按事件条数定位，拖动会从时间窗起点重建场景。

- 回放接口把该时段的板事件与房间消息按时间合并，单次**最多返回 200 条**；要看得更细就把时间窗收窄。
- 时间格式不对、或结束早于开始，接口返回 `400` 并说明原因。
- 直接打开 `?from=&to=` 会进入回放，但停在暂停状态。

### 数据从哪来

上游有三个来源，页面自己只读两个接口（`/collab/api/events` 与 `/collab/api/desk/replay`）。

1. **任务板事件流。** 闸门的任务板命令把每次任务变化追加成一行 JSON，写进板目录里的 `board-events.jsonl`（与 `board.jsonl` 同目录；板目录由 `BOARD_DIR` 或插件的 `boardDir` 指定）。插件每秒尾随这个文件一次，把新增行作为 `task` 事件转发。它从文件末尾开始读：插件启动前写入的变化属于回放素材，不会在启动瞬间补一屏光柱。
2. **中枢事件。** 成员列表、在线状态、各房间的「思考」、房间消息和主角色，都来自协作中枢——真实会话与频道往来。
3. **忙闲文件。** 桥接每两秒左右给每位成员写一份小 JSON（是否在忙、在哪个会话、在做什么），放在配置的团队状态目录里。闸门读这些文件判断谁在线，再决定把活派给谁。工作台不直接读这些文件，它通过中枢的在线与思考事件看到结果。

### 隐私边界

- 只画角色之间的往来：派活人 → 干活人、干活人 → 派活人，以及被 @ 的成对关系。别的不画。
- 页面上不出现模型账号、供应商名字、接口密钥、token 用量或每位成员的用量。
- 消息事件只用来算 @ 关系，正文既不渲染也不落盘。
- 随页面发布的成员表只是普通数据（项目键、显示名、头像、别名）。不要往里放密钥或本机路径——它会被打进页面里。

### 手机上怎么看

- 页面带 `viewport-fit=cover`，在 1180 / 900 / 760 / 420 px 处重排：工位改成一列，回放条换行，事件流移到地图下方。
- 前提：手机能访问同一台 DSH 主机（同一局域网，或你平时用的 VPN），并且先在那台手机的浏览器里登录一次。
- 没有单独的手机入口，打开同一个 `/collab/desk` 即可。

### 成员与头像对照

`dsh/collab/desk/roster.json` 把每位成员对应到显示名和头像。页面里还内联了一份副本（插件只返回 `index.html`），测试会保证两份完全一致——改的时候两处都要改。

| 字段 | 含义 |
| --- | --- |
| `project` | 稳定键，`task` 事件的 `from`/`to` 用的就是它 |
| `name` | 工位上显示的名字；不要依赖 agent 自己的显示名 |
| `role` | `lead` 或 `sub`（主角色仍以中枢实时状态为准） |
| `avatar` | `dsh/collab/avatars/` 里的文件名，`""` 表示用首字母徽标 |
| `deployed` | `false` 的成员不上图（没有工位、不会亮） |
| `aliases` | 大小写不敏感的别名，用来解析 `who` 文本和 @ 名字 |

- 头像只用 `dsh/collab/avatars/` 里随仓库发布的五张。头像为空时不借用别人的角色图，工位显示该成员名字首字母的圆形徽标。
- 上传头像（`upload:<id>.png`）和完整的 `http(s)` 地址，只要存在就优先于成员表里的文件名。
- 加一位成员：加一条成员表记录、同步到内联副本，并确认中枢认识这位成员——只有在实时状态里出现的成员才会有工位。

### 没有 DSH 主机时本地看

```sh
node dsh/collab/desk/preview.mjs --port 8791
```

然后打开 `http://127.0.0.1:8791/collab/desk`（预览服务器用样例数据顶替状态、事件与回放），或 `http://127.0.0.1:8791/collab/desk?fixture=1`（页面自带的演示数据，不需要服务器数据）。

### 测试

```sh
node --test dsh/collab/desk/desk.test.mjs
```

覆盖：内联数据与磁盘文件一致、成员与头像规则、光柱方向、`created`/`assigned` 去重、运行时主角色、页面自包含、预览服务器。端到端驱动测试（`node --test dsh/collab/desk-e2e.test.mjs`）需要真实的 DSH 运行时，环境不满足时会整条跳过。

### 边界

- 单次回放最多 200 条合并事件。
- 实时只从日志末尾开始；更早的用回放。
- 离线/摸鱼由中枢事件推得；没有中枢事件时页面保持安静，不做猜测。