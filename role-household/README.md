# 角色小家（role-household）

频道 + 3 个角色（每个是一份 `claude -p` 会话）轮流讨论 + 全局发言锁 + 网页圆形虚拟头。计划书见 [docs/PLAN.md](docs/PLAN.md)。

只有一套代码：频道服务 `rh.hub` + 角色主机 `rh.host`。hub 可以和主机放在同一台电脑（全本地），也可以放云端服务器。

## 全本地启动（hub 和主机同机，127.0.0.1）

需要 [uv](https://docs.astral.sh/uv/) 和已登录的 Claude Code（`claude` 在 PATH 里）。

```sh
uv sync
export RH_HUB_TOKEN=$(openssl rand -hex 32)            # 本机 hub 的访问 token，自己定
uv run python -m rh.hub &                               # 频道服务，默认 http://127.0.0.1:8790 ，库在 data/hub.sqlite3
RH_HUB_URL=http://127.0.0.1:8790 uv run python -m rh.host   # 角色主机（环境变量优先于 .env）
open "http://127.0.0.1:8790/#token=$RH_HUB_TOKEN"       # 打开网页，在底部输入框发话题
```

角色、模型、每话题轮数上限、“在说”时长估算、头像、音色都在 `roles.toml`。发言日志写在 `logs/`。
主机的已读位置按 hub 地址分文件（`data/host-state-<地址>.json`），本机 hub 和云端 hub 来回切换不会补错话题。

## 云端频道 + 本地角色主机

云端（vps-arm）跑频道服务 `rh.hub`：频道、消息、成员存 SQLite，HTTP 发消息，WebSocket 实时推送（连上时一次给历史），同一服务发网页。
网页是云端的投影；本机跑角色主机 `rh.host`，meeting/brain/发言锁都留在本机（`claude -p` 用自己的订阅，不能放云端），
作为 bot 客户端连云端：收到用户消息开讨论，发言和“在说”状态发回云端；断线自动重连，重连或重启后补上漏掉的话题。

```
 浏览器 ──HTTP 发消息 / WebSocket 收推送──▶ 云端 rh.hub（SQLite）◀──WebSocket 收 / HTTP 发── 本机 rh.host（meeting + claude）
```

```sh
sh deploy/hub/deploy.sh          # 部署到 vps-arm:/opt/role-household-hub；首次生成 token，并写进本机 .env（不进 git）
uv run python -m rh.host         # 本机角色主机，读 .env 里的 RH_HUB_URL / RH_HUB_TOKEN
```

网页：打开 `RH_HUB_URL`，输入 token（或用 `地址#token=...` 打开一次，存在浏览器里）。

- 云端只认一个角色主机：再开一个 `rh.host`，新的连上后旧的自动退出。
- 本机和云端断线时，本机正在进行的讨论直接停掉（网页上显示被打断）；重连后只补断线期间用户发的新话题。
- 云端库被清空后，主机会发现已读位置比云端最新消息还大并自动重置；但如果主机离线期间新库的消息 id 又涨过了旧的已读位置，
  就发现不了（会漏掉或误补话题），这时手动删掉本机 `data/host-state-<地址>.json` 再启动主机。

**安全提醒：现在是明文 HTTP。** token 在请求头和 WebSocket 里明文传输，同一路径上的人（公共 Wi-Fi、运营商）能看到。
拿到 token 的人能读写频道，还能触发本机的 `claude`（耗你的订阅额度）。不要在不可信的网络上打开网页；token 泄露了就删掉服务器上的
`/opt/role-household-hub/hub.env` 重新部署换一个。要长期在外网用，应在前面加一层 HTTPS（比如 Caddy 自动证书）。

## 语音（第二阶段第二步）

`rh.host` 默认开语音：从系统默认输入设备（现在是 USB 耳麦）常开收音，不用按键；按停顿切句，送本机 ai-gateway
（`http://127.0.0.1:8787/v1/audio/transcriptions`，key 读 `~/ai-gateway/state/config.json`）转文字，作为用户消息发进云端频道，
和网页发的一样会打断正在说的角色。角色发言默认用本机 Qwen3-TTS 合成（`roles.toml` 的 `[voice]` 段和每个角色的 `qwen_speaker`/`qwen_instruct`；模型在一个常驻子进程里只加载一次），某句出错就改用该角色的 `voice`（macOS `say` 音色）；把 `[voice] backend` 改成 `"say"` 并重启主机即切回 say。播到哪见下一节。

```sh
uv run python -m rh.host                       # 语音开
uv run python -m rh.host --no-voice            # 纯文字
FFMPEG=~/.local/bin/ffmpeg uv run python -m rh.host --feed-audio topic.aiff   # 先把一段音频当麦克风输入喂一次（自测）
```

## 设备与回执

每个角色的声音从“该角色的设备”出来；设备只负责播，claude 和发言锁都留在主机。现在的设备是网页里的虚拟头：
网页右上角点“开声音”（浏览器要求点一下才允许出声），这个网页就成了三个角色的设备。

```
 主机 rh.host：轮到橘 → Qwen3-TTS 合成（一句一块）──start/audio──▶ hub ──▶ 网页里橘的头播放
                ◀──────────────── 回执 done / stopped / failed ──────── hub ◀──┘
                收到回执才把发言锁交给下一个；用户插话 = 给设备发 stop
```

- 设备事件只有四种：开始说、音频、停止、回执（定义在 `rh/device.py` 顶部）。
- 没有网页开声音时，自动用本机 Mac 喇叭播（行为同以前，播完交棒）。播到一半网页关了，hub 回执 lost，主机马上交棒。
- 同一角色有几个网页都开了声音，只发给最早开的那个；别的网页的回执不算数。
- 回执超时兜底：音频时长加 5 秒还没回执，就给设备发 stop 并交棒，不让一个卡住的网页拖住整场讨论。
- 网页的分块播放器 `rh/static/queue-player.js` 拷自 conest（文件头注明了来源和改动）。

ASR、TTS 各是 `rh/voice.py` 里的一个小接口（`transcribe(wav)`、`speak(text, voice, cancel)`），换实现时频道和发言锁不动。
切句阈值等参数在 `rh/voice.py` 顶部；收音日志行以 `[voice]` 开头（听到什么、丢掉了什么）。

## 小智板子（ESP32 圆屏当角色的躯体）

三块 Spotpear ESP32-S3 圆屏板刷改过的小智固件（固件在 `~/code/role-household-fw`，默认 OTA 地址
`http://zuihomac-studio.local:8791/xiaozhi/ota/`）。主机 `rh.host` 里跑一个小智协议服务（`rh/xiaozhi.py`），板子就是“该角色的设备”，
和网页虚拟头走同一套规则：轮到她、而且是 Mac 那一路本来就会出声的内容才推（被叫到名字后的回应），播完才交棒，板子没连上就用 Mac 喇叭。

```
 板子 ──POST /xiaozhi/ota/──▶ rh.host:8791 回 ws 地址（用板子连进来的那个本机 IP）
 板子 ──WS /xiaozhi/v1/ hello──▶ 回 hello，之后每 30 秒一条保活，别的什么都不推
 轮到橘 → DeviceSpeaker → 橘的板子：tts start、llm 表情、字幕、Opus 16k/60ms 按节奏推、tts stop → 回执 done → 交棒
```

- 起服务：`roles.toml` 里有 `[xiaozhi]` 段（`port = 8791`）且开着语音，`uv run python -m rh.host` 就会一起起来；删掉这一段就不起。
  日志里 `[xiaozhi]` 开头的行是板子的事（OTA、连上、断开、开始播、播完、停下）。
- 绑定板子：先让板子连一次，日志里会有「未绑定的板子 90:70:69:f5:89:e4 连上了」。在 `roles.toml` 加
  ```toml
  [[xiaozhi.boards]]
  device = "90:70:69:f5:89:e4"   # 板子的 Device-Id（MAC）
  role = "ju"                     # 角色 id
  ```
  重启主机生效。一块板子一个角色；同一角色绑两块板子时只用先连上的那块（同一块板子重连会顶掉它自己的旧连接）。没绑定的板子能连上，但什么都不播。
- 不出声的规则：板子连上、重连、开机时主机不推任何问候或提示音；「暂停」让所有板子一起停；闭麦只管不听用户，不改板子播放；
  板子不收音，板子上传的音频直接丢掉，listen 等消息只记日志。
- 可选 token：环境变量（或 `.env`）`RH_XIAOZHI_TOKEN`。设了就随 OTA 发给板子，WebSocket 不带对的拒绝；不设就不查（只在家里局域网用）。
- 编码用 ffmpeg 的 libopus（`FFMPEG` 环境变量 > PATH > `~/.local/bin/ffmpeg`）。
- 不接板子先试：`uv run python tools/fake_xiaozhi.py http://127.0.0.1:8791/xiaozhi/ota/ --device 90:70:69:f5:89:e4`
  假装一块板子，打印主机推来的每条消息和每帧音频的字节数（不出声）。
- 表盘（`rh/dial.py`，固件 `CONFIG_RH_DIAL`）：板子屏幕上画的是和网页表盘页（`/dial`）同一套圆形表盘和动画，
  不是小智默认的表情、字幕、状态栏。板子连上时主机发一条 `{"type":"rh_dial"}` 告诉它是哪个角色（名字、颜色、头像地址），
  之后谁在想、谁在说、被打断也发给该角色的板子（规则同网页）；固件里不写死角色，换绑定只改 `roles.toml`。
  头像用 `avatars/dial/<角色>.jpg`，板子按屏幕边长取 `/xiaozhi/dial/<角色>.rgb565?size=240`（主机用 ffmpeg 缩成 RGB565）。
  日志里 `[dial]` 开头的行是发给板子的表盘状态。
- 固件要配合的一点：原版小智固件 WebSocket 只在要说话时才连（`main/protocols/websocket_protocol.cc` 的 `Start()` 不连），
  主机推不进去。固件要在联网、OTA 完成后主动 `OpenAudioChannel()`，`OnAudioChannelClosed` 后隔几秒重连；
  还要在空闲态收到 `tts start` 时照常进 Speaking（原版就是这样）。

## 形态 B：Discord 里 bot 的回应在板子上念

板子也可以当现有平台（我们的 Discord）里 bot 的躯体（`rh/discord_body.py`）。gate（`~/im-bridge/gate/rhbody.py`）
复用它已收到的消息：主人 @ 某个 bot、开头点名她、或回复她的消息之后，她的下一条回复就是“回应主人的话”，
gate 把正文 POST 到主机 `http://127.0.0.1:8791/rh/discord/say`（只收本机请求）。bot 之间互相说话不转。

```
 主人在 Discord 叫鲸鱼娘 ─▶ gate 记下「在等鲸鱼娘回应」
 下一条消息来时 gate 看到她的上一条回复 ─▶ POST {bot_id, text} ─▶ 主机按 [[discord.bots]] 找角色 ─▶ 她的音色、她的板子
```

- 映射：`roles.toml` 的 `[[discord.bots]]`（`bot_id`、`name`、`role`），别人 team 里的 bot 同样加一条。
- 真板播放开关 `[discord] play`，默认 `false`：只记日志（`[discord]` 开头的行），不出声。用户在场时改成 `true` 并重启主机。
- 只推板子：板子不在线就不念，不走 Mac 喇叭和网页。和小家讨论共用发言锁，不叠音；「暂停」「闭麦」、用户插话都会停下并作废排队的。
- 限制：gate 只在频道里来下一条消息时才看得到 bot 的回复，所以要等主人下一次发话才念；回复长于 600 字时只念结尾那段
  （cc-connect 只给 gate 结尾 600 字）。gate 的转发记录在 `~/im-bridge/logs/gate-rhbody.jsonl`。

## 本地唤醒模型

除了“整句转文字再按拼音比名字”，主机还用一个本地关键词检测小模型（sherpa-onnx KWS，`rh/kws.py`）一直听系统回声消除之后的声音，
找各角色的语音唤醒词（`roles.toml` 里有 `wake` 用 `wake`，否则 name+aliases）、产品名、暂停、闭麦、开麦。词表从 `roles.toml` 生成。

- 两边任一认出即生效。转文字漏了名字、唤醒模型听到了，就只让唤醒模型听到的那位回答。
- 唤醒模型听到「暂停」「闭麦」当场停住正在说的，不等转文字。闭麦期间切出的句子不转文字、不存音频、不进频道，只有唤醒模型听「开麦」。
- 日志：`[kws]` 行是唤醒模型听到的词；`[wake]` 行末尾写「认出：kws / asr / 都有」。每句切出的音频存在 `logs/utter-<启动时间>/<时分秒-毫秒>.wav`（闭麦期间不存），`[voice]` 行里写了文件名。

模型不进 git。下载到 `roles.toml` `[wake] kws_model` 指的目录（默认和 Qwen3-TTS 模型同放 `~/ai-voice/models/`）：

```sh
mkdir -p ~/ai-voice/models && cd ~/ai-voice/models
curl -LO https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20.tar.bz2
tar xjf sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20.tar.bz2 && rm sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20.tar.bz2
```

配了 `kws_model` 但模型缺文件时主机直接报错退出；删掉 `kws_model` 那一行 = 只靠转文字。阈值在 `rh/kws.py` 顶部；
某个词在真人声音上叫不醒时，只给这个词填 `rh/kws.py` 的 `WORD_TUNE`（`{"鲸鱼娘": (score, threshold)}`），别的词不动。

## 测试与验收工具

```sh
uv run python -m unittest discover -s tests -v       # 发言锁、打断、上限、审查修复回归（秒级，假 claude，不调真模型）
uv run python tools/check_overlap.py logs/speech-*.jsonl   # 检查日志里没有两段“在说”重叠
uv run playwright install chromium && uv run python tools/screenshot_hub.py [--no-send]   # 从网页发话题、数“在说”的消息（最多一条）、截图
uv run python tools/screenshot_hub.py --sound   # 同上，并让网页当设备出声，记录播放事件和回执（audio-log.json）
```
