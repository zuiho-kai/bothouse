# 共栖 · Agent 协作入口

> 用户只是要把 cc-connect 装好、接上 Discord / 飞书（不是改代码）：直接看文末「用户说「配 Discord / 飞书」」一节。

先读 README.md 与 docs/HANDOFF.md；目标/验收读 docs/GOALS.md 和 docs/STATUS.md，模块边界读 docs/ARCHITECTURE.md。开始前核对分支、HEAD、差异和对应 Issue/PR；交接是带时间的证据，不代替现场。

- 中文沟通，从目标、输入、输出、反馈判断方案；目标不清先讨论，目标清晰就选择最短可验证步骤。
- 新工作使用 CONTRIBUTING.md 的 Issue→分支→PR→验证流程。桥接实现还须读 bridge/AGENTS.md；新项目流程以根目录规范为准，上游历史说明保留在 bridge/。
- 默认自己完成任务。仅当前真人明确授权时按 skills/project-subagents/SKILL.md 派工；同一文件同一时间一名写者。使用独立 worktree 隔离并行写入，保护未提交工作。
- 当前生产仍在旧目录。开发构建不是部署；操作运行配置、进程或真实频道前核对用户授权与唯一操作人，凭据和完整对话不得入库。
- 验收要求、测试沙箱和每晚追加的教训见 [docs/code-standards.md](docs/code-standards.md)，提交 PR 前按它自查。
- 修复行为须有能复现原问题的回归验证；如实报告失败/跳过。初始导入的已知 Go 基线失败见 docs/GO_TEST_BASELINE.md，不据此放宽后续变更的验收。
- 实质进展后更新 docs/HANDOFF.md；能力证据更新 docs/STATUS.md，用法更新 README，边界变化更新架构。任务进度以 Issue/PR 为准，不复制多份待办。
- 禁止批量、递归、通配符删除及删除目录，禁止 sudo 删除。普通文件只能逐个明确路径，先说明完整路径并确认其为普通文件；需要清空目录时交由用户手动操作。

## 用户说「配 Discord / 飞书」「把这个配好接上 Discord」

这是给用户本机装好、配好 cc-connect，不是改代码，不用走 Issue→PR。只有一条路：装 → `setup apply` → 确认上线。

1. **装**：`command -v cc-connect && cc-connect setup --help` 能出 `setup apply` 就跳过。否则
   `gh api repos/Zssan12/conest/contents/install.sh -H 'Accept: application/vnd.github.raw' | sh`（仓库私有，要 gh 已登录；公开后用
   `curl -fsSL https://raw.githubusercontent.com/Zssan12/conest/main/install.sh | sh`），装到 `~/.local/bin`。不要自己编，不要 npm/brew 装（那是没有 setup 的上游版）。
2. **一次问齐**（只问这几项，其余都有默认值）：
   - 每个机器人的 **token**（一个 token = 一个角色）。还没有就让用户去 <https://discord.com/developers/applications> → New Application → Bot → Reset Token，并在同一页打开 **Message Content Intent**。
   - **服务器 ID**，可选再给**默认频道 ID**。拿法：Discord 设置 → 高级 → 打开「开发者模式」，右键服务器图标「复制服务器 ID」、右键频道「复制频道 ID」。
   - 每个角色用本机哪个 CLI：先跑 `cc-connect setup clis` 把已装、已登录的列给用户选；用户不在乎就不填（默认第一个已登录的）。
     `login` 都不是 `logged_in`（或列表是空的，stderr 会说怎么办）时，先让用户在这台机器上登录（`claude auth login` / `codex login` / `gemini` / `opencode auth login`）或给角色配第三方 API（`provider`，见 `cc-connect setup matrix`）；
     不登录也能存配置，但结果里会有阻塞的 `agent_not_logged_in`，机器人答不出话。
   - **机器人用什么语言回**：问用户，写 `"language": "<代码>"`（`zh`、`zh-TW`、`en`、`ja`、`ko`… 原样写进人设）。不问时按本机 locale（`LANG`），服务器常是 en_US，所以最好问；
     结果里每个角色的 `reply_language` / `reply_language_from` 写着选了什么、从哪来，另有一条 `reply_language_default` 提醒。要改：在 role 里加 `"reply_language": "<代码>"` 再跑一次（已配好的机器人只改人设里回复语言那一行），或直接改 `persona_file` 里 `<!-- conest:reply-language -->` 下面那一行。
   - 不用问：jev（可选，不填也能跑）、人设（可选，`cc-connect setup personas` 有示例）、兜底角色（默认第一个）、`allow_from`（默认 = 机器人所有者，用 token 自动查；查不到时结果会要你问用户的 Discord 用户 ID）、gate（可选，不装也能用）。
   - 飞书：`"platform": "feishu"`，先让用户跑 `cc-connect feishu setup` 扫码拿 app_id/app_secret，一次只接一个机器人。
3. **执行**：字段说明看 `cc-connect setup apply -h`。把请求写进权限 600 的临时文件（token 不打印、不进日志、不进仓库），
   先 `cc-connect setup apply --json <文件> --dry-run`（不写任何文件），再去掉 `--dry-run` 跑。最小请求：
   `{"discord": {"guild_id": "<服务器 ID>", "channel_id": "<频道 ID>"}, "roles": [{"token": "<token>"}]}`。
4. **确认上线**：看输出 JSON，不只看退出码。`ok: true` 才算好。`needs_user_action: true` 时把 `warnings` 里 `blocking: true` 每条的 `message`、`fix`、`url`
   原样告诉用户（Intent 没开 / 机器人没进服务器 / 没查到所有者要用户给自己的 Discord 用户 ID / CLI 没登录 / token 无效要重置，要用户点链接或回话），用户做完不用重跑，重启即可（token 无效时什么都没写，换新 token 重跑）。
   同一个 token 只能有一个 cc-connect 在线：这个机器人已经在别的电脑或别的进程上跑着时，两边会抢消息、各回一遍，先停掉旧的（向导查不出别的机器上有没有在跑）。
   然后**在后台**启动：`cc-connect daemon install`（装成系统服务、开机自启；看日志 `cc-connect daemon logs -f`）。**不要在你的 shell 里前台跑 `cc-connect`**：它不会退出，会占住终端直到被超时杀掉，机器人跟着下线。
   只想临时试一下用 `nohup cc-connect > ~/.cc-connect/run.log 2>&1 &`。日志出现 `discord: connected` 后请用户在频道里 @ 机器人试一句。
   不要动用户已在运行的 cc-connect 进程，除非用户同意。

详细说明：[docs/connect-discord-feishu.md](docs/connect-discord-feishu.md) 第 3 节；人用浏览器向导时直接运行 `cc-connect`。
