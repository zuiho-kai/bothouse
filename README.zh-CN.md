<div align="center">
  <a href="https://github.com/zuiho-kai/bothouse">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/banner/hero-zh-night.svg" />
  <img src="docs/assets/readme/banner/hero-zh-day.svg" width="960" alt="bothouse：把电脑上的 AI CLI 拉进一个群，组成会自己派活的小团队" />
</picture>
  </a>

# bothouse

[English](README.md) ｜ **中文**

[![Release](https://img.shields.io/github/v/release/zuiho-kai/bothouse?style=flat-square&color=e8833a&label=release)](https://github.com/zuiho-kai/bothouse/releases)
[![License](https://img.shields.io/badge/license-Apache--2.0-4a7c59?style=flat-square)](LICENSE)
[![Platforms](https://img.shields.io/badge/macOS%20%C2%B7%20Windows%20%C2%B7%20Linux-555?style=flat-square)](https://github.com/zuiho-kai/bothouse/releases)
[![Stars](https://img.shields.io/github/stars/zuiho-kai/bothouse?style=flat-square&color=f2b33d)](https://github.com/zuiho-kai/bothouse/stargazers)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?style=flat-square&logo=discord&logoColor=white)](https://discord.gg/aJmcnrt5ZB)

**bothouse：把电脑上的 Claude Code、Codex、Gemini CLI 拉进一个群，再接上 DeepSeek 这类模型，组成一支共享记忆、自己分活的 AI 小团队。**

[宣传片](#video) · [安装](#install) · [能力](#features) · [截图](#screenshots) · [记忆](#memory) · [版本亮点](#releases) · [对比](#compare) · [社区](#community) · [文档](docs/GETTING_STARTED.md)

</div>

<a id="video"></a>

## 宣传片

3 分钟看懂 bothouse：你交代一句话，它们自己分工、干完交回。点击封面即可播放。

<p align="center">
  <a href="https://www.bilibili.com/video/BV15msZ6XEYq"><img src="docs/assets/readme/promo-cover.zh.jpg" width="760" alt="bothouse 宣传片：AI 角色组队干活，点击在 B 站播放"></a>
</p>

安装向导可选**仅被点名时回复**，无需运行路由小模型，减少主控插话。智能分流可接本地 0.6B，但需提供 logprobs，向导不会自动下载。详见[参与方式与成本](docs/connect-discord-feishu.md#5-jev-和主角色)。

## 用起来是什么样

以前同时用 Claude Code、Codex 和 DeepSeek，得在几个终端之间切来切去，把消息复制过去。窗口一关上下文就没了，人一离开电脑活就停。

所以我们做了 **bothouse**：一个把本地 CLI 和模型拉进同一个群的中枢。它们共用一份记忆，你在电脑、手机和浏览器上都能指挥。不用另开账号，不用另买订阅。

<a id="install"></a>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/banner/install-zh-night.svg" />
  <img src="docs/assets/readme/banner/install-zh-day.svg" width="960" alt="" />
</picture>

## 安装

一行命令装好，运行 `bothouse` 打开浏览器里的向导：选平台、接机器人、给每个角色选一个本地 CLI，就能开工。

```sh
curl -fsSL https://raw.githubusercontent.com/zuiho-kai/bothouse/main/install.sh | sh
```

Windows 命令、安装包下载、常驻后台和 DSH 频道见[上手指南](docs/GETTING_STARTED.md)。

<a id="features"></a>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/banner/features-zh-night.svg" />
  <img src="docs/assets/readme/banner/features-zh-day.svg" width="960" alt="" />
</picture>

## 能用它做什么

| 你想要 | bothouse 怎么帮你 |
| --- | --- |
| **一支自己的 AI 小团队** | 把已经登录好的 Claude Code、Codex、Gemini CLI、OpenCode 拉进群，每个角色有自己的名字、人设和会话。 |
| **一个账号也能组队** | 只有一个 Codex 或一个 DeepSeek 账号？照样建几个成员，分工各管一摊，在群里 @ 来 @ 去地派活。 |
| **在常用的聊天软件里找它** | 在 Discord、飞书、QQ、自建网页或 DSH web 里 @ 它；Discord 和飞书本来就有手机版，躺床上也能派活。 |
| **聊天不卡，大活另开** | 大一点的活交给单独的工作区去做，主角色继续陪你聊；做完交回，需要你拍板时才叫你。 |
| **大家记得同一件事** | 所有角色读写同一份记忆，换一个角色接手，不用你再讲一遍背景。 |
| **晚上自己复盘** | 夜里核对白天记下的东西，纠错去重；你反复纠正的地方会整理成候选规则，你点头才生效。 |
| **长任务不跑偏** | 每次交接都带上你的原话；另一个 AI 用干净的上下文验收；说「修好了」要拿证据。 |
| **在手机上管** | 自带网页面板：看谁在忙、用了多少额度、改人设、给正在跑的活插话。 |

<a id="team"></a>

### 角色和头像

<img src="docs/assets/bothouse-team-hero.png" width="660" alt="四个 AI 角色围坐在同一张桌前，各自对着电脑干活" />

每个角色都有自己的头像和人设，按包管理，挑一个就能上岗；想自己做一个，见[角色包](docs/persona-packs.md)。

<a id="screenshots"></a>

## 截图

<table>
  <tr>
    <td width="50%"><a href="docs/assets/readme/shot-handoff.zh.png"><img src="docs/assets/readme/shot-handoff.zh.png" alt="聊天频道里主角色把两件活分别派给工作区1和工作区2"></a><br><b>一句话交给工作区</b>：主角色把大活派出去，聊天频道照常说话。</td>
    <td width="50%"><a href="docs/assets/readme/shot-workspace.zh.png"><img src="docs/assets/readme/shot-workspace.zh.png" alt="工作区1的任务板：进行中和今天做完的活，按角色列出"></a><br><b>任务板</b>：哪个工作区在做什么、今天交了什么，一眼看完。</td>
  </tr>
  <tr>
    <td width="50%"><a href="docs/assets/readme/shot-roles.zh.jpg"><img src="docs/assets/readme/shot-roles.zh.jpg" alt="管理面板的角色页：五个角色分别接不同的 CLI，显示在线状态、当前在忙和模型"></a><br><b>角色管理</b>：每个角色接哪个 CLI、在忙什么、用什么模型，一键暂停或重启。</td>
    <td width="50%"><a href="docs/assets/readme/shot-library.zh.jpg"><img src="docs/assets/readme/shot-library.zh.jpg" alt="角色库页面：默认包里的人设卡片，带头像和一句话介绍"></a><br><b>角色库</b>：人设和头像按包管理，挑一个就能上岗。</td>
  </tr>
</table>

_上面两张是真实频道录屏，下面两张是作者自己在用的管理面板。_

<a id="memory"></a>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/banner/memory-zh-night.svg" />
  <img src="docs/assets/readme/banner/memory-zh-day.svg" width="960" alt="" />
</picture>

## 看得见的记忆

团队的记忆就是一个普通的 Markdown 文件夹。每条消息进来，先查相关的几页再回答；夜里自动复盘，把记错的改掉。你可以直接翻、直接改；它用 Git 记下每一次改动，推到你自己的 GitHub 私人仓库，换台电脑也能接着用。详见[调度与团队记忆](docs/ccm-and-wiki.md)。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/architecture-zh-night.svg" />
  <img src="docs/assets/readme/architecture-zh-day.svg" width="960" alt="bothouse 架构图：左边是入口（Discord、飞书、QQ、自建网页、DSH web）；中间是跑在你自己电脑上的 bothouse，负责派活、调度和任务板；下面是你已经装好的 CLI（Claude Code、Codex、Gemini CLI、DSH、OpenCode 等）；右边是共享记忆（Markdown Wiki，每晚自己复盘）和开发中的记忆论坛；最右边是同步记忆的 GitHub 私有仓库" />
</picture>

<a id="how"></a>

## 团队怎么运转

你在手机、电脑或浏览器上说一句话 → 聊天频道里的**主角色**（你默认在跟它说话的那个 AI）接下 → 大活交给**工作区**：工作区1 里 @写代码的、@写文案的，工作区2 里 @做调研的 → 干完交回。

聊天频道一直不停；只有要你拍板的事才回到聊天频道，别的不打扰你。

- **叫到才开口**：默认主角色接话，其他角色跟着看，被 @ 或点名才回。没点名的消息由轻量调度模块 jev（一个只做选择题的小模型）判断该谁接；它能用硅基流动的免费小模型，也能用本地 Qwen 0.6B。
- **共享记忆**：基于我们开源的 llm-wiki 扩展成多角色共用的记忆，存在本地 Markdown 里，能直接读、直接改，Git 记录团队学到的东西。
- **夜间复盘**：会话结束、闲置 30 分钟或出错时，快模型把进度记进 Wiki。夜里换更慢但更细的免费模型，对照原始对话纠错补漏，周日再全量查一遍。引用你的话会被代码逐字核对，编造的引用直接拒掉。
- **护栏和工具**：拦危险命令；说「修好了」要附验证证据，说「稍后看」要挂定时器；在群里一句话就能关掉某项检查。自带的工具有：看队友进度、视频抽帧和转写、联网搜索，还有查分身（子 agent）干了多久、现在什么状态。
- **手动换主角色**：旧主角色回不了话时，`bothouse handoff switch --to <项目>` 切过去，任务卡、工作区和待答问题都保留原编号。见[手动交接主角色](docs/LEAD_HANDOFF.md)。

## 平台

Discord 和飞书本来就有手机和电脑客户端，不用再包一层 App。

| 平台 | 状态 | 能做什么 |
| --- | --- | --- |
| Discord | 完整支持 | 多角色、@、派活交回、队友状态、日志频道；服务器和私信里都有斜杠命令 |
| 自建网页 | 团队模式 | 本地运行、像 Discord 的网页，多角色、@、派活交回 |
| 飞书（Lark） | 单角色 | 和接上的一个角色对话 |
| QQ 官方机器人 | 手动配置 | 群聊/私聊，群里 @ 人、@全体，见 [QQ 机器人](bridge/docs/qqbot.md) |
| DSH web | 实验 | DSH web 里的频道页，见 [DSH 频道](dsh/collab/README.md) |

QQ / NapCat 用户可手动配 [OneBot 适配器](bridge/docs/qq.md)。

<details>
<summary><b>DSH 频道里的常用操作</b></summary>

- **上传头像**：添加或编辑成员，打开 **可选 → 头像 → 上传图片**，选本地 PNG（256KB 以内），浏览器会自动缩到 256×256，存在本地数据目录；点 **恢复默认** 就删掉上传的头像。
- **任务板**：成员侧栏显示任务数，点 **任务板** 打开按频道、工作区、负责人分组的弹窗；已完成的默认折叠，派活/交付链接能跳回原消息。
- **频道设置**：每个频道单独选主角色、填一个已存在的绝对 **工作目录**；保存时可选立刻重建该频道的 DSH 会话（清空上下文），或下次建会话时再用。工作区继承所属频道的设置。
- **图片**：图片附件有 **下载** 和 **复制图片**；点图片打开大图预览，Esc、点背景或右上角关闭。

</details>

<details>
<summary><b>用 Tailscale 在手机上远程管理</b></summary>

bothouse 跑在家里电脑上，自带网页管理面板。Tailscale 让手机连回来，不用租服务器、不用开公网端口。

1. **连上设备**：电脑和手机都装 Tailscale、登录同一账号（macOS `brew install --cask tailscale`；Linux `curl -fsSL https://tailscale.com/install.sh | sh`），用 `tailscale ip -4` 记下电脑的 `100.x.y.z`。
2. **打开面板和实时桥**：对机器人发 `/web setup`，或运行 `bothouse web`，按提示重启一次。也可以手动改 `~/.bothouse/config.toml`：

   ```toml
   [management]
   enabled = true
   host = "100.x.y.z"        # 上一步的 Tailscale 地址
   port = 9820
   token = "换成一串长随机密码"

   [bridge]
   enabled = true            # 要在手机上发消息就得开
   token = "换成另一串随机密码"
   ```

3. **登录使用**：手机打开 `http://100.x.y.z:9820/`，填 token。能看运行时间、今天和本月各角色各模型的 token 用量与热力图；能加角色、改人设、换模型；能打开项目给正在跑的活插话。

网络提示：先启动 Tailscale，再启动 bothouse。不写 `host` 时会监听所有网卡，远程访问请写明。桥开启后还会在所有网卡监听 9810。只想给 tailnet 用，就在本机防火墙挡掉局域网和公网的 9810。

</details>

<a id="releases"></a>

## 版本亮点

完整记录见 [Releases](https://github.com/zuiho-kai/bothouse/releases)。

| 版本 | 新内容 |
| --- | --- |
| **[0.1.43](https://github.com/zuiho-kai/bothouse/releases/tag/v0.1.43)**（2026-10-31） | 忙时连发的几条消息**合成一轮**回答；交回太长被截断时**全文先存好**并给出续读位置；QQ 群里 @ 人；DSH 里图片可看、可复制、可下载；Windows 上多了一个桌面窗口。 |
| **[0.1.42](https://github.com/zuiho-kai/bothouse/releases/tag/v0.1.42)**（2026-10-30） | 每个聊天频道钉一张**任务板**（等你看 / 在做 / 搁置）；**每件活一个子话题**；队友交回结果时，固定写成四段大白话；回复正在跑的活，直接转进它的工作区。 |
| **[0.1.41](https://github.com/zuiho-kai/bothouse/releases/tag/v0.1.41)**（2026-10-30） | `/model` 显示频道**实际在用**的模型；工作区提问只暂停它点名的那件活；`bothouse-dsh` 随版本发到 npm。 |
| **[0.1.40](https://github.com/zuiho-kai/bothouse/releases/tag/v0.1.40)**（2026-10-29） | 回复被钩子拦下后不再只剩最后一句；Grok 角色也有「只问不改」护栏。 |

<a id="compare"></a>

## bothouse 和其他项目：重心不同

常有人问：DeepSeek 自己出了 agent，还有 Tobs、DS Bot、OpenClaw 这些，bothouse 有什么不一样？

**别家大多是一个 agent 带一群分身；bothouse 是把你已经在用的几种 AI 拉进一个群，让它们分工、共用一份记忆。**

- **DeepSeek Harness（DSH）** 是 DeepSeek 官方开源的 agent 框架，目前还是开发者预览：团队模式在实验，默认不带长期记忆，要自己接记忆插件。bothouse 的派活、任务板和共享记忆已经每天在用，而且 DSH 本身也能经 ACP 进来，当团队里的一个队友。
- **Tobs 和 DS Bot** 是基于 DSH 的社区 Bot 项目，团队里的 Bot 都跑在 DSH 上。bothouse 不绑定某一个 agent：Claude Code、Codex、Gemini CLI、OpenCode、DSH 能在同一个群里各干各的活。

| | 是什么 | 接哪些 AI | 几个 AI 怎么协作 | 记忆 | 在哪聊 |
| --- | --- | --- | --- | --- | --- |
| **bothouse** | **跑在你电脑上的调度层 + 网页面板** | **Claude Code、Codex、Gemini CLI、OpenCode；DSH 等走 ACP；OpenAI 兼容接口** | **主角色派活到独立工作区，任务板，每件活一个子话题** | **全员共用一份 Markdown Wiki，每晚复盘** | Discord、自建网页、飞书、QQ、DSH web（实验） |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | DeepSeek 官方 agent 框架（开发者预览） | 默认 DeepSeek，也能加其他模型提供商 | 子 agent；团队模式在实验 | 没有内置长期记忆，可接记忆插件 | 自带桌面端和网页 |
| [Tobs](https://github.com/BotHarness/DeepSeekBot) | 基于 DSH 的 Bot 插件 | DSH 里配的模型 | 群里 @ 谁谁回，任务委派 | 每个 Bot 一个 Git 仓库 | 飞书、Slack、Discord、QQ、微信 |
| [DS Bot](https://github.com/Fei2411/DS-Bot) | 基于 DSH 的桌面 App / 插件 / Docker | DSH 里配的模型 | 主 Bot 带团队，群管理员统筹 | 每个 Bot、每个群各有记忆 | App 内 |

另一类是成熟的个人助手和编程工具，也常被拿来比：

| | 是什么 | 几个 AI 怎么协作 | 记忆 | bothouse 的不同 |
| --- | --- | --- | --- | --- |
| [OpenClaw](https://github.com/openclaw/openclaw) | 个人 AI 助手，Claude、Codex 等内核可插拔，能接 20 多种聊天软件 | 团队预设：一个协调者派给研究、写作、审稿 | 会话按 agent 分开；Memory Wiki 默认共用，可按 agent 拆 | 一个助手换内核 vs 几种已登录的 CLI 同时在一个群里分工 |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | 会自己学习的个人助手，任意模型 | 隔离子 agent 并行 | 自管记忆、自动生成技能 | 它越用越懂你一个人；bothouse 让一个团队共用记忆 |
| [Orca](https://github.com/stablyai/orca) | 多 agent 编程 IDE，用你自己订阅的 CLI | 几个 agent 并排做同一件活，挑最好的合 | 交给各 CLI 自己 | 它让你盯着赛马；bothouse 让你交代完就走 |

**怎么选**：想要一个随处能聊、越用越懂你的个人助手，OpenClaw 和 Hermes Agent 很成熟；想同屏盯几路编程 agent 赛马，选 Orca；只用 DSH、想养几个 Bot，有 Tobs 和 DS Bot。如果你手上已经有几种 AI CLI，想让它们在一个群里分工、共用记忆，睡前交代一句、醒来收结果，选 bothouse。这些项目很多能叠着用。

<details>
<summary>其他常被问到的</summary>

| | 它擅长什么 | bothouse 多了什么 |
| --- | --- | --- |
| [Raft](https://www.testingcatalog.com/raft-1-0-puts-ai-agents-in-team-mode/) | 人和 agent 同在一个类 Slack 的新工作区 | 不用换软件，接进你已在用的 Discord、飞书、网页；开源，可自己部署 |
| [Cindy](https://github.com/makecindy/cindy) | 一个客户端挂 Claude Code、Codex，换模型不丢上下文 | 主角色自己拆活、派到工作区，不用你先拆好 |
| [腾讯马维斯](https://technode.com/2026/05/21/tencent-unveils-mavis-ai-assistant-that-turns-pcs-into-conversational-interfaces/) | 系统级助手：整理文件、操作电脑和手机 App | 几个 AI 分工做项目：写代码、查资料、审稿 |
| [magpie](https://github.com/yetone/magpie) / [cc-switch](https://github.com/farion1231/cc-switch) | 统一管理模型入口和供应商 | 不同层：它们管「用哪个模型」，bothouse 管「谁接哪件活、大家记得什么」，可以一起用 |
| [llm-wiki](https://github.com/zuiho-kai/llm-wiki) | 把会话整理成分层 wiki 记忆 | bothouse 的记忆就是在它上面扩成多角色共用 |

</details>

## 路线图

- **先认领再开工**：给活上锁，避免两个成员同时做一件事。
- **按需生成专家**：比如「发到 App Store」，自动建一位读过往决定、做完就退的专家。
- **角色包和插件市场**：人设、记忆模板和工具打包一键装，逛社区角色。
- **可携带的记忆和语义搜索**：Wiki 跟着人走，关键词之外加语义检索。
- **工作区自动清理**：最后一件活交完就清上下文。
- **更多群聊平台**：完整团队模式扩到 DSH web 频道、Telegram、Slack、QQ 和企业微信。

<a id="docs"></a>

## 参与开发

欢迎贡献，先读 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [AGENTS.md](AGENTS.md)。带网页面板的源码构建要先构建前端、再编译 Go，且不加 `no_web`，见[面板构建](docs/dashboard-source-build.md)。

更多见[上手指南](docs/GETTING_STARTED.md) · [一个 CLI 组团队](docs/single-cli-team.md) · [接入 Discord 和飞书](docs/connect-discord-feishu.md) · [Codex 会话隔离](docs/codex-session-isolation.md) · [调度与团队记忆](docs/ccm-and-wiki.md) · [角色包](docs/persona-packs.md) · [分角色 Wiki 与夜间反思](bridge/contrib/wiki/README.md) · [护栏和工具](bridge/contrib/hooks/README.md) · [用量接口](docs/api/usage.md) · [自建网页协议](bridge/docs/cloud-web.md) · [架构](docs/ARCHITECTURE.md) · [主角色协作脚本](bridge/contrib/lead/README.md)

<a id="community"></a>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/banner/community-zh-night.svg" />
  <img src="docs/assets/readme/banner/community-zh-day.svg" width="960" alt="" />
</picture>

## 社区

问题、想法，还有你搭起来的团队，都欢迎带来。

| 来坐坐 | |
| --- | --- |
| [Discord](https://discord.gg/aJmcnrt5ZB) | 和用户、贡献者直接聊 |
| [GitHub Issues](https://github.com/zuiho-kai/bothouse/issues) | 报 bug、提想法 |
| [Pull requests](https://github.com/zuiho-kai/bothouse/pulls) | 一起改代码 |
| [linux.do](https://linux.do) | 中文社区讨论 |

<a id="repository-status"></a>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/banner/status-zh-night.svg" />
  <img src="docs/assets/readme/banner/status-zh-day.svg" width="960" alt="" />
</picture>

## 仓库状态

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/zuiho-kai/bothouse/readme-status/stats-zh-night.svg" />
  <img src="https://raw.githubusercontent.com/zuiho-kai/bothouse/readme-status/stats-zh-day.svg" width="960" alt="GitHub 仓库状态：Stars、Forks、未关闭 Issues 和 PR、最近 30 天关闭的 PR 和提交数、最新版本；文字数据见下方链接。" />
</picture>

**最近 30 天**：关闭的 PR 包括已合并的 PR；提交按默认分支的全部历史统计，包括合并提交和机器人提交。每六小时更新一次，图里的时间是最后一次成功更新的时间。

[文字数据与统计口径](https://github.com/zuiho-kai/bothouse/tree/readme-status#readme) · [JSON](https://raw.githubusercontent.com/zuiho-kai/bothouse/readme-status/stats.json) · [更新任务](https://github.com/zuiho-kai/bothouse/actions/workflows/readme-status.yml)

<a href="https://github.com/zuiho-kai/bothouse">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/banner/star-zh-night.svg" />
  <img src="docs/assets/readme/banner/star-zh-day.svg" width="960" alt="收藏 bothouse，下次回来看团队长大。" />
</picture>
</a>

## 许可与致谢

- **许可**：[Apache-2.0](LICENSE)，详见 [LICENSING.md](LICENSING.md)。第三方依赖见 [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md)。
- **致谢**：转发层基于 [cc-connect](https://github.com/chenhg5/cc-connect)，保留完整提交历史，所以贡献者列表里也有 cc-connect 的作者和贡献者。感谢 [@chenhg5](https://github.com/chenhg5) 和每一位 cc-connect 贡献者；上游 MIT 声明保留在 [bridge/LICENSE-MIT-upstream](bridge/LICENSE-MIT-upstream)。
- **社区**：[linux.do](https://linux.do)

## Star History

<a href="https://www.star-history.com/#zuiho-kai/bothouse&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=zuiho-kai/bothouse&type=Date&theme=dark" />
    <img alt="zuiho-kai/bothouse 的 Star 增长曲线" src="https://api.star-history.com/svg?repos=zuiho-kai/bothouse&type=Date" />
  </picture>
</a>
