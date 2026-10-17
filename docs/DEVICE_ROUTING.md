# 设备身份、伙伴绑定与原会话路由（#43）

本文件描述“一位 AI 一台设备”里**身份与投递**这一层：哪台设备属于哪位伙伴、允许接续哪条原会话、一次请求的回答只能去哪台设备。音频分块、传输格式和状态灯由 #42 的终端协议负责；本层不另造一套音频协议。

当前状态：**离线模块与回归测试完成**（`companion/voice/devices.py`、`companion/tests/test_voice_devices.py`）。尚未接入运行中的语音服务，也没有真实设备验证；mock 通过只算软件阶段。

## 边界

| 属于本层 | 不属于本层 |
| --- | --- |
| 设备编号、名称、外观标识、绑定的伙伴与原会话 | 麦克风/扬声器选型、接线、供电（#42） |
| 一轮请求的设备归属、会话核对、拒绝误投 | 音频编码、块序号、结束信号（#42） |
| 回答的播放目标设备、播放完成回执的判定 | 多人讨论的发言权协调（#33） |
| 断线重连后保持同一身份 | 真实服务的 HTTP/WebSocket 接入（后续阶段） |

## 设备配置

配置是一个只含 `devices` 数组的 JSON 文件，示例见 [companion/examples/device-bindings.json](../companion/examples/device-bindings.json)。字段：

| 字段 | 约束 | 说明 |
| --- | --- | --- |
| `device_id` | 1–64 位字母、数字、`_`、`-` | 设备身份的唯一定义；重复即配置错误 |
| `name` | 1–40 字 | 用户能辨认的名字；不得重复 |
| `project` | 1–64 位，须在伙伴名单中 | 这台设备唯一绑定的伙伴；一位伙伴只能有一台设备 |
| `session_key` | 1–200 位 `A-Za-z0-9:._-` | 要接续的原会话，通常是 Discord 频道键 |
| `appearance` | 最多 80 字，可省略 | 外观标识，用于用户辨认，不参与路由 |

规则是**显式绑定**：没有配置的设备一律拒绝，不按名字猜伙伴、不按“最近用过”自动改绑，也不因为设备重连就新建身份。设备清单在启动时整体校验，未知字段直接报错而不是忽略。

## 一轮请求的流程

1. **设备身份**：按 `device_id` 查绑定；未登记 → `unknown_device`，不联系桥接。
2. **设备可用性**：离线 → `device_offline`；这台设备上一轮仍在处理 → `busy`，不排队。
3. **原会话核对**：调用现有 `/input/bindings`，要求返回的 `project`、`session_key` 与配置一致，且 `session_id`、`agent_session_id` 非空。会话缺失或不能安全恢复 → `session_missing`，**不新建会话替代**。会话 ID 与上一轮核对结果不同 → `session_changed`。
4. **投递**：通过现有 `/input` 发送，并带上 `expected_session_id`、`expected_agent_session_id`，让桥接在锁内再次校验；桥接拒绝即本轮失败，不自动重发。
5. **回执**：只接受 `request_id` 相同、且 `session_id`/`agent_session_id` 与投递时一致的终态回执；否则本轮不播放。
6. **播放归属**：只有发起该轮的那台设备能取到音频与记录播放；其他设备请求 → `wrong_device`。
7. **播放完成**：`completed` 且位置到达结尾（容差 0.25 秒）才记为完整播放；位置不足 → `playback_incomplete`，不冒充完成。已结束的播放不会被迟到的 `playing`/`stopped` 重新打开。

请求编号由设备提供（UUID），本层拼成桥接请求号 `device-<device_id>-<turn_id>`；同一编号重复提交同样内容视为同一轮，重复提交不同内容或来自另一台设备 → `duplicate_turn_conflict`。

## 并发接纳、取消与迟到

- **接纳是串行的**：全局 `turn_id` 去重、设备占用检查、原会话核对和本轮占位在同一把锁内完成，桥接 I/O 不会插进检查与占位之间。因此同一设备的两条不同请求只有一条会被接纳，另一条得到 `busy`；不同设备复用同一 `turn_id` 时，后到者得到 `duplicate_turn_conflict`，不会覆盖前一条记录或抢占设备归属。同一设备用相同 `turn_id` 和相同内容重试仍是幂等的。
- **投递未结束前设备仍被占用**：POST `/input` 返回之前，设备槽位保持占用，避免“已取消但仍在投递”的轮次与下一轮重叠。
- 取消只把本轮标记为 `cancelled` 并禁止播放；已经发出的请求不会撤回，桥接里的任务可能继续。若取消发生在 POST 期间，`completed`/`failed` 回执以及投递异常都不会把本轮改回 `ready` 或 `error`，只记为 `late_reply`（`late_reply_ignored=true`）。
- 取消后轮询到的迟到回执同样只记录、不播放，也不会投给别的设备。
- 重连沿用同一设备身份和同一 `session_key`，只重新核对绑定；重复的同一次连接事件是幂等的（`connection_generation` 不增加）。重连时若原会话缺失或已变化，如实返回 `unavailable` 与原因，不创建替代身份。

## 状态与反馈

每台设备的状态包含 `online`、`state`（`listening` / `waiting` / `playing` / `offline`）、`session.status`（`bound` / `missing` / `changed` / `unknown`）、`current_turn`、`turn_status`、`playback` 和 `last_error`。这样界面或状态灯能直接显示“绑定谁、是否可用、在听/在想/在说/离线”，失败时也有具体原因，而不是笼统的“出错了”。

## 与 #42 终端协议需要对齐的字段

终端协议（#42）负责把这些身份字段放进消息里；本层只依赖下列语义，不复制音频细节：

| 方向 | 字段 | 本层用法 |
| --- | --- | --- |
| 设备 → 电脑 | `device_id` | 唯一路由依据，缺失即拒绝 |
| 设备 → 电脑 | `turn_id` | 一轮请求编号（UUID），用于去重与迟到判定 |
| 设备 → 电脑 | 录音/识别文本 | 送入 `open_turn`；文本本身不参与路由 |
| 电脑 → 设备 | `turn_id`、`device_id`、`audio_target` | 设备必须核对 `audio_target` 等于自己才播放 |
| 电脑 → 设备 | 音频块、块序号、结束信号 | #42 负责；本层只保证“哪一轮、属于哪台设备” |
| 设备 → 电脑 | 播放回执：状态、位置、总时长 | 交给 `record_playback`；状态取 `playing`/`completed`/`stopped`/`failed` |
| 双向 | 状态显示 | 用本层 `device_status` 的 `state` 与 `session.status`，不另定义同义状态 |

错误码（`RoutingError.code`）供终端映射成设备可读提示：`unknown_device`、`device_offline`、`busy`、`session_missing`、`session_changed`、`duplicate_turn_conflict`、`delivery_rejected`、`delivery_unknown`、`receipt_missing`、`reply_mismatch`、`turn_failed`、`empty_reply`、`timeout`、`not_ready`、`wrong_device`、`playback_incomplete`、`not_cancellable`、`invalid_turn`、`invalid_text`、`invalid_playback`。

## 回归覆盖（软件阶段）

`companion/tests/test_voice_devices.py` 用注入的假桥接，不连真实 socket、会话或设备，覆盖：

- 两台设备分别路由到各自伙伴与原会话，`expected_*` 字段正确，音频目标不交叉；
- 未绑定设备、把 A 设备的回答交给 B 设备取音频/记录播放，均被拒绝；
- 原会话缺失时在投递前拒绝；回答前会话变化时本轮不播放并标记 `session_changed`；
- 重复请求幂等、同号异内容/异设备冲突；取消后迟到回执只被记录、不播放；
- 并发接纳：同设备双请求只接受一条、跨设备同号不覆盖；取消期间的 POST 成功回执/异常都不改写终态，且设备槽位会释放；
- 重连保持身份、重复连接幂等、会话缺失时如实报告；
- 离线/忙时不触达桥接；投递失败不自动重试；等待超时报“结果未知”而不是成功；
- 播放未到结尾不算完成，重复或迟到的播放事件不会重开已结束的一轮。

本机运行（Python 3.11）：

```sh
cd companion
uv run python -m pytest -q tests/test_voice_devices.py tests/test_review47_boundaries.py
```

`tests/test_review47_boundaries.py` 是 PR #47 审核发现的两项并发缺陷的固定回归；它复用 `test_voice_devices.py` 的假桥接，不连真实服务。

## 尚未完成 / 待验收

- [ ] 接入运行中的语音服务：本层目前是独立模块，`app.py`/`multi.py` 未改，等 #2 首版与 #45 发布完成后再接，避免与在写文件冲突。
- [ ] 与 #42 的真实传输层联调：把上表字段落到具体消息，并用 #42 的分块样例跑一遍。
- [ ] 真实双设备验收：两台设备各自绑定、互相不串音、断线重连、迟到回复，均需实机记录；当前只有 mock 证据。
- [ ] 状态灯/显示方案随实际硬件确定；本层只提供状态语义。
- [ ] 与 #33 的发言权协调对接：本层只按已验证的绑定投递，不决定谁该说话。
- [ ] 共享记忆沿用 #4 链路；语音正文不自动重复发 Discord，这一点本层未改动。
