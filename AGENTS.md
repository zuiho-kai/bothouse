# 共栖 · Agent 协作入口

> 用户只是要把 cc-connect 装好、接上 Discord / 飞书（不是改代码）：直接看文末「用户说「配 Discord / 飞书」」一节。

先读 README.md 与 CONTRIBUTING.md；目标/验收读 docs/GOALS.md，模块边界读 docs/ARCHITECTURE.md。开始前核对分支、HEAD、差异和对应 Issue/PR。

- 中文沟通，从目标、输入、输出、反馈判断方案；目标不清先讨论，目标清晰就选择最短可验证步骤。
- 新工作使用 CONTRIBUTING.md 的 Issue→分支→PR→验证流程。桥接实现还须读 bridge/AGENTS.md；新项目流程以根目录规范为准，上游历史说明保留在 bridge/。
- 默认自己完成任务。仅当前真人明确授权时按 skills/project-subagents/SKILL.md 派工；同一文件同一时间一名写者。使用独立 worktree 隔离并行写入，保护未提交工作。
- 当前生产仍在旧目录。开发构建不是部署；操作运行配置、进程或真实频道前核对用户授权与唯一操作人，凭据和完整对话不得入库。
- **发布只从 main 出**：部署的二进制必须由 main 上某个提交构建（版本号写该提交）。修复先走 PR 合进 main 再部署；不要在旧线上基线上单独回移补丁另开 release 分支，否则主线和线上会再次分叉（2026-10-21 曾分叉 29 个提交，靠整支合并才对齐）。紧急热修也先合 main，部署后在 PR/Issue 里写明所用 main 提交。
- 验收要求、测试沙箱和每晚追加的教训见 [docs/code-standards.md](docs/code-standards.md)，提交 PR 前按它自查。
- **代码风格，不写过度防御**：
  - 来路不明的值只在接收它的入口（handler、配置加载、外部输入解析）校验一次，往里传类型确定的值；构造函数、内部类型、上游已经保证的，内部不再重复判断同一件事（如重复的 nil 检查、重复的参数校验）。
  - 只用一次的逻辑不提前抽成函数，直接写在调用处；除非会复用、包住的是真正复杂的边界，或单独起名能让调用处更好读。
  - 为推测性的、几乎不会发生的竞态或安全边界加复杂度（额外的锁、重试、兜底分支）之前，先写清会出什么事、概率多大、要多付多少复杂度，取得同意再写；不为理论上的健壮性悄悄扩大范围。
  - 少用 `recover`；`if err != nil` 时带上下文返回（`fmt.Errorf("...: %w", err)`），不吞 error，不层层重复兜底同一个错误。
- 修复行为须有能复现原问题的回归验证；如实报告失败/跳过。初始导入的已知 Go 基线失败见 docs/GO_TEST_BASELINE.md，不据此放宽后续变更的验收。
- 用法变化更新 README，边界变化更新架构。任务进度以 Issue/PR 为准，不复制多份待办。
- 禁止批量、递归、通配符删除及删除目录，禁止 sudo 删除。普通文件只能逐个明确路径，先说明完整路径并确认其为普通文件；需要清空目录时交由用户手动操作。

## 用户说「配 Discord / 飞书」「把这个配好接上 Discord」

这是给用户本机装好、配好 cc-connect，不是改代码，不用走 Issue→PR。只有一条路：装 → `setup apply` → 确认上线。

1. **装**：`command -v cc-connect && cc-connect setup --help` 能出 `setup apply` 就跳过。否则
   `curl -fsSL https://raw.githubusercontent.com/zuiho-kai/bothouse/main/install.sh | sh`，装到 `~/.local/bin`。不要自己编，不要 npm/brew 装（那是没有 setup 的上游版）。
   Windows（PowerShell）用
   `irm https://raw.githubusercontent.com/zuiho-kai/bothouse/main/install.ps1 | iex`，装到 `%USERPROFILE%\.local\bin` 并加进用户 PATH；下面的命令在 PowerShell 里照样用。
2. **一次问齐**（只问这几项，其余都有默认值）：
   - 每个机器人的 **token**（一个 token = 一个角色）。还没有就让用户去 <https://discord.com/developers/applications> → New Application → Bot → Reset Token，并在同一页打开 **Message Content Intent**。
   - **服务器 ID**，可选再给**默认频道 ID**。拿法：Discord 设置 → 高级 → 打开「开发者模式」，右键服务器图标「复制服务器 ID」、右键频道「复制频道 ID」。
   - 每个角色用本机哪个 CLI：先跑 `cc-connect setup clis` 把已装、已登录的列给用户选；用户不在乎就不填（默认第一个已登录的）。
     `login` 都不是 `logged_in`（或列表是空的，stderr 会说怎么办）时，先让用户在这台机器上登录（`claude auth login` / `codex login` / `gemini` / `opencode auth login`）或给角色配第三方 API（`provider`，见 `cc-connect setup matrix`）；
     不登录也能存配置，但结果里会有阻塞的 `agent_not_logged_in`，机器人答不出话。
   - **机器人用什么语言回**：问用户，写 `"language": "<代码>"`（`zh`、`zh-TW`、`en`、`ja`、`ko`… 原样写进人设）。不问时按本机 locale（`LANG`），服务器常是 en_US，所以最好问；
     结果里每个角色的 `reply_language` / `reply_language_from` 写着选了什么、从哪来，另有一条 `reply_language_default` 提醒。要改：在 role 里加 `"reply_language": "<代码>"` 再跑一次（已配好的机器人只改人设里回复语言那一行），或直接改 `persona_file` 里 `<!-- conest:reply-language -->` 下面那一行。
   - **群聊参与方式**：想少插话、也不跑小模型，安装请求加 `"gate": {"enabled": true, "mode": "addressed"}`，群聊需 @（Discord 也可回复该角色，自建平台也可开头叫名字）；想接未点名的追问，用 `"mode": "smart"` 并配置可返回 logprobs 的 jev。用户已说明要安静时直接选 addressed；添加角色省略 gate 会保留已保存选择。「关闭分流」会沿用各机器人设置，不能当成安静模式。具体成本见 docs/connect-discord-feishu.md 第 5 节。
   - 不用问：jev（可选，不填也能跑）、人设（可选，`cc-connect setup personas` 有示例）、主角色（默认第一个）、`allow_from`（默认 = 机器人所有者，用 token 自动查；查不到时结果会要你问用户的 Discord 用户 ID）。
   - 飞书：`"platform": "feishu"`，先让用户跑 `cc-connect feishu setup` 扫码拿 app_id/app_secret，一次只接一个机器人。
3. **执行**：字段说明看 `cc-connect setup apply -h`。把请求写进权限 600 的临时文件（token 不打印、不进日志、不进仓库），
   先 `cc-connect setup apply --json <文件> --dry-run`（不写任何文件），再去掉 `--dry-run` 跑。最小请求：
   `{"discord": {"guild_id": "<服务器 ID>", "channel_id": "<频道 ID>"}, "roles": [{"token": "<token>"}]}`。
4. **确认上线**：看输出 JSON，不只看退出码。`ok: true` 才算好。`needs_user_action: true` 时把 `warnings` 里 `blocking: true` 每条的 `message`、`fix`、`url`
   原样告诉用户（Intent 没开 / 机器人没进服务器 / 没查到所有者要用户给自己的 Discord 用户 ID / CLI 没登录 / token 无效要重置，要用户点链接或回话），用户做完不用重跑，重启即可（token 无效时什么都没写，换新 token 重跑）。
   同一个 token 只能有一个 cc-connect 在线：这个机器人已经在别的电脑或别的进程上跑着时，两边会抢消息、各回一遍，先停掉旧的（向导查不出别的机器上有没有在跑）。
   然后**在后台**启动：`cc-connect daemon install`（装成系统服务、开机自启，Windows 上是登录时启动的计划任务；看日志 `cc-connect daemon logs -f`）。**不要在你的 shell 里前台跑 `cc-connect`**：它不会退出，会占住终端直到被超时杀掉，机器人跟着下线。
   只想临时试一下用 `nohup cc-connect > ~/.cc-connect/run.log 2>&1 &`（Windows：`$env:CC_LOG_FILE="$HOME\.cc-connect\run.log"; Start-Process cc-connect -WindowStyle Hidden; Remove-Item Env:CC_LOG_FILE`，日志在 `$HOME\.cc-connect\run.log`）。日志出现 `discord: connected` 后请用户在频道里 @ 机器人试一句。
   不要动用户已在运行的 cc-connect 进程，除非用户同意。

详细说明：[docs/connect-discord-feishu.md](docs/connect-discord-feishu.md) 第 3 节；人用浏览器向导时直接运行 `cc-connect`。

## 用户说「接自建平台」「要一个像 Grok 那样打开就聊的」

也是装 → `setup apply` → 确认上线，只是平台换成自建平台（cloud_web，role-household 的 hub）。不用 Discord token。

1. `cc-connect setup hub`：`running: true` 且 `token_known: true` 就跳到第 3 步。没在跑且 `can_start: true` 时跑 `cc-connect setup hub start`
   （在本机 127.0.0.1 起一个，第一次约半分钟）；`missing: "uv"` 时先让用户装 uv（<https://docs.astral.sh/uv/getting-started/installation/>）。
   用户要连别人的平台：问地址和机器人 token。
2. 问每个角色叫什么名字（平台里显示的名字），用哪个本机 CLI（`cc-connect setup clis`，不在乎就不填）。已有的 Discord 机器人也要进平台：用 `reuse_project`，Discord 设置不动。
3. 请求 `{"platform": "cloud_web", "roles": [{"name": "<名字>"}]}`（连别人的平台再加 `"cloud_web": {"url": "<地址>", "token": "<token>"}`），
   照上一节第 3、4 步先 `--dry-run` 再正式跑、看 `ok`。`cloud_web.code` 是 `unauthorized` / `not_found` / `unreachable` 时把 `message` 和 `fix` 告诉用户。
4. 启动后日志出现 `cloud_web: websocket connected` 就是连上了；把 `cc-connect setup hub` 输出里的 `open_url`（本机平台，含登录口令）给用户打开，让用户在频道里发「@名字 你好」。

详细说明：[docs/connect-discord-feishu.md](docs/connect-discord-feishu.md) 第 7 节。
