# 安装和配置 bothouse（conest 版）

> 给人和给 AI 读的都是这一份。这里的 bothouse 是 conest 仓库 `bridge/` 里的 maomao 分支，带安装向导、gate、一主多 sub。

只有一条路：**装 → 向导或 `setup apply` → 确认上线**。macOS / Linux / Windows（arm64、amd64）。

## 1. 装

优先从 [Releases](https://github.com/zuiho-kai/bothouse/releases) 下载 dmg/exe 并双击，Linux 下载裸二进制。macOS 首次请「右键→打开」。命令行安装如下：

```sh
# 仓库公开后
curl -fsSL https://raw.githubusercontent.com/zuiho-kai/bothouse/main/install.sh | sh
# 仓库私有时（先装 GitHub CLI 并 gh auth login，账号要能看到 zuiho-kai/bothouse）
gh api repos/zuiho-kai/bothouse/contents/install.sh -H 'Accept: application/vnd.github.raw' | sh
```

Windows（PowerShell）：

```powershell
# 仓库公开后
irm https://raw.githubusercontent.com/zuiho-kai/bothouse/main/install.ps1 | iex
# 仓库私有时（先 winget install GitHub.cli，再 gh auth login）
gh api repos/zuiho-kai/bothouse/contents/install.ps1 -H "Accept: application/vnd.github.raw" | Out-String | iex
```

装到 `~/.local/bin/bothouse`（Windows：`%USERPROFILE%\.local\bin\bothouse.exe`，并加进用户 PATH），不用 Go 和 Node。`CONEST_VERSION=<tag>` 装指定版本，`INSTALL_DIR=<目录>` 换位置（PowerShell 里写 `$env:CONEST_VERSION='<tag>'`）。
从源码编（开发用）见 [docs/ccm-and-wiki.md](../docs/ccm-and-wiki.md) 附录 B。

## 2. 配

- **人**：运行 `bothouse`。还没配机器人时，它自动在浏览器打开安装向导（打不开就在终端打印带登录口令的链接）。照页面点完，点「重启生效」。
- **AI**：用一条命令，参数一次给全：

  ```sh
  bothouse setup apply -h                                     # 每个 JSON 字段的说明
  bothouse setup clis                                         # 本机有哪些 CLI、登录没有
  bothouse setup apply --json req.json --dry-run              # 只检查（token、服务器、intent），不写任何文件
  bothouse setup apply --json req.json                        # 写配置
  ```

  最小请求：`{"discord": {"guild_id": "<服务器 ID>"}, "roles": [{"token": "<机器人 token>"}]}`。一个 token = 一个角色，多个角色就在 `roles` 里放多个。
  要问用户的只有：每个机器人的 token、服务器 ID（默认频道 ID 可选）、每个角色用哪个本机 CLI（不说就用已登录的那个）。
  jev、人设、兜底角色、`allow_from`（默认 = 机器人所有者）都有默认值，不用问。完整说明：[docs/connect-discord-feishu.md](../docs/connect-discord-feishu.md) 第 3 节。

## 3. 确认上线

`setup apply` 的输出（网页向导最后一页同样）：

- `ok: true`：存好了，没有要用户做的事。
- `saved: true, ok: false, needs_user_action: true`：配置已写，但 `warnings` 里 `blocking: true` 的事要用户先做，否则机器人不会回话：
  `message_content_intent_off` / `message_content_intent_unknown`（打开 `url`，在开发者后台 Bot 页打开或确认 Message Content Intent）、`bot_not_in_guild`（打开邀请链接 `url`，把机器人拉进服务器）、
  `allow_from_unknown`（没查到所有者，机器人先谁都不听：问用户要他的 Discord 用户 ID，请求里加 `allow_from` 再跑）。做完不用重跑（allow_from 除外），重启即可。
- `next_steps`：怎么启动或重启。AI 用 `bothouse daemon install` 在后台启动，不要在自己的 shell 里前台跑 `bothouse`（它不退出，会占住终端）。
- 上线的标志：日志里有 `discord: connected`；在频道里 @ 机器人说一句，它回话。

gate 可以不装：没有 gate 时，被 @ 的角色照常回，其余消息都由兜底角色回。要装见 [docs/ccm-and-wiki.md](../docs/ccm-and-wiki.md) 第 3 步（要先在向导填 jev，没填 gate 会报错并提示怎么填）。
