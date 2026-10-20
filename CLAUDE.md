# CoNest

> 用户只是要把 cc-connect 装好、接上 Discord / 飞书（不是改代码）：直接看文末「用户说「配 Discord / 飞书」」一节。

先读取并遵守 [AGENTS.md](AGENTS.md)，再读 [当前交接](docs/HANDOFF.md)。同一套入口供 Claude、Codex 和其他 Agent 使用；能力事实见 [状态表](docs/STATUS.md)。

验收要求与教训见 [docs/code-standards.md](docs/code-standards.md)。

## 用户说「配 Discord / 飞书」「把这个配好接上 Discord」

这是给用户本机装好、配好 cc-connect，不是改代码，不用走 Issue→PR。只有一条路：装 → `setup apply` → 确认上线。

1. **装**：`command -v cc-connect && cc-connect setup --help` 能出 `setup apply` 就跳过。否则
   `gh api repos/Zssan12/conest/contents/install.sh -H 'Accept: application/vnd.github.raw' | sh`（仓库私有，要 gh 已登录；公开后用
   `curl -fsSL https://raw.githubusercontent.com/Zssan12/conest/main/install.sh | sh`），装到 `~/.local/bin`。不要自己编，不要 npm/brew 装（那是没有 setup 的上游版）。
2. **一次问齐**（只问这几项，其余都有默认值）：
   - 每个机器人的 **token**（一个 token = 一个角色）。还没有就让用户去 <https://discord.com/developers/applications> → New Application → Bot → Reset Token，并在同一页打开 **Message Content Intent**。
   - **服务器 ID**，可选再给**默认频道 ID**。拿法：Discord 设置 → 高级 → 打开「开发者模式」，右键服务器图标「复制服务器 ID」、右键频道「复制频道 ID」。
   - 每个角色用本机哪个 CLI：先跑 `cc-connect setup clis` 把已装、已登录的列给用户选；用户不在乎就不填（默认第一个已登录的）。
   - 不用问：jev（可选，不填也能跑）、人设（可选，`cc-connect setup personas` 有示例）、兜底角色（默认第一个）、`allow_from`（默认 = 机器人所有者，用 token 自动查；查不到时结果会要你问用户的 Discord 用户 ID）、gate（可选，不装也能用）。
   - 飞书：`"platform": "feishu"`，先让用户跑 `cc-connect feishu setup` 扫码拿 app_id/app_secret，一次只接一个机器人。
3. **执行**：字段说明看 `cc-connect setup apply -h`。把请求写进权限 600 的临时文件（token 不打印、不进日志、不进仓库），
   先 `cc-connect setup apply --json <文件> --dry-run`（不写任何文件），再去掉 `--dry-run` 跑。最小请求：
   `{"discord": {"guild_id": "<服务器 ID>", "channel_id": "<频道 ID>"}, "roles": [{"token": "<token>"}]}`。
4. **确认上线**：看输出 JSON，不只看退出码。`ok: true` 才算好。`needs_user_action: true` 时把 `warnings` 里 `blocking: true` 每条的 `message`、`fix`、`url`
   原样告诉用户（Intent 没开 / 机器人没进服务器 / 没查到所有者要用户给自己的 Discord 用户 ID，要用户点链接或回话），用户做完不用重跑，重启即可。
   然后**在后台**启动：`cc-connect daemon install`（装成系统服务、开机自启；看日志 `cc-connect daemon logs -f`）。**不要在你的 shell 里前台跑 `cc-connect`**：它不会退出，会占住终端直到被超时杀掉，机器人跟着下线。
   只想临时试一下用 `nohup cc-connect > ~/.cc-connect/run.log 2>&1 &`。日志出现 `discord: connected` 后请用户在频道里 @ 机器人试一句。
   不要动用户已在运行的 cc-connect 进程，除非用户同意。

详细说明：[docs/connect-discord-feishu.md](docs/connect-discord-feishu.md) 第 3 节；人用浏览器向导时直接运行 `cc-connect`。
