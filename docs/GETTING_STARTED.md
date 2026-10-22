# 从零用起 CoNest

CoNest 本体 = **ccm + wiki**：一群 AI 伙伴在聊天软件里一起说话、干活（ccm，即 cc-connect 的 maomao 分支，在 `bridge/`），
加上一份它们共用、会自己长的记忆（wiki，[llm-wiki](https://github.com/zuiho-kai/llm-wiki)）。
硬件（每位伙伴一块小屏板子）是可选的一层。

**没有硬件，走完线 1 和线 2 就能完整用。** 线 3 只在你手上有板子时才需要。

## 三步用起来：装 → 向导 → 确认上线

只有这一条路。macOS、Linux、Windows 都行（Apple 芯片 / Intel / arm64 / x86_64）。不用装 Go，也不用装 Node。

**1. 装。** 下载预编译的 `cc-connect`（带网页向导），放进 `~/.local/bin`（Windows 是 `%USERPROFILE%\.local\bin`）。

macOS / Linux，在终端里：

```sh
# 仓库公开后：
curl -fsSL https://raw.githubusercontent.com/Zssan12/conest/main/install.sh | sh
# 仓库还是私有时（要先装 GitHub CLI 并 gh auth login，账号要能看到这个仓库）：
gh api repos/Zssan12/conest/contents/install.sh -H 'Accept: application/vnd.github.raw' | sh
```

装完它会告诉你 `~/.local/bin` 在不在 PATH 里，不在就照它给的那行加上。

默认装最新的发布版（含预发布版）。要装固定版本（比如几个人用同一版、或者退回上一版），在 `sh` 前面加 `CONEST_VERSION=<tag>`，tag 在仓库的 Releases 页能看到：

```sh
curl -fsSL https://raw.githubusercontent.com/Zssan12/conest/main/install.sh | CONEST_VERSION=<tag> sh
gh api repos/Zssan12/conest/contents/install.sh -H 'Accept: application/vnd.github.raw' | CONEST_VERSION=<tag> sh
```

`<tag>` 换成 Releases 页上的版本名（形如 `v0.1.0-rc5`）。

装完 `cc-connect --version` 看装的是哪一版；装完提示里的文档链接也指向这一版的文档。

Windows，在 PowerShell 里（开始菜单搜 PowerShell，不用管理员）：

```powershell
# 仓库公开后：
irm https://raw.githubusercontent.com/Zssan12/conest/main/install.ps1 | iex
# 仓库还是私有时（先 winget install GitHub.cli，再 gh auth login，账号要能看到这个仓库）：
gh api repos/Zssan12/conest/contents/install.ps1 -H "Accept: application/vnd.github.raw" | Out-String | iex
```

它会校验下载的包，并把安装目录加进你的用户 PATH；当前窗口立刻能用，新开的窗口也能用。

**2. 配。** 二选一，写的是同一份配置（`~/.cc-connect/config.toml`，Windows 是 `%USERPROFILE%\.cc-connect\config.toml`）：

- 人：运行 `cc-connect`。第一次运行会自动在浏览器打开安装向导（打不开就把带口令的链接打印出来，复制到浏览器）。
  按页面点：选平台 → 填机器人 token → 选服务器和频道 → 每个角色选本机 CLI → 人设 → 兜底角色 → jev（可跳过）→ 保存 → 「重启生效」。
- AI：对 Claude Code / Codex 说「帮我把 cc-connect 配好接上 Discord」。它按 [AGENTS.md](../AGENTS.md) 一次问齐要的东西，跑 `cc-connect setup apply`。

要你准备的只有：每个角色一个 Discord 机器人 token（开发者后台 → Bot → Reset Token，并打开 **Message Content Intent**），和本机一个已登录的 CLI（`claude`、`codex`、`gemini`……）。
服务器和频道在向导里点选；谁能指挥机器人（`allow_from`）默认就是建机器人的你。jev 和 gate 都可以不要。

**3. 确认上线。** 保存后向导最后一页（或 `setup apply` 输出的 JSON）会列出还要你做的事：

- **Message Content Intent 没开（或没查到）**：机器人读不到消息。点链接到开发者后台打开 / 确认。
- **没查到机器人的所有者**：为了安全机器人先谁都不听，按提示填上你自己的 Discord 用户 ID。
- **机器人还没进服务器**：点邀请链接把它拉进去。
- 都没有就是好了。日志里出现 `discord: connected` 就是上线，去频道里 @ 机器人说一句试试。
- 想关掉终端也一直在线：`cc-connect daemon install`（装成后台服务、开机登录后自动起：macOS 用 launchd，Linux 用 systemd，Windows 用「任务计划程序」）。Windows 上 `cc-connect daemon stop` / `uninstall` 会结束这个服务启动的全部进程，包括机器人正在跑的 AI CLI；在机器人里让 AI 跑 `cc-connect daemon restart`（或 stop、install --force、uninstall）也可以：这时操作交给服务外的一个后台进程做完，结果写在 `%USERPROFILE%\.cc-connect\logs\daemon-handoff.log`。

**gate 可以不装。** 没有 gate 时，被 @ 的角色照常回，其余消息都由兜底角色回。想让 AI 自己判断一句话该谁回再装 gate（[线 1](ccm-and-wiki.md) 第 3 步）：第一次要装 Python 依赖、下载约 3GB 模型，要几十分钟。

## 上面三步之后，按需再加

```
             你                                    想要什么                         再看哪篇
 ───────────────────────────────    ─────────────────────────────────    ─────────────
 只想在 Discord/飞书里有一群 AI      一主多 sub 的 AI 群                    上面三步就够
 还想要会记事、自己判断谁回           wiki 记忆、gate                        线 1 第 3–4 步
 手上有一块小智板子                  对板子说话，Discord 里的 AI 回、板子念    线 3
```

## 各部分怎么连

```
                 ┌──────────── 你的电脑 ────────────────────────────────┐
 Discord / 飞书 ◀─┼─▶ ccm（bridge/，cc-connect maomao 分支）              │
   （线 2）       │     │  每条消息先问 ──▶ gate（bridge/contrib/gate/）   │
                 │     │                   ├ /decide 谁回、回不回（本地小模型）
                 │     │                   └ /context 每轮推相关 wiki 页 ──▶ ~/wiki（llm-wiki）
                 │     ▼                                                 │
                 │   Claude Code / Codex / … 的会话（一个 bot 一个）      │
                 │                                                       │
                 │   角色小家主机（role-household/，可选，线 3）           │
                 └──────▲─────────────────────────────────────────────────┘
                        │ 局域网 Wi-Fi（OTA + WebSocket）
                    小智板子（可选，线 3）
```

## 术语

- **ccm / maomao 分支**：`bridge/` 里的 cc-connect 分支。比上游多了 gate、一主多 sub、队友状态、bot 之间交接。
- **主 bot / sub**：主 bot 默认接话；sub 听得到群里每句话，只有被 @ 或被点名才开口。
- **gate（快脑）**：每条消息先问它「回 / 插进正在做的这一轮 / 不回」。先走规则，规则定不了再让本地 Qwen 读选项概率。
- **wiki**：llm-wiki 的分层记忆（`MEMORY.md` → 域 `README.md` → 主题页）。会话结束后自动整理进去，gate 每轮把相关的页推给 bot。
- **角色小家主机**：`role-household/`，管板子（语音进出、表盘），也负责把你对板子说的话发进 Discord。
- **jev**：只做选择题、给出选项概率的模型。gate 用它判断群里一句话该哪个角色回；接了板子时，角色小家也用它选频道。
  向导里三个框（Base URL、Key、模型）填一个给概率的 OpenAI 兼容模型就行；没有时 gate 按规则判、判不了交给兜底角色，选频道按读音匹配。

## 三条线

| 线 | 文档 | 做完会看到什么 |
|---|---|---|
| 1. 配 ccm 和 wiki（gate、wiki 都可选） | [ccm-and-wiki.md](ccm-and-wiki.md) | 本机 cc-connect 跑着一主多 sub；（装了 gate）gate 在 9930 端口；bot 回话前收到「可能相关的 wiki 页」；会话结束后 wiki 多了记录 |
| 2. 接进 Discord 或飞书（就是上面第 2 步的向导：网页点几下，或让 AI 跑一条命令） | [connect-discord-feishu.md](connect-discord-feishu.md) | Discord 里几个 bot 接话、互相交接；飞书里一个 bot 能对话；（有板子时）默认发言频道和自动选频道配好 |
| 3. 接硬件（可选） | [hardware.md](hardware.md) | 板子屏幕显示角色表盘；叫她的名字，这句进 Discord，她的回答在板子上念出来 |

## 升级须知：role-household/roles.toml 不再进 git（2026-10-20）

`role-household/roles.toml` 以前在仓库里，带着原作者服务器的 ID；现在改成每人自己的本地文件，仓库只留模板
`role-household/roles.example.toml`，`.gitignore` 忽略它。**之前 clone 过、本地有这个文件的人，拉这次更新会让 git 删掉它**
（没改过的副本直接删；改过的会让 pull 停下）。保住自己的配置：

```sh
cp role-household/roles.toml /tmp/roles.toml.mine     # 拉之前先备份
git checkout -- role-household/roles.toml             # 改过的话先丢掉工作区改动（内容已在备份里），否则 pull 会停下
git pull
cp /tmp/roles.toml.mine role-household/roles.toml      # 放回去，从此 git 不再管它
```

忘了备份：从删它的那次提交的上一版取回

```sh
git show "$(git log -1 --diff-filter=D --format=%h -- role-household/roles.toml)^:role-household/roles.toml" > role-household/roles.toml
```

## 遇到问题

- 先看各篇末尾的「怎么验证」。
- 仓库协作流程见 [CONTRIBUTING.md](../CONTRIBUTING.md)；密钥、日志、对话都不进 git。
