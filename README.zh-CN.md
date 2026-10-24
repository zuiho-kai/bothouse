# bothouse

[English](README.md) | 中文

bothouse 把你已经在用的 AI 命令行接进 Discord、飞书、自建频道和 DSH。你只要对主角色说话，它负责派活、收结果、维护团队记忆。Claude Code、Codex、Gemini、DeepSeek 都能当角色。

## 用起来是什么样

<img src="docs/assets/demo-chat.zh.png" alt="Discord 频道里：你 @opus 派活，opus @鲸鱼娘 和 @笔杆 分工，鲸鱼娘干活时你插一句，做完各自 @ 回 opus，opus 收尾并提议记一条规则" width="760">

opus、鲸鱼娘、笔杆可以分别是 Claude Code、DSH、Codex。换成你喜欢的名字和人设就行。

## 快速上手

### 核心安装

从 [Releases](https://github.com/zuiho-kai/bothouse/releases) 下载 macOS 的 `bothouse-mac.dmg`（Apple 芯片和 Intel 通用，把 Bothouse.app 拖进 Applications 后双击）或 Windows 的 `bothouse-windows.exe`（x64 和 ARM64 Windows 均可运行，下载后双击），首次启动会在浏览器打开安装向导。macOS 暂未签名，首次打开请「右键→打开」。Linux 下载 `bothouse-linux-x64` 或 `bothouse-linux-arm64`，`chmod +x` 后运行；校验见 `SHA256SUMS`。也可运行下面的命令，装固定版本和校验方式见[从零用起](docs/GETTING_STARTED.md)第 1 节。

```sh
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/zuiho-kai/bothouse/main/install.sh | sh && bothouse
```

```powershell
# Windows（PowerShell）
irm https://raw.githubusercontent.com/zuiho-kai/bothouse/main/install.ps1 | iex; bothouse
```

默认装最新发布版（含预发布）。安装器会用 SHA256SUMS 校验；要固定版本就设 CONEST_VERSION=<tag>。

装好后的命令叫 `bothouse`。不用装 Go 或 Node。

**开始前准备：** 一个 Discord 服务器（或飞书企业），加上至少一个本机已登录的 AI 命令行工具（Claude Code / Codex / Gemini CLI 任一）。机器人怎么建，向导会一步步带你。

1. **装**：运行上面那一行命令。
2. **配**：运行 `bothouse`，浏览器里会打开向导：选平台 → 接机器人 → 每个角色选本机 CLI → 人设 → 保存。
   也可以对你的 Claude Code / Codex 说「帮我把 bothouse 配好接上 Discord」，它会一次问齐要的东西。
3. **用**：保存后点「重启生效」，去频道里 @ 一个角色说句话。

想让 AI 自己判断一句话该谁回（这个组件叫 gate，可以理解成调度员），或者想要团队记忆，再装两个配套组件，见[装调度员和团队记忆](docs/ccm-and-wiki.md)。
完整步骤见[从零用起 bothouse](docs/GETTING_STARTED.md)。

### DSH 频道（实验）

DSH 首次配置：向导第 1 步选 **DSH**，接着只需「检测 dsh → 安装插件 → 运行返回命令打开 DSH 网页」。机器人、CLI、人设和模型随后在 DSH 页面配置；向导选中文时写入 DSH 默认中文。安装包已自带所需的 DSH 文件，装好就能用；开发时或要覆盖时用 `BOTHOUSE_DSH_DIR` 指定。命令行等价操作：`bothouse setup dsh install --lang zh`。

需要已有的 DSH（`>= 0.2.1-rc.2`）和 `pnpm`；`pnpm` 不在 PATH 里时，插件命令会以 exit 127 失败。插件包要求 Node `>= 22.12.0`。

这个频道插件也可以直接从 GitHub 装：

```sh
dsh plugin --profile web add 'github:zuiho-kai/bothouse#dsh-plugin&path:dsh/plugin-pkg'
```

## 平台支持

| 平台 | 现状 | 现在能做什么 |
| --- | --- | --- |
| Discord | 完整 | 多角色团队全部功能：点名、派活交差、队友状态、日志频道 |
| 自建平台 | 团队模式 | 自带一个类 Discord 的网页频道，可以在本机启动；多角色点名、派活交差 |
| 飞书 | 单角色 | 先接一个角色对话 |
| DSH 网页 | 实验 | DSH 网页里的「频道」页，见 [DSH 频道入口](dsh/collab/README.md) |

接进 Discord 和飞书，手机、电脑、网页就都有了，不用我们再做一个 App。
接进 DSH，我们的护栏和小工具直接走 DSH 自己的插件机制装，不另造一套。

AI 这一侧：本机已登录的 Claude Code、Codex、Gemini CLI、OpenCode 等直接用；DSH 这类智能体通过标准协议（ACP）接入。
也可以给 CLI 挂第三方 API（硅基流动、OpenRouter、DeepSeek、MiniMax、本机模型、任意 OpenAI 兼容接口），
对应关系见[接入文档](docs/connect-discord-feishu.md#4-第三方-api--本机-cli)。

## 为什么做这个

今天和 AI 干活是这样的：开一个窗口，说一遍背景，干一件事，关掉。再开一个窗口，再说一遍背景。
想同时用两个 AI，就两个窗口来回切。想在手机上看一眼进度，没门。

我们想要的是一支团队该有的东西：

- 每个人有固定的名字和活儿，不用每次重新介绍自己。
- 你说一句，该谁回谁回，不会七嘴八舌。
- 每件活有人负责，出事有人告诉你。
- 大家记同一本账，今天学到的明天还在。
- 在哪都能找到他们：电脑、手机、网页。

这些东西不该锁在某一家的 App 里。所以 bothouse 做成插件：接你已经在用的 AI，进你已经在用的聊天软件。

## 特性

- **子 Agent 状态表。** Codex 和经 ACP 接入的 DSH 可复用独立子进程表；DSH 需安装[原生状态转发层](integrations/dsh-acp-subtasks/README.md)。普通工具调用不算子 Agent。

### 一支团队，不是一群聊天机器人

- **点名才回。** 一个主角色默认接话，其他角色听得到每句话，只有被 @ 或被点名才开口。几个 AI 在一个群里不会抢答。
- **派活、交差。** 主角色 @ 一位队友派活，队友做完的最终答复自动 @ 回主角色，由主角色收尾。
- 队友状态这个开关是可选的：打开后，主角色每次回话前能看到谁在哪个频道忙什么，派活前知道谁有空。
- AI 正在干活时你补一句，这句话会直接加进它正在做的事里，不用等它做完。
- 想换队长，说一句「鲸鱼娘，你当主」「换回 opus」就行，团队立刻换人默认接话。
- 每个频道各记一条对话线，重启之后接着聊；掉线期间的消息，回来后先补给它再回答。

### 调度员 jev：一个小模型决定谁来回话

群里几个 AI 同时在线，一句话该谁回？bothouse 引入一个小模型当调度员，我们叫它 jev。
它只做一道选择题：这句话该 opus 回、鲸鱼娘回，还是谁都不用回。点名的照点名走，没点名的交给 jev 判断。

- **用硅基流动的免费模型就行**，不用开思考，填 Base URL、Key、模型名三个框。
- **也可以用本机部署的小模型**，比如 Qwen 0.6B，不联网也能调度。
- 安装向导里直接填，填完自动测一次能不能用。

### 一份会长大的团队记忆

记忆存在一个 markdown 目录里，你可以直接打开改。全队共用一份主记忆，每个角色另有一本自己的。

- 每页写「现状 / 关键事实 / 决策与踩坑 / 待办」，git 提交记录就是「AI 今天记住了什么」。觉得它记错了，直接改文件。
- **相关页自动递到角色手边，不等它想起来去查。** 你每说一句，先按这句话在 wiki 里检索，把相关页放在消息前面交给角色。
  你在群里聊到哪，角色手上就有哪页，会话中途也一样。
- **不挑模型。** opus 是 Claude、鲸鱼娘是 DSH、笔杆是 Codex，读的是同一份记忆。

记忆层用的是公开的 [llm-wiki](https://github.com/zuiho-kai/llm-wiki)。它只记你和一个助手的对话；bothouse 让几个角色共用一份，Claude、Codex、DSH 的对话都会记进去，你每说一句就递上相关页，每晚还有复盘。

**我们还差的地方，先说清楚：** 没有测评数字，不敢说比谁准；装起来比 ai-memory 这类一个包的工具重，要多装两样东西；检索只有关键词匹配（BM25），换个说法可能找不到。

### 每晚复盘

- **白天，便宜快的模型。** 会话结束、空闲 30 分钟、或者会话过程中遇到问题，就把新内容整理进 wiki。
- **夜里，免费但慢、能细读的模型。** 把白天写的每一批对着原始记录再核一遍：改错、补漏、去重。每周日通读整棵 wiki 做一次体检。
- 每晚最后一步叫「做梦」：只读你白天说过的话，把反复纠正的事整理成规则候选，再写一段「今日反思」。
- 候选里的每条引文，程序逐字对回你的原话，编的进不来。候选要变成规则，得你点头，它不会偷偷改你的规矩。
- 做完梦，主角色在群里接到一轮，第二天早上你一眼能看到团队昨天学到了什么。

### 自带护栏和小工具

- **护栏**：危险命令先拦。AI 说「修好了」却拿不出证据，会被打回去补；说「等会儿再看」却没定闹钟，也会被拦下。Claude Code 和 DSH 用同一份。
- **小工具**：看队友现在在干什么、把一段视频看成文字和截图、免费搜网页。
- 不想要哪个，在群里跟机器人说一句「把检查关了」就行。

## 和别的项目比

| 你可能在看 | 它解决的问题 | bothouse 不同在哪 |
| --- | --- | --- |
| Orca、各类多 agent IDE | 一个人同时盯几个编码任务 | 它是工位，我们是团队。agent 在它那里按任务开、用完关；在我们这里是常驻的同事，住在你的群里，记得昨天的事。你出门用手机在群里说一句就能派活，不用守在电脑前盯 IDE |
| ai-memory、agentmemory、TencentDB Agent Memory | 给 agent 配一个记忆库 | 它们是数据库，我们是 wiki：你能读能改；相关页每句话前自动递到角色手边；每晚有复盘。代价：装得比它们重，也还没有测评数字 |
| llm-wiki | 一个人、一个助手的记忆 | 它是我们的记忆层。bothouse 让几个角色共用一份，Claude、Codex、DSH 的对话都记进去，你每说一句就递上相关页，每晚复盘 |
| Claude Code agent teams、CrewAI、MetaGPT | 一个任务临时拉一队 | 它们每个项目拉一队临时角色，每次从头读背景，token 花在重复理解上。我们的角色常驻，读了知识库就能接任何项目，要专人时开临时子代理，以后还能自己派生长期专人（见路线图）。按设计，背景不用每个项目重付一遍（省多少还没测） |

```
传统 agent team                          bothouse
项目A ─ 临时PM ─ 临时码农 ─ 临时测试      你 ─@─ opus（常驻，有自己的会话和 wiki）
项目B ─ 临时PM ─ 临时码农 ─ 临时测试             ├─ @鲸鱼娘（常驻，DSH）─ 需要时再开子代理
（任务完就散，下次重建上下文）                    └─ @笔杆（常驻，Codex）
                                         项目 A/B/C 都在这几个人手里流转
```

## 路线图

今天能用的是第一步：一个群，几个 AI，一份共享记忆。往后想做的：

- **不会抢活。** 多个项目同时跑时，角色先认领再动手，两个人不会撞在同一件事上。
- **角色自己长出角色。** 比如你提了一句「要上架 App Store」，opus 自己派生一个「上架专员」，读完你的历史决策就开工，上架完就退场。不用你一个个建。
- 招角色像招人：角色包把人设、记忆模板、工具打在一起，一键进群。
- 角色库以后会长出插件和市场：包里能带代码插件，还有一个在线市场，逛一逛就能装别人做的人设和头像。
- 团队记忆可以带走：换电脑、换模型，团队还是那支团队，记得的事一件不少。
- 常驻角色不用每个任务重读项目，省下重复的背景。等我们有对比数据再公布数字。
- 团队功能会铺到更多平台：DSH 网页频道，然后是 Telegram、Slack、QQ、企微（单角色接入已随 bothouse 带着）。
- 记忆会更聪明：关键词检索之外加语义检索，让换个说法也找得到。

这些都还没做。想跟进就 watch 这个仓库。

## 怎么工作的

```
Discord / 飞书 / 自建网页频道
        │
   平台适配器 ──► 引擎（频道会话、队列、交差）──► 角色适配器 ──► 本机 CLI 或 ACP 智能体
        ▲                   │        ▲
        │                   ▼        │
        │          调度员 gate（谁来回）◄──┤
        │                   │        │
        └───── 回话 ◄───────┘   共享 wiki（每句检索，夜间复盘）
```

模块职责和数据流见[架构](docs/ARCHITECTURE.md)。

## 文档

| 文档 | 内容 |
| --- | --- |
| [从零用起](docs/GETTING_STARTED.md) | 安装、向导、确认上线 |
| [接进 Discord 或飞书](docs/connect-discord-feishu.md) | 向导每一步、让 AI 帮你配、第三方 API |
| [装调度员和团队记忆](docs/ccm-and-wiki.md) | gate（谁来回话）和共享 wiki 记忆 |
| [角色库：人设、头像和包](docs/persona-packs.md) | 挑人设和头像、自己做、装别人的包 |
| [每角色 wiki 与夜间反思](bridge/contrib/wiki/README.md) | 每个角色一本 wiki、定时整理、复盘 |
| [护栏与小工具](bridge/contrib/hooks/README.md) | hook 规则、开关方法、[小工具](bridge/contrib/tools/README.md) |
| [自建平台协议](bridge/docs/cloud-web.md) | 自建平台和插件之间的接口（英文） |
| [架构](docs/ARCHITECTURE.md) | 模块职责和数据流 |

参与开发先读 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [AGENTS.md](AGENTS.md)。

## 许可

bothouse 按 [Apache-2.0](LICENSE) 授权，详见[许可说明](LICENSING.md)。

随附桥接组件的上游 MIT 声明保留在 [bridge/LICENSE-MIT-upstream](bridge/LICENSE-MIT-upstream)，感谢原作者和贡献者。第三方依赖许可见 [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md)。

- DSH 频道路线图：发图片、回复引用。
