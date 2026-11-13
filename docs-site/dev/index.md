# 给开发者

这一页给想改代码、接新平台、或者想知道程序内部怎么分工的人。只想用的话，回[新手教程](../guide/choose)。

## 程序里怎么分块

| 目录 | 做什么 |
|---|---|
| `bridge/core/` | 主流程：频道会话、消息队列、管理面板接口、安装向导、每轮给 AI 带上的上下文 |
| `bridge/agent/` | 每种 AI 工具（Claude Code、Codex、Gemini CLI、DSH 等）怎么启动、怎么收发、怎么接着上次的对话 |
| `bridge/platform/` | 每个聊天软件（Discord、QQ、飞书、DSH 等）怎么认人、收发消息、发卡片 |
| `bridge/contrib/gate/` | 可选：判断一句没点名的话该谁回，以及从记忆里找相关的页 |
| `integrations/`、`skills/` | 和各个 AI 工具的集成，以及给 AI 的工作约定 |

聊天软件那层和 AI 工具那层互不依赖，都通过 `core` 里的接口连起来。所以加一个新的聊天软件，不用改 AI 工具那边。

## 详细文档（在仓库里）

- [软件架构](https://github.com/zuiho-kai/bothouse/blob/main/docs/ARCHITECTURE.md)：会话和进程怎么管、消息怎么流、团队与记忆的细节。
- 各平台接入细节：[Discord](https://github.com/zuiho-kai/bothouse/blob/main/docs/platforms/discord.md)、[QQ](https://github.com/zuiho-kai/bothouse/blob/main/docs/platforms/qq.md)、[飞书](https://github.com/zuiho-kai/bothouse/blob/main/docs/platforms/feishu.md)、[DSH](https://github.com/zuiho-kai/bothouse/blob/main/docs/platforms/dsh.md)。
- [记忆配置](https://github.com/zuiho-kai/bothouse/blob/main/docs/ccm-and-wiki.md)、[一个模型组团队](https://github.com/zuiho-kai/bothouse/blob/main/docs/single-cli-team.md)。
- [怎么提交改动](https://github.com/zuiho-kai/bothouse/blob/main/CONTRIBUTING.md)。

## 这份文档站

源文件在仓库的 `docs-site/` 目录，用 VitePress 生成。改动走 PR 合进 `develop` 后，GitHub Actions 会自动发布到这里。本地预览：

```sh
cd docs-site
npm ci
npm run dev
```

## 新手实测记录

新手教程每一章都在干净环境里从头走过，下面是走的时候发现、教程替它圆不了的界面问题，欢迎认领：

- 安装页面第一页的卡片写着「一主多 sub、gate」，新手看不懂。
- QQ 页面标题写「QQ 官方机器人」，实际用的是 NapCat 登录普通 QQ 号。
- Discord「谁能指挥」默认是 `*`，服务器里任何人都能让机器人在本机跑命令。
- 保存配置后列出一长串勾选清单，新手找不到「重启生效」按钮。
- DSH 里用 Codex 当队长派活时，会出现一条红色的 curl 报错（Codex 默认不让命令联网），但活其实已经派出去了。
- 派完活两个队员会来回客气几轮，任务板上多记几件。
- 安装中途刷新安装页面，前面填的内容会被清空。
