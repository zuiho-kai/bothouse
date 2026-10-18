# 外接语音终端协议（Issue #42）

更新：2026-10-18。状态：**协议与模拟终端已实现并有回归测试；实体板未到货，板上未验证。**

本协议定义一台 ESP32 类终端与电脑上的设备入口之间的最小闭环：录音上传、一轮对话、分块播放、播放回执、停止与断线恢复。设备只负责采集、播放和显示状态；语音识别、伙伴原会话、模型回答与语音合成仍由电脑承担（[DESKTOP_DEVICES.md](DESKTOP_DEVICES.md)）。

模拟终端在 `companion/voice/device_terminal.py`，回归测试在 `companion/tests/test_voice_device_protocol.py`。测试让模拟终端走真实设备入口（`create_device_app`），不是另写一套服务。

## 1. 传输与拓扑

- 设备 ↔ 电脑：Wi-Fi 局域网，HTTP/1.1，长连接（keep-alive）。首版不用 WebSocket：轮询足以表达思考/播放状态，且断线重连语义更简单。
- 轮次状态轮询间隔建议 300–500 ms；块下载与轮询可以并发。
- 电脑侧入口：`python -m voice.device_server --config … --roles … --devices …`，只监听 `127.0.0.1`，见 [DESKTOP_DEVICES.md](DESKTOP_DEVICES.md)。

**当前限制**：入口只接受 `127.0.0.1`/`localhost`（TrustedHost），token 是进程级页面凭据，不是设备凭据。实体板要走 Wi-Fi，必须先做 §3.4 的凭据改造；本轮不声称已可跨机接入。

## 2. 一条消息的边界

每次用户按下说话到回答播完，是一次**轮次（turn）**：

1. 设备录音，得到 16 kHz 单声道 16 bit WAV。
2. 设备上传录音，电脑返回识别文字。
3. 设备用同一个 `turn_id` 提交这一轮，得到受理回执。
4. 设备轮询状态，直到 `ready`（或 `error`/`stopped`）。
5. 设备按 `index` 顺序取块、播放，并回报 `playing` / `completed`。
6. 播完或停止后，设备回到待机，才允许下一次录音。

服务端从受理起一直持有这台设备的房间，直到收到播放完成/停止/失败回执；**合成结束不等于播完**。

## 3. 身份

### 3.1 四个标识

| 名称 | 来源 | 生命周期 | 用途 |
|---|---|---|---|
| `device_id` | 设备配置文件 `devices.json` | 出厂烧录，不可改 | 路径里的设备身份；决定绑定哪位伙伴 |
| `secret` | `devices.json` 的 `secret`，烧进固件 | 长期，换设备才换 | 跨机接入的**唯一**凭据；每台不同，32–128 位 |
| `client_id` | 设备首次启动生成 UUID | **存 NVS，重连复用** | 这一轮的播放归属；换掉它等于换页面，会失去续播权 |
| `token` | 本机页面从 `/api/config` 取 | 进程级，重启会变 | **只给本机页面**用；远端设备拿不到 |

`device_id` 只允许 1–64 位字母、数字、下划线、短横线；未知设备返回 404，不会自动发现或猜测伙伴。一台设备固定绑定一位伙伴（`project`）和该实例的 `session_key`；设备不能指定别的伙伴，绑定变化会被拒绝而不是悄悄改绑。

### 3.2 请求头

```
X-Device-Client: <client_id>          # 必填，UUID
X-Device-Secret: <secret>             # 跨机设备必填；每台设备自己的
X-Voice-Token:   <token>              # 仅本机页面，非 GET 时用
Origin:          <仅浏览器需要>        # 设备可不带；带了就必须是本机来源
```

### 3.3 首次连接

`GET /device/{device_id}/api/config`

返回 `device_name`、`default_role`（固定伙伴）、`max_record_seconds`（30）、`asr_model_ready`、`active_turn`、`auth`。

- 本机页面：`auth: "page-token"`，同时返回 `token`。
- 跨机设备：`auth: "device-secret"`，`token` 恒为空字符串——**入口不会把页面令牌发给远端**。

设备保存 `default_role` 并显示伙伴名字；凭据本身来自烧录，不靠这个接口下发。

### 3.4 跨机接入

**已实现（服务端，PR #63）：监听地址与每设备凭据。**

- `device_server --host <地址>` 显式指定监听地址，默认仍是 `127.0.0.1`。
- 非本机地址启动时，`devices.json` 里每台设备都必须有 `secret`，缺一台就拒绝启动；不会退回页面令牌。
- 远端请求按 `X-Device-Secret` 认证，且只能访问自己 `device_id` 下的 API；拿别人的 secret、未知设备一律 403。
- 页面、`/api/devices`、`/static` 只对本机开放；远端一律 403。
- `0.0.0.0` 无法固定 Host 头，此时唯一门槛是设备凭据；能写具体网卡地址就写具体地址。
- 配置与用法见 [DESKTOP_DEVICES.md](DESKTOP_DEVICES.md) 的“局域网设备接入”，样例见 `companion/examples/device-bindings-lan.example.json`。

**仍未实现：**

- **传输加密**：局域网明文 HTTP 只适合封闭测试网；正式演示至少要走 HTTPS 或受控 AP。等板子联网方式定了再做。
- **失联确认**：服务端不按超时猜测设备已静音。设备断电后占位会一直保留，需要人工确认或重启入口；是否加入租约见 §9.4。

## 4. 录音格式

| 项 | 值 |
|---|---|
| 容器 | RIFF/WAVE，经典 PCM（`fmt ` 块 16 或 18 字节，不能是 extensible） |
| 采样率 | **16000 Hz** |
| 声道 | **1（单声道）** |
| 位深 | **16 bit 小端** |
| 最长 | 30 秒 |
| 最大 | 1,000,000 字节（30 秒恰好 960,000 字节） |
| 上传 | `POST /device/{id}/api/transcribe`，`Content-Type: audio/wav`，请求体就是 WAV 原始字节 |

板载 ES7210 采双麦克风，固件需在本地下混为单声道 16 kHz 再上传；不要上传双声道或 48 kHz，服务端会以 422 拒绝并说明原因。首版不做回声消除与全双工，按住说话期间暂停播放。

识别成功返回 `{"text": "…", "elapsed_ms": 1234}`；静音、过短、格式不符返回 422；上一轮仍在处理或播放返回 409（见 §8）。

## 5. 提交一轮

`POST /device/{id}/api/turn`，`Content-Type: application/json`：

```json
{"id": "cba6bc07-1f2a-4ba6-9984-00b530c6a20e", "project": "gge", "text": "今天测试设备接口"}
```

- `id` 是设备生成的 UUID v4，**在发送前落盘**；同一 `id` 重发是幂等的：内容相同返回原轮次，内容不同返回 409，绝不会变成第二次投递。
- `project` 必须等于该设备的固定伙伴，否则 400。
- 文本不能为空、不能以 `/` 或 `!` 开头（管理命令不走设备）。
- 成功返回 202 与轮次快照（`status: thinking`）。忙时 409，**不排队、不自动重试**。

设备侧规则：一轮没有结束（没有 `ready` + 完成回执，或没有 `stopped`/`error`）之前，不再提交新的一轮。

**新问题必须用新的 `turn_id`。** 同一个 id 只用于“结果不明时重发同一句话”（设备侧是 `retry()`，不是 `ask()`），服务端对同 id 不同文本返回 409（`同一请求编号不能用于不同内容`）。设备要在播放完成或停止后丢弃旧 id；把上一轮的 id 顺延给下一句，是踩过 409 的常见原因。

## 6. 轮询与分块

`GET /device/{id}/api/turn/{turn_id}` 返回快照：

```json
{
  "id": "cba6bc07-…", "status": "ready",
  "text": "回答正文", "spoken_text": "实际朗读的正文",
  "audio_chunks": [
    {"index": 0, "audio_url": "/device/desk-gge/api/turn/…/audio/chunks/0?client=…", "duration_seconds": 0.1},
    {"index": 1, "audio_url": "/device/desk-gge/api/turn/…/audio/chunks/1?client=…", "duration_seconds": 0.1}
  ],
  "audio_complete": true,
  "playback_allowed": true
}
```

- `status`：`thinking`（已受理）→ `synthesizing`（回答已到，正在合成）→ `ready`（可播放）；失败为 `error`，被停止为 `stopped`。
- `audio_chunks` 在合成过程中**增量出现**，`index` 从 0 连续递增；`audio_complete` 只在整段合成结束后为 true。
- 每块是**独立可解码的 24 kHz 单声道 16 bit WAV**，设备可以逐块喂给 ES8311，不需要拼接。
- 块没生成好时取块返回 404，设备应退避重试，不能跳块、不能用后面的块顶替。
- `playback_allowed` 为 false 时不要播放：可能已停止、已播完、或这一轮属于别的页面。
- 快照是这台设备的视图，`audio_url` 已带 `client` 参数；换 `client_id` 取不到旧音频。

## 7. 播放回执

`POST /device/{id}/api/turn/{turn_id}/playback`：

```json
{"state": "playing",   "position_seconds": 0.0, "duration_seconds": 0.2}
{"state": "completed", "position_seconds": 0.2, "duration_seconds": 0.2}
{"state": "stopped",   "position_seconds": 0.1, "duration_seconds": 0.2}
{"state": "failed",    "position_seconds": 0.1, "duration_seconds": 0.2}
```

- `playing`：**第一块真正开始出声后**才发，不能一拿到音频就发。
- **每播完一块再发一次 `playing`**，`position_seconds` 是**本轮累计**已播时长，不是本次续播的时长。这条进度回执就是断点续播的依据：设备断电重启后本地内存已经没了，只能靠服务端记下的位置恢复。
- 续播时同样如此：只播第 1 块，但 `completed` 的 `position_seconds` 必须是 `0.2`（含第 0 块的 0.1 秒），否则服务端会以“没有覆盖完整音频”拒绝。回归 `test_completion_receipt_counts_the_chunk_played_before_reconnect`。
- `completed`：只有全部块播完才发。服务端会用整段音频的时长核对 `position_seconds` 与 `duration_seconds`（容差 `min(0.25s, 1%)`），不匹配返回 409，且**不记为完整播放**。
- 没有取过音频就发 `playing`/`completed` 会被拒绝；没有 `playing` 直接发 `completed` 也会被拒绝。
- `duration_seconds` 用各块 `duration_seconds` 之和，设备不需要自己解码 WAV 头。
- 重复或乱序的回执不会让已完成的轮次重新开始。

## 8. 停止与忙

- 设备侧停止：先本地停声，再 `POST …/stop`；返回 `playback_allowed: false`，之后取音频一律 409。
- 已经送达电脑的请求仍会收尾；占位保留到收尾完成，这段时间内新的录音/提交返回 409。设备应显示“等待上一轮收尾”，而不是把它当失败重试。
- **停止回执不等于释放。** 设备收到停止回执后，必须等轮次快照里的 `device_released` 变成 `true`，再确认入口全局空闲（`GET /api/config` 的 `active_turn` 为 null 且 `roles[].available` 为 true），才放开麦克风。两个条件缺一不可：`device_released` 只说明**这一轮**释放了，占位是跨设备共享的。
- 模拟终端用 `wait_for_release()` 做这件事：先轮询轮次快照的 `device_released`，再查 `config`。回归 `test_stop_drain_blocks_recording_until_release` 覆盖收尾窗口（期间 `device_released` 为 false、`/transcribe` 409，收尾后同一设备正常完成第二轮）；`test_release_is_per_turn_but_the_room_is_shared` 覆盖“自己那轮已释放、但另一台还占着”的情况。
- **占位是跨设备共享的**：G哥那台在收尾时，Cursor 那台也会被挡住。这是当前实现，是否按发言权分设备释放由 #33 决定，本协议不假设可以并行。
- 停止后马上再说一句会拿到 409（`请等当前轮次结束后再录音`）。这是显式拒绝，不是丢消息；设备要给出可理解的提示并允许稍后重试。
- **停止时不要清 `turn_id`**：收尾期间还要用它查 `device_released`。确认释放且入口空闲后再清；清掉之后新问题才生成新编号。**投递结果不明时也必须保留原编号**，重发走 `retry()`，否则会变成第二次投递。
- **收尾期间不要调 `ask()`**：设备应先在本地拒绝（状态是 `draining`/`waiting`/`playing` 时不发请求），否则会先换掉编号再被服务端 409，旧编号丢失，`wait_for_release()` 就查不到那一轮了。
- 回归：`test_stop_keeps_turn_id_until_release_then_new_question_gets_new_id`、`test_uncertain_delivery_keeps_the_turn_id_for_retry`、`test_ask_during_draining_is_refused_locally_and_keeps_the_turn_id`。

## 9. 断线与重连

### 9.1 设备重连步骤

1. 保持 `device_id`、`client_id`、`turn_id` 不变（都在 NVS 里）。
2. 重新 `GET /api/config` 取新 token（入口重启后 token 会变）。
3. 用 `config` 的 `active_turn`/`available` 确认入口是否还占着；占着就先显示“后台收尾中”，不要抢录。
4. `GET /api/turn/{turn_id}` 取回快照。
5. 用快照的 `playback.position_seconds` 与各块 `duration_seconds` 算出**已播完的块数**，从下一块继续；`playback_allowed` 为 false（已播完或已停止）时一律不重播。
6. 播放完再发 `completed`。

游标的两个来源，规则是**宁可重播一块，也不跳过一块**：

- **服务端的进度回执**是权威：它证明音频真的交给过输出。
- **设备 flash（NVS）** 保存 `device_id`、`client_id`、`turn_id`、已播块数与是否已播完；重启后连 id 一起恢复，不用外部再喂。模拟终端用 `state_path` + `save_state()`/`load_state()`，文件 0600、原子替换。
- 两边对不上时取**较小值**：回执可能没发出去，flash 也可能正好在掉电时没写完，而跳过音频比重复一块更糟。取到的值还必须落在本轮块数之内，否则回 0。
- 已播完或已停止的轮次记为 `finished`，重启后拒绝重播。

回归：`test_reboot_restores_turn_and_cursor_from_flash`（只给 device id 和 flash 文件，续播只取 `[1]`）、`test_cursor_never_skips_ahead_of_the_server`、`test_state_from_another_device_is_never_adopted`、`test_a_finished_turn_is_never_replayed_after_a_reboot`、`test_stale_cursor_on_a_running_turn_falls_back_to_the_recorded_position`。

### 9.2 不重复提交

重发同一个 `turn_id` 只会拿回原轮次，不会再调一次 `/input`。测试断言：整轮从录音到播完，桥接只收到 1 次 `/input`；断线重连并重发同一 `turn_id` 后仍然是 1 次。

### 9.3 什么情况下不能恢复

- 入口进程重启：内存里的轮次与音频消失，取状态返回 404/410。设备显示“本轮已结束，请重新说”，**不重发**。
- 音频已回收（播完且服务端清理）：410，文字仍在共享记录里。
- 原会话在回答前发生变化：轮次 `error`，不播放，也不冒充续接。

### 9.4 服务端不做的事

- 不按超时判断设备已停止：没有可信回执时宁可占位，也不猜“应该播完了”。
- 不为断线设备保留音频跨进程重启。
- 首版没有心跳租约；设备失联后的占位释放靠人工确认或重启入口。若后续加入，必须是显式租约而不是静默超时。

## 10. 状态与圆屏显示

| 设备状态 | 触发 | 圆屏建议 |
|---|---|---|
| `offline` | 连不上入口 / 重连失败 | 断开图标，不显示“在听” |
| `listening` | 待机、播完、确认释放后 | 睁眼、轻微呼吸动作 |
| `waiting` | 已提交，等回答或等合成 | 思考动画；超过 5 秒加“还在想”文案 |
| `playing` | 第一块真正出声 | 说话口型/动画，与音频同步开始和结束 |
| `draining` | 收到停止回执，但后台仍在收尾 | “后台收尾中”，麦克风保持禁用；只有 `wait_for_release()` 成功才回 `listening` |

状态只能由事件驱动（录音开始、202 回执、`ready`、首块出声、每块进度回执、完成回执、停止回执、释放确认、断线），**不能用计时器模拟**。停止回执只把设备推进到 `draining`，不是 `listening`。

`waiting`、`playing`、`draining` 期间设备本地拒绝新问题，不改写 `turn_id`：它是查询释放和幂等重发的唯一依据。提交请求发出前先把 `unconfirmed` 与编号一起写入 flash；响应丢失或掉电后（重启也一样）只能查询或 `retry()` 原轮，不能另开新轮。服务端明确拒绝（4xx）表示未投递，清除 `unconfirmed`，可以直接问下一句。

## 11. 错误码

| HTTP | 场景 | 设备动作 |
|---|---|---|
| 400 | 缺 client id、内容为空、指定了别的伙伴 | 修正后重试；不改身份 |
| 404 | 未知设备、轮次不属于这台设备、块未生成 | 块 404 退避重试；设备 404 停机检查配置 |
| 409 | 忙、重复编号内容不同、无播放权、完成回执不完整 | 显示原因；忙则稍后重试；其余不重试 |
| 410 | 音频已回收 | 提示重新说，不重发 |
| 413 | 录音或请求体过大 | 缩短录音 |
| 422 | WAV 格式不符、静音、识别失败 | 提示靠近麦克风重录 |
| 503 | 演示已达 200 轮 | 空闲时重启入口 |

## 12. 板级参数（Waveshare ESP32-S3-Touch-AMOLED-1.75）

| 项 | 取值 | 依据 | 状态 |
|---|---|---|---|
| 收音 | ES7210，双麦，I2S，16 kHz/16 bit，下混单声道 | 官方硬件参考 | 待板上验证 |
| 播放 | ES8311 + NS4150B，I2S，24 kHz/16 bit 单声道 | 分块音频即此格式 | 待板上验证 |
| 缓冲 | 录音 30 秒 ≈ 960 KB，放 PSRAM；播放按块双缓冲 | 8 MB PSRAM | 待实测 |
| 网络 | 2.4 GHz Wi-Fi，HTTP keep-alive，轮询 300–500 ms | 本协议 | 待实测 |
| 首声 | 录音结束 → 上传 → 识别 → 回答 → 首块播放 | 电脑侧已有耗时字段 `timings` | 待实测 |

固件不在本轮范围：驱动、I2S 时钟、功放使能、PSRAM 带宽和实际首声延迟都要板子到了再测，不能把模拟测试当作板上结论。

## 13. 怎么跑

离线回归（不需要板子、模型或网络）：

```sh
cd companion
uv run python -m pytest -q tests/test_voice_device_protocol.py
```

对已运行的本机入口做一次真实流程（会真的走识别、原会话和合成）：

```sh
cd companion
# 本机入口
uv run --group dev python -m voice.device_terminal \
  --base http://127.0.0.1:8796 --device desk-gge --wav /path/to/16k-mono.wav

# 局域网入口（入口需以 --host 启动，并给这台设备配了 secret）
uv run --group dev python -m voice.device_terminal \
  --base http://192.168.1.50:8796 --device desk-gge-01 \
  --secret "$DEVICE_SECRET" --wav /path/to/16k-mono.wav
```

消息样例与 schema 在 `companion/examples/device-protocol/`，离线校验：`uv run python examples/device-protocol/validate.py`。
