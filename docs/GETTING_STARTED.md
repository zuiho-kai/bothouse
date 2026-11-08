# 从零用起 bothouse

bothouse = **团队协作 + wiki 记忆**：一群 AI 伙伴在聊天软件里一起说话、干活（随附的 bothouse 桥接在 `bridge/`），
加上一份它们共用、会自己长的记忆（wiki，[llm-wiki](https://github.com/zuiho-kai/llm-wiki)）。
先接好成员开始对话，再按需要配置团队记忆和调度。

> 你是被叫来帮用户装 bothouse、接 Discord 的 AI：不用读完本页，照 [AGENTS.md](../AGENTS.md) 里「用户说「配 Discord / 飞书」」一节的三步做。

**只有一个 CLI 或一个模型也能组队。** 多个角色可以选择同一套 Codex、Claude Code 或 Gemini CLI；在 DSH 里也可以添加三个都用同一 DeepSeek 的成员。每位成员有独立会话和人设，通过频道交换任务。具体步骤与共享边界见[同模型多成员指南](single-cli-team.md)。

## 三步用起来：装 → 选平台 → 确认上线

bothouse 是**核心 + 可选平台**：一个安装包里什么都有，但你只配要用的那个平台；没配的平台不启动、不检查、不报警告。
以后随时可以再加或停用平台，记忆、人设、定时任务都不受影响。macOS、Linux、Windows 都行，预编译桥接不用装 Go 或 Node。

### 1. 装

从 [Releases](https://github.com/zuiho-kai/bothouse/releases) 下载：

- macOS：`bothouse-mac.dmg`（Apple 芯片和 Intel 通用）；把 Bothouse.app 拖入 Applications，首次打开请「右键→打开」（安装包未签名）。
- Windows：`bothouse-windows.exe`（x64，ARM64 Windows 也可运行），下载后双击；SmartScreen 拦了就点「更多信息 → 仍要运行」。
- Linux：`bothouse-linux-x64` 或 `bothouse-linux-arm64`，`chmod +x` 后运行。

首次运行无配置时会自动在浏览器打开安装向导。也可用下面的命令行安装，命令都是 `bothouse`：

macOS / Linux，在终端里：

```sh
curl -fsSL https://raw.githubusercontent.com/zuiho-kai/bothouse/main/install.sh | sh
```

装完它会告诉你 `~/.local/bin` 在不在 PATH 里，不在就照它给的那行加上。装完 `bothouse --version` 看装的是哪一版。

Windows，在 PowerShell 里（开始菜单搜 PowerShell，不用管理员）：

```powershell
irm https://raw.githubusercontent.com/zuiho-kai/bothouse/main/install.ps1 | iex
```

它会校验下载的包，并把安装目录加进你的用户 PATH；当前窗口立刻能用，新开的窗口也能用。

### 2. 选平台

运行 `bothouse`，第一次会自动在浏览器打开安装向导（打不开就把带口令的链接打印出来，复制到浏览器）。第一页「你想在哪儿用」选一个，后面只出现这个平台的步骤：

| 平台 | 适合 | 要额外准备 | 怎么配 |
|---|---|---|---|
| **QQ** | 在 QQ 群或私聊里用 | NapCat（登录一个 QQ 号） | [QQ](platforms/qq.md) |
| **Discord** | 多个角色在一个频道里协作 | 每个角色一个机器人 token | [Discord](platforms/discord.md) |
| **飞书 / Lark** | 在飞书里用，一个机器人 | 飞书扫码 | [飞书](platforms/feishu.md) |
| **DSH**（实验） | 在 DeepSeek Harness 桌面版（默认）或 DSH 网页里用 | 桌面版：装好 DeepSeek Harness 桌面版即可；网页版：Node ≥ 22.12 和 dsh 命令。都要一把 DeepSeek API Key 或一个已登录的 CLI | [DSH](platforms/dsh.md) |
<!-- 自建平台入口停用（用户 11-05 定不再维护），原行：
| **自建平台** | 自己的聊天网页，打开就聊 | uv（本机一键起） | [自建平台](connect-discord-feishu.md#7-自建平台) |
-->

QQ、Discord、飞书和自建平台还要本机一个已登录的 CLI（`claude`、`codex`、`gemini`……）；多个角色可以全选同一个。
DSH 的成员在向导「角色和模型」一步配，可以直接使用 DeepSeek 模型，也可接本机已登录的 CLI；以后在 DSH 里还能加。
不用浏览器也行：对 Claude Code / Codex 说「帮我把 bothouse 配好接上 QQ（或 Discord）」，它按 [AGENTS.md](../AGENTS.md) 一次问齐，跑 `bothouse setup apply`。
配置写在 `~/.bothouse/config.toml`（Windows 是 `%USERPROFILE%\.bothouse\config.toml`）。

### 3. 确认上线

保存后向导最后一页（或 `setup apply` 输出的 JSON）列出还要你做的事，各平台页写了每一条怎么处理。都处理完，去聊天软件里 @ 机器人说一句试试。

- 想关掉终端也一直在线：`bothouse daemon install`（装成后台服务并立即启动，开机自启默认关，可在管理面板「设置」里改）。细节见[安装进阶](install-advanced.md#后台服务细节)。
- 以后再打开管理面板：终端运行 `bothouse web`。

## 以后添加或停用平台

- **添加**：管理面板左侧「添加平台」，进同一个向导，选新平台、只配它；已有的角色、记忆、人设、定时任务都不动。已配置的平台在第一页标「已配置」。
- **不用浏览器加**：`bothouse module add <平台>` 带上这个平台自己的参数，一条命令配好（给 AI 用的非交互入口，见 [AGENTS.md](../AGENTS.md) 末节）：
  `bothouse module add qq --ws-url ws://127.0.0.1:3001 --allow-from <QQ号>`、`bothouse module add discord --token <token> --guild <服务器ID>`、
  `bothouse module add feishu --app-id <id> --app-secret <secret>`、`bothouse module add cloud_web --url <地址> --token <token> --name <名字>`。
  先加 `--dry-run`；缺参数时打印 `missing` 列表、不写文件、退出码非 0。
- **停用**：`bothouse module disable <平台>`，配置留着，重启后这个平台不再连接；`bothouse module add <平台>` 恢复。
- **看现状**：`bothouse module list` 列出每个平台是已启用、已停用还是没配置。

平台名：`qq`、`discord`、`feishu`、`dsh`、`cloud_web`（自建平台）。QQ、Discord、飞书、自建平台命令只改配置文件里的平台段，改前把原文件备份成 `config.toml.bak-<时间>`；DSH 改自己的 web profile 原生 patch 并备份，详见 [DSH 页](platforms/dsh.md)。

## 进阶，可不装

下面这些都不影响基本对话，用熟了再加：

- **智能判断（gate）**：多个角色时让判断模型决定一句没点名的话该谁回。新装默认「仅被点名时回复」，不用它：群里 @ 谁谁回，什么都不用装。想开时在向导「主角色」一步选「智能判断」，或装完到管理面板「闸门」页选。
- **判断模型（jev）**：智能判断用来做判断的模型，要能返回选项概率。向导和「闸门」页都有一键预设：我们自己在用的 Qwen3.5-4B（4bit，Apple 芯片 Mac 本机用 mlx-lm 跑，下载约 3 GB，运行常驻约 3.2 GB 内存）。不填也能用：没点名的话由主角色回，不会报错。细节见 [Discord / 飞书接入第 5、6 步](connect-discord-feishu.md)。
- **wiki 记忆**：角色共用、自己会长的记忆。见[记忆和分流手动配置](ccm-and-wiki.md) 第 4 步。
- **全局安装（默认关）**：向导最后一步有两个勾选项，让你在终端里开的 Claude Code 也用上 bothouse 的记忆 hook 和守门 hook。
  命令行是 `bothouse setup hooks on|off --global memory|guards`。机器人自己的会话会跳过全局那份，不会跑两遍。见 [hooks 说明](../bridge/contrib/hooks/README.md)「全局安装」。
- **语音**：电脑语音伙伴是独立扩展（`companion/`），现状见 [MULTI_VOICE.md](MULTI_VOICE.md)。

## 术语

- **主角色**：没点名的话默认由它接；其他角色听得到群里每句话，只有被 @ 或被点名才开口。
- **成员和模型**：成员是有名字、人设和独立会话的角色；模型是它使用的后端。多个成员可以用相同模型。DSH 频道的「单模型多进程」则是派活给自己的临时子任务，与添加多个常驻成员不同。
- **wiki**：llm-wiki 的分层记忆（`MEMORY.md` → 域 `README.md` → 主题页）。会话结束后自动整理进去。

想装固定版本、核对校验、看老用户升级须知或各部分怎么连，见[安装进阶](install-advanced.md)。

## 遇到问题

- 先看各篇末尾的「怎么验证」。
- 仓库协作流程见 [CONTRIBUTING.md](../CONTRIBUTING.md)；密钥、日志、对话都不进 git。
