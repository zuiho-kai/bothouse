# 别人怎么让程序看到会议里的摄像头和屏幕共享（#1824 调研，2026-11-20）

## Discord

| 项目 | 怎么拿到画面 | 用的账号/客户端 | 现在能不能用 |
| --- | --- | --- | --- |
| [idoldange/discord-ext-voice-video-recv](https://github.com/idoldange/discord-ext-voice-video-recv) | 语音握手里声明支持视频（IDENTIFY `video:true`、SELECT_PROTOCOL 带 H264/VP8、发一个只收不发的 op 12），服务器就把别人的摄像头 RTP 发过来；按 op 12 认人，拼帧、DAVE 解密、PyAV 解码成图 | **机器人账号**（discord.py + voice-recv 分支） | 2026-10-12 还在更新；README 写明「Go Live 屏幕共享不发给机器人，只有摄像头」。本次把这套做法移植进我们的 node 收音进程，实测见交回 |
| [Discord-RE/Discord-video-stream](https://github.com/Discord-RE/Discord-video-stream)（原 dank074） | 只**发**：以真人账号开 Go Live 或摄像头推视频（H264/H265，带 DAVE） | 真人账号 selfbot（@lng2004/discord.js-selfbot-v13） | 2026-11-14 还在更新；README 警告用真人账号自动化可能被永久封号。可作实测时「开摄像头/共享」的一方 |
| [0x0a09942d/discord-stream-recorder](https://github.com/0x0a09942d/discord-stream-recorder) | 录 Go Live：机器人收指令，真人小号去看直播并录下来 | 机器人账号 + 一个**备用真人账号** | 2022-02 后没更新，DAVE 端到端加密（2026 起语音强制）之前的写法，估计已不能用（没实测） |
| [giorgi-o/DiscordVideoProtocol](https://github.com/giorgi-o/DiscordVideoProtocol) | 逆向记录：Go Live 走主网关 op 18 STREAM_CREATE / STREAM_SERVER_UPDATE，连一条单独的「直播语音服务器」，视频 RTP 负载类型 101=H264、102=RTX | 真人账号 + 官方客户端抓包 | 2022 年的文档，协议细节仍是社区参照 |
| [discord.js-selfbot-v13 issue #293](https://github.com/aiko-chan-ai/discord.js-selfbot-v13/issues/293) | 讨论 selfbot 收发 Go Live；指向 MainSilent/Discord-Screenshare（浏览器方式），2022 年已坏 | 真人账号 | 只有讨论，没现成能用的收流代码 |
| [Discord Userdoccers：Voice Connections](https://docs.discord.food/topics/voice-connections) | 社区文档：op 12 VIDEO 告诉你每个人的视频 SSRC，连上时对已开视频的人各发一次 | — | 非官方，但和上面第一项实现一致 |

结论：摄像头用机器人账号就能收（第一项的做法）；屏幕共享（Go Live）机器人收不到，别人都是用真人账号去「看直播」。

## Discord 之外（参照）

| 项目 | 怎么拿到画面 | 账号/客户端 | 现状 |
| --- | --- | --- | --- |
| [Recall.ai](https://www.recall.ai/blog/how-to-build-a-zoom-bot-a-guide-for-developers) | Zoom 用 Meeting SDK 的 raw data 拿每人 I420 视频帧；Meet/Teams 用无头浏览器入会录屏 | 商业 API，机器人以「参会者」身份入会 | 在卖 |
| [attendee-labs/attendee](https://github.com/attendee-labs/attendee) | 开源会议机器人 API：Zoom 走 SDK 原始音视频，Meet/Teams 走浏览器机器人 | 机器人参会者账号 | 2026-11-20 还在更新 |
| [Vexa-ai/vexa](https://github.com/Vexa-ai/vexa) | 开源：自动入会机器人（浏览器）做 Meet/Teams/Zoom 转写 | 浏览器参会者 | 2026-11-13 还在更新，偏转写 |
| Zoom RTMS / Google Meet Media API | 官方实时媒体接口，不用机器人入会就能拿音视频（Recall 博客提到 RTMS 2025-06 全面开放，Meet Media API 仍是开发者预览） | 官方应用授权 | 官方路线，Discord 没有对应接口 |
