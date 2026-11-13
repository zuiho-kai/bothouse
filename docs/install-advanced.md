# 安装进阶：固定版本、校验、升级须知与内部结构

新用户照 [从零用起 bothouse](GETTING_STARTED.md) 走就够了。这页放的是用熟以后才用得上的内容。

## 装固定版本或退回上一版

安装脚本默认装最新的发布版（含预发布版）。要装固定版本（比如几个人用同一版、或者退回上一版），在 `sh` 前面加 `BOTHOUSE_VERSION=<tag>`，tag 在仓库的 [Releases](https://github.com/zuiho-kai/bothouse/releases) 页能看到：

```sh
curl -fsSL https://raw.githubusercontent.com/zuiho-kai/bothouse/main/install.sh | BOTHOUSE_VERSION=<tag> sh
```

`<tag>` 换成 Releases 页上的版本名（形如 `v0.1.0-rc5`）。装完 `bothouse --version` 看装的是哪一版；装完提示里的文档链接也指向这一版的文档。

## 校验和历史架构包

- 每个版本带 `SHA256SUMS`（SHA-256）。手动下载的，打开前先核对文件和该版本的 `SHA256SUMS`。
- 自更新与安装脚本使用同一份平台下载文件，Mac 从 dmg 提取 universal 二进制。
- 更新到历史版本时，自更新可回退历史架构文件及 `cc-connect-<tag>-<os>-<arch>.tar.gz` / `.zip`（历史包在旧 Release 中，使用其校验文件）。
- 命令行安装位置：macOS / Linux 放进 `~/.local/bin`，Windows 放进 `%USERPROFILE%\.local\bin`，命令都是 `bothouse`。

## 后台服务细节

- `bothouse daemon install` 装成后台服务并立即启动；新安装开机自启默认关闭；重装或升级保留当前设置，可在管理面板「设置 → 开机自动启动」中修改，也可运行 `bothouse daemon autostart on|off`（macOS 用 launchd，Linux 用 systemd，Windows 用「任务计划程序」）。
- macOS 的安装、重装和重启会等待旧作业从 launchd 移除，并在 30 秒窗口内重试加载，兼容慢关停及名称延迟释放。若加载仍失败，错误会说明状态；按提示运行 `bothouse daemon status` 检查，再用 `bothouse daemon start` 从已保存的 plist 恢复。
- Windows 上 `bothouse daemon stop` / `uninstall` 会结束这个服务启动的全部进程，包括机器人正在跑的 AI CLI；在机器人里让 AI 跑 `bothouse daemon restart`（或 stop、install --force、uninstall）也可以：这时操作交给服务外的一个后台进程做完，结果写在 `%USERPROFILE%\.bothouse\logs\daemon-handoff.log`。
- 新安装默认使用 `~/.bothouse`；没有该目录而存在旧配置目录时，会继续沿用旧配置，不移动文件。

## Linux 服务器直接安装（不用 docker）

在一台有 systemd 的 Linux 服务器（x86_64 或 arm64，比如 Debian、Ubuntu）上，SSH 进去照下面做，不用 docker：

```sh
# 1. 装 bothouse（放进 ~/.local/bin）
curl -fsSL https://raw.githubusercontent.com/zuiho-kai/bothouse/main/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"   # 新开的登录 shell 会自己带上

# 2. 装一个 AI 命令行并登录（任选其一），例如 Claude Code：
curl -fsSL https://claude.ai/install.sh | bash && claude auth login
#    用 root 装 Claude Code 时，它要求加 CLAUDE_INSTALL_ALLOW_SUDO=1：
#    curl -fsSL https://claude.ai/install.sh | CLAUDE_INSTALL_ALLOW_SUDO=1 bash

# 3. 配平台（服务器上没浏览器，用命令行），例如 Discord：
bothouse module add discord --token <token> --guild <服务器ID> --channel <频道ID>

# 4. 装成后台服务，打开开机自启
bothouse daemon install
bothouse daemon autostart on
```

- 用 root 跑：装成系统服务（`/etc/systemd/system/bothouse.service`），开机就起，不用登录。
- 用普通用户跑：装成用户服务（`~/.config/systemd/user/`）。要 SSH 断开后不停、开机不登录也能起，还要一次 `sudo loginctl enable-linger <用户名>`；`daemon install` 和 `daemon autostart on` 没开时会提示这句。
- 看是否在线：`bothouse daemon status`；看日志：`bothouse daemon logs -f`，出现 `discord: connected` 就连上了。
- 关掉开机自启：`bothouse daemon autostart off`；只看现在开没开：`bothouse daemon autostart`。
- 没有 systemd 的环境（docker 容器、没开 systemd 的 WSL）`daemon install` 会报错并给出 nohup 的起法。

## 老用户升级须知：role-household/roles.toml 不再进 git（2026-10-20）

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

## 各部分怎么连（给改代码的人）

```
                 ┌──────────── 你的电脑 ────────────────────────────────┐
 Discord / 飞书 ◀─┼─▶ bothouse 桥（bridge/，内部旧称 ccm）               │
                 │     │  每条消息先问 ──▶ gate（bridge/contrib/gate/）   │
                 │     │                   ├ /decide 谁回、回不回（判断模型）
                 │     │                   └ /context 每轮推相关 wiki 页 ──▶ ~/wiki（llm-wiki）
                 │     ▼                                                 │
                 │   Claude Code / Codex / … 的会话（一个 bot 一个）      │
                 └───────────────────────────────────────────────────────┘
```

内部叫法：

- **ccm / maomao 分支**：`bridge/` 里的 bothouse 桥，代码和文档里旧称 ccm（cc-connect 的分支，开发时叫 maomao 分支）。比上游多了 gate、一主多 sub、队友状态、bot 之间交接。
- **sub**：主角色以外的角色。听得到群里每句话，只有被 @ 或被点名才开口。
- **gate（快脑）**：每条消息先问它「回 / 插进正在做的这一轮 / 不回」。先走规则，规则定不了再让判断模型（jev）读选项概率。

| 线 | 文档 | 做完会看到什么 |
|---|---|---|
| 1. 手动配桥、gate 和 wiki | [ccm-and-wiki.md](ccm-and-wiki.md) | 本机 bothouse 跑着一主多 sub；（装了 gate）gate 在 9930 端口；bot 回话前收到「可能相关的 wiki 页」；会话结束后 wiki 多了记录 |
| 2. 接进 Discord 或飞书（就是向导：网页点几下，或让 AI 跑一条命令） | [connect-discord-feishu.md](connect-discord-feishu.md) | Discord 里几个 bot 接话、互相交接；飞书里一个 bot 能对话 |
