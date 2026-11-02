# 在 QQ 里用 bothouse

一个 QQ 号登录到 [NapCat](https://github.com/NapNeko/NapCatQQ)，就是一个机器人。bothouse 通过 NapCat 的 WebSocket（OneBot 11）收发消息，在 QQ 群或私聊里和你对话。

```
QQ ←→ NapCat ←WebSocket→ bothouse ←→ 本机 CLI（Claude Code / Codex / …）
```

要准备：

- 一个给机器人用的 QQ 号（建议用小号）。
- 这台电脑上的 NapCat，已登录这个 QQ 号。
- 本机一个已登录的 CLI（`claude`、`codex`、`gemini`……）。

不需要 Discord、Node 或 pnpm。

## 1. 装 bothouse

见[首页第 1 步](../GETTING_STARTED.md#1-装)。

## 2. 启动 NapCat，开一个 WebSocket 服务器

按 [NapCat 文档](https://napneko.github.io/) 安装（Windows / macOS / Linux 都有一键包，也可以用 Docker）：

```sh
docker run -d --name napcat -e ACCOUNT=<机器人QQ号> -p 3001:3001 -p 6099:6099 mlikiowa/napcat-docker:latest
docker logs -f napcat   # 日志里有二维码，用手机 QQ 扫码登录
```

打开 NapCat 网页（默认 `http://127.0.0.1:6099`）→「网络配置」→ 新建「WebSocket 服务器」：

- 端口 `3001`（默认），启用。
- token：可以设一个（推荐），也可以留空。

## 3. 向导

运行 `bothouse`，浏览器会打开向导。第一页「你想在哪儿用」选 **QQ**，然后：

1. 填 NapCat WebSocket 地址（默认 `ws://127.0.0.1:3001`）、token（没设就空着）、**你自己的 QQ 号**（只有这些号能指挥机器人；多个用逗号隔开；填 `*` 表示所有人都能指挥，不推荐）。
2. 点「测试连接」。连上了会显示机器人的 QQ 号和昵称，才能点下一步。
3. 选本机 CLI → 人设（可跳过）→ 保存 →「重启生效」。

QQ 这一轮只接一个 QQ 号。gate、jev 是进阶功能，QQ 向导里不出现，见[首页「进阶，可不装」](../GETTING_STARTED.md#进阶可不装)。

不用浏览器（让 AI 帮你配）时，同一份请求走 `bothouse setup apply`：

```json
{"platform": "qq", "qq": {"ws_url": "ws://127.0.0.1:3001", "token": "<NapCat token>", "allow_from": "<你的QQ号>"}, "roles": [{}]}
```

存成权限 600 的文件，先 `bothouse setup apply --json <文件> --dry-run`（只测试连接，不写文件），输出里 `ok: true` 再去掉 `--dry-run` 跑。连不上时 `qq.code` 是 `unreachable`（NapCat 没起或地址不对）或 `unauthorized`（token 不对），`qq.fix` 写着怎么改。

## 4. 确认上线

日志里出现 `qq: connected to OneBot` 和 `qq: logged in` 就是上线了。在 QQ 里私聊机器人，或在群里 @ 它说一句试试。

想关掉终端也一直在线：`bothouse daemon install`（见[首页第 3 步](../GETTING_STARTED.md#3-确认上线)）。

## 以后

- 再加 Discord、飞书等：管理面板「添加平台」，见[首页](../GETTING_STARTED.md#以后添加或停用平台)。
- 暂时不用 QQ：`bothouse module disable qq`，配置留着；`bothouse module add qq` 恢复。
- 更多 QQ 选项（文件发送用的 `http_url`、群里共享会话等）：[bridge/docs/qq.md](../../bridge/docs/qq.md)。
