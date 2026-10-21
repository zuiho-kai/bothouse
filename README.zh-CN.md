# bothouse

[English](README.md) | 中文

**以后每个人都会和好几个 AI 一起干活。bothouse 想第一个把它们变成一支团队：会分工，会交接，记得住事。**

装上这个插件，你的 Claude Code / Codex / Gemini / DSH 就组成一支有性格的团队，接进 Discord、飞书、自建平台（DSH 网页即将支持）。装好在向导里点几下就能用。

![bothouse 15 秒演示：安装向导点几下，频道里点名回话、队长派活、队友交回、共享记忆](docs/launch/media/bothouse-15s.gif)

```sh
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/zuiho-kai/bothouse/main/install.sh | sh && cc-connect
```

```powershell
# Windows（PowerShell）
irm https://raw.githubusercontent.com/zuiho-kai/bothouse/main/install.ps1 | iex; cc-connect
```

第一次运行 `cc-connect` 会在浏览器打开安装向导。不用装 Go 和 Node。

**如果它对你有用，点个 ⭐，让更多人找到它。**

## 为什么做这个

今天的 AI 各管各的：一个窗口一个模型，换个窗口就忘了刚才说过什么，几个 AI 放进同一个群就抢着说话。

我们觉得缺的不是更聪明的模型，是一支团队该有的东西：谁来回话，谁去干活，干完交给谁，大家共用一份记忆。这些东西不该锁在某一家的 App 里。所以 bothouse 做成插件，接你已经在用的 AI，进你已经在用的聊天平台。

我们想第一个把「AI 团队」这件事定义清楚，并且开源。今天能用的是第一步：一个群，几个 AI，一份共享记忆。

## 团队协作

- **点名才回**：一个主角色默认接话；其他角色听得到每句话，只有被 @ 或被点名才开口。一个群里几个 AI 不会一起抢答。
- **主角色派活，做完交回**：主角色 @ 一位队友派活，队友的最终答复自动 @ 回主角色，由主角色收尾。
- **接力有上限**：两个队友互相 @ 超过 3 轮就交给主角色；同一频道没有人插话时，AI 之间接力 20 次自动停。
- **队友状态**（可选）：打开后，主角色每轮开头能看到谁在哪个频道忙什么，派活前知道谁有空。
- **干活时也能插话**：AI 正在干活时你补一句，这句话直接并进它手上这一轮，不用等它做完。

## 记忆

- **共享 wiki 记忆**：每轮回话前，插件按这句话检索一份共用的 wiki（[llm-wiki](https://github.com/zuiho-kai/llm-wiki)），把相关的页推给这个角色；会话结束后，内容自动整理进 wiki。换一个模型的角色，读的也是同一份记忆。
- **会话接续**：一个频道一个会话，重启之后接着上次聊；掉线期间频道里的消息，回来后先补给它再回答。

## 接进哪里

| 平台 | 现在能做什么 |
| --- | --- |
| Discord | 多角色团队全部功能：点名、派活交接、队友状态 |
| 自建平台 | 自带一个类 Discord 的网页频道，可以在本机启动；多角色在频道里点名、派活交接 |
| 飞书 | 先接一个角色对话 |
| DSH 网页 | 即将支持 |

AI 这一侧：本机已登录的 Claude Code、Codex、Gemini CLI、OpenCode 等直接用；DSH 等支持 ACP 的智能体走 ACP 接入。也可以给 CLI 挂第三方 API（硅基流动、OpenRouter、DeepSeek、MiniMax、本机模型、任意 OpenAI 兼容接口），对应关系见[接入文档](docs/connect-discord-feishu.md#4-第三方-api--本机-cli)。

## 三步用起来

1. **装**：运行上面那一行命令。
2. **配**：运行 `cc-connect`，在向导里选平台 → 接机器人 → 每个角色选本机 CLI → 人设 → 保存。也可以对你的 Claude Code / Codex 说「帮我把 cc-connect 配好接上 Discord」，它会一次问齐要的东西，跑 `cc-connect setup apply`。
3. **用**：保存后点「重启生效」，去频道里 @ 一个角色说句话。

想让 AI 自己判断一句话该谁回、想要共享 wiki 记忆，再加 gate 和 wiki，见[配 ccm 和 wiki](docs/ccm-and-wiki.md)。完整步骤见[从零用起 bothouse](docs/GETTING_STARTED.md)。

## 文档

| 文档 | 内容 |
| --- | --- |
| [从零用起](docs/GETTING_STARTED.md) | 安装、向导、确认上线 |
| [接进 Discord 或飞书](docs/connect-discord-feishu.md) | 向导每一步、让 AI 帮你配、第三方 API |
| [配 ccm 和 wiki](docs/ccm-and-wiki.md) | gate（谁来回话）和共享 wiki 记忆 |
| [团队协作细节](bridge/MAOMAO.md) | 一主多 sub、交接规则、gate 协议（英文） |
| [自建平台协议](bridge/docs/cloud-web.md) | 自建平台和插件之间的接口（英文） |
| [架构](docs/ARCHITECTURE.md) | 模块职责和数据流 |
| [开发与历史进展](docs/archive/README-2026-10-21.md) | 开源前的内部进度表和阶段计划（存档） |

参与开发先读 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [AGENTS.md](AGENTS.md)。

## 许可

bothouse 按 [MIT](LICENSE) 授权，详见[许可说明](LICENSING.md)。

bothouse 是接入 [cc-connect](https://github.com/chenhg5/cc-connect)、DSH 等平台的插件。为了一条命令装好，`bridge/` 随附了一份 cc-connect，它的 MIT 声明保留在 [bridge/LICENSE-MIT-upstream](bridge/LICENSE-MIT-upstream)。感谢 cc-connect 的作者和贡献者。第三方依赖的许可见 [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md)。
