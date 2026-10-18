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
和网页发的一样会打断正在说的角色。角色发言用 `roles.toml` 的 `voice`（macOS `say` 音色）合成，播到哪见下一节。

```sh
uv run python -m rh.host                       # 语音开
uv run python -m rh.host --no-voice            # 纯文字
FFMPEG=~/.local/bin/ffmpeg uv run python -m rh.host --feed-audio topic.aiff   # 先把一段音频当麦克风输入喂一次（自测）
```

## 设备与回执

每个角色的声音从“该角色的设备”出来；设备只负责播，claude 和发言锁都留在主机。现在的设备是网页里的虚拟头：
网页右上角点“开声音”（浏览器要求点一下才允许出声），这个网页就成了三个角色的设备。

```
 主机 rh.host：轮到橘 → say -o 合成（一句一块）──start/audio──▶ hub ──▶ 网页里橘的头播放
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

## 测试与验收工具

```sh
uv run python -m unittest discover -s tests -v       # 发言锁、打断、上限、审查修复回归（秒级，假 claude，不调真模型）
uv run python tools/check_overlap.py logs/speech-*.jsonl   # 检查日志里没有两段“在说”重叠
uv run playwright install chromium && uv run python tools/screenshot_hub.py [--no-send]   # 从网页发话题、数“在说”的消息（最多一条）、截图
uv run python tools/screenshot_hub.py --sound   # 同上，并让网页当设备出声，记录播放事件和回执（audio-log.json）
```
