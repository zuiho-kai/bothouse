# 团队工作台（`/collab/desk`）

办公室地图页：固定工位、成员头像、派活/交回的流光、角色状态、实况事件流和历史回放。无构建步骤，CSS/JS 全部内联在 `index.html`。

## 入口

| 入口 | 用途 |
| --- | --- |
| `GET /collab/desk` | 页面本体（B 路 `deskRoute` 内联返回 `index.html`） |
| `GET /collab/api/state` | 初始成员、在线状态、`effective_lead_id` / `lead_id` |
| `GET /collab/api/events` | SSE：`task`、`thinking`、`message`、`members`、`lead` |
| `GET /collab/api/desk/replay?from=&to=` | 该时段的任务事件与房间消息，按时间合并 |

`task` 沿用 Issue #876 的契约：`{ts,id,kind,from,to,title,note}`，`kind` 为 `created|assigned|returned|rejected|paused|done`。`from` 是派活人，`to` 是干活人。

## 事件怎么画

- `assigned`：派活人 → 干活人，光柱落在干活人。
- `created` 带 `to`：同样是一次派活；同一条任务的 `created` 与随后 `assigned` 只画一次（先到的那条画，后到的不重复），不会因为先收到 `created` 就把 `assigned` 吞掉。
- `returned`：光柱从干活人 `to` 飞回派活人 `from`，不是反过来；干活人的任务被清掉。
- `rejected`：派活人 → 干活人，闪红并弹「打回」。
- `paused` / `done`：清任务并弹对应状态。

## 成员与头像

`roster.json` 是成员对照数据，`project` 是事件里的 `from`/`to`，`name` 只用于显示。页面把运行时 state 成员按 **id / project / 显示名 / aliases**（大小写不敏感）归并到同一个人：

- 显示名以 `roster.name` 为准（例如 `deep` 显示「肥鱼」，而不是 agent 的 display_name「DeepSeek」）。
- 头像以 `roster.avatar` 为准；`avatar: ""`（Cursor、Grok）**不借用别人的角色图**，回落名字首字母圆形徽标。
- 上传头像（`upload:<id>.png`）和完整 http(s) URL 优先保留。
- 中枢/lead 不写死：从 `/collab/api/state` 的 `effective_lead_id`（或 `lead_id`）取。
- 只在 state 里出现的成员才建工位；`deployed:false` 的成员不会亮灯。

## 忙闲（团队状态）

`members` 事件和 `/collab/api/state` 的成员可带团队状态字段：`busy`、`busy_since`、`busy_task`、`busy_chat`、`busy_chats`、`busy_count`、`busy_items`。页面只读，不写状态文件。

- 工位状态优先级：**离线 > 忙碌 > 有任务 > 中枢思考 > 摸鱼**。`busy: true` 时淡紫光环、键盘闪动、身体起伏并冒气泡；`busy` 变回 `false` 就回到任务/思考/摸鱼。
- 气泡显示 `busy_chats` 的频道列表；`busy_count` 大于频道数时，多出的无频道会话（如 relay）以 `+N` 表示。悬停标题列出每个频道及其任务。
- 气泡默认朝右；实测右缘会越过舞台时（窄屏 390/500 的最右列）自动改朝左，尾巴贴右，页面不横向溢出。

## 为什么 roster 和 fixture 内联

B 路的 `deskRoute` 只返回 `index.html`，不服务同目录的 `roster.json` / `fixture.sample.jsonl`。页面因此把这两份数据内联进 HTML，装进 `dsh_bundle` 后也能直接用；磁盘上的同名文件保留给人看和本地预览，测试会校验内联副本与文件完全一致，避免漂移。

## 回放

- 「实时 / 回放」切换；回放条有起止时间、近 1 小时/昨晚预设、载入、播放暂停、1×/4×/16× 速度和进度条。
- 进度条按**事件条数**定位，拖动会重建场景；`?from=&to=` 可直接带时间窗进入回放（需手动播放）。
- `?fixture=1` 使用页面自带的 34 条演示事件（21 个任务 + 成员/思考/消息），带「示例数据 · 非真实事件」角标；加 `&autoplay=1` 自动播放。演示成员是 `lead/ayan/ayou/ache/alan`，与真实 roster 隔离。

## 本地看

```sh
node dsh/collab/desk/preview.mjs --port 8791
# http://127.0.0.1:8791/collab/desk            实时事件（预览服务器的假数据）
# http://127.0.0.1:8791/collab/desk?fixture=1  页面自带演示事件
```

## 测试

```sh
node --test dsh/collab/desk/desk.test.mjs
```

覆盖：内联 roster/fixture 与磁盘文件一致、成员/头像规则、busy 忙碌态与频道气泡、忙闲气泡左右边界、returned 方向、created/assigned 去重、成员索引、运行时 lead、页面自包含、预览服务器的 page/state/replay。

## 边界

页面只读：不写 `board-events.jsonl`、不改任务板、不部署、不重启服务。除 `?fixture=1` 的明确演示数据外不造假光柱。
