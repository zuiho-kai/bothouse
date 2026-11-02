# Codex 机器人与桌面会话隔离

Discord、飞书或自建平台上的 Codex 角色，如果与桌面 Codex 共用同一个 Codex home，机器人会话也可能出现在桌面会话列表中。换 `work_dir` 只改变工作目录，不隔离会话存储。

bothouse 已支持在每个 Codex 角色的 `[projects.agent.options]` 设置 `codex_home`。本页说明如何使用现有选项；程序不会自动迁移登录或历史，也不会改变未配置角色的默认行为。这是会话与配置存储隔离，不是操作系统权限隔离。

## 新角色：先准备独立目录，再配置 bothouse

为每个需要独立存储的角色选一个不同于桌面 Codex 的目录。以下命令用于 macOS / Linux，`coder` 换成角色名：

```sh
bot_codex_home="$HOME/.bothouse/codex-home/coder"
mkdir -p "$bot_codex_home"
CODEX_HOME="$bot_codex_home" codex login
CODEX_HOME="$bot_codex_home" codex login status
```

Windows PowerShell 对应写法：

```powershell
$botPreviousCodexHome = $env:CODEX_HOME
try {
    $env:CODEX_HOME = Join-Path $HOME '.bothouse/codex-home/coder'
    New-Item -ItemType Directory -Force -Path $env:CODEX_HOME | Out-Null
    codex login
    codex login status
} finally {
    $env:CODEX_HOME = $botPreviousCodexHome
}
```

命令行环境只用于准备该角色。若原来已设置 `CODEX_HOME`，操作后恢复原值。桌面仍使用自己的目录，不要给桌面进程设置机器人的 `CODEX_HOME`。

使用第三方 API 时，沿用角色的 provider 配置，参见[第三方 API × 本机 CLI](connect-discord-feishu.md#4-第三方-api--本机-cli)。独立目录不会自动继承桌面的模型、MCP、指令、技能或登录；在新目录的 `config.toml` 等文件中补齐角色需要的配置。不要把整个新目录链接回桌面目录。

在新 home 的 Codex `config.toml` 顶层（所有 `[section]` 之前）显式设置 SQLite 存储目录。如果复制的配置已有 `sqlite_home`，替换原值，不能继续指向桌面：

```toml
sqlite_home = "/absolute/path/to/.bothouse/codex-home/coder"
```

在 **bothouse 的** `config.toml` 中找到现有 Codex 项目，将 `codex_home` 加到它已有的 options 表内，不要另建一个同名项目：

```toml
[projects.agent.options]
work_dir = "/absolute/path/to/workspace"
codex_home = "/absolute/path/to/.bothouse/codex-home/coder"
```

两处路径都替换成上面创建目录的真实绝对路径；Windows TOML 可用 `C:/Users/alice/.bothouse/codex-home/coder`。选项不会展开字面量 `~`。`backend = "app_server"` 与 `backend = "exec"` 都支持该选项，不必为隔离切换后端。

没有设置 `codex_home` 时，Codex 进程仍使用继承的 `CODEX_HOME`，未设置环境变量时默认 `~/.codex`。显式 `codex_home` 也用于 bothouse 的会话列表、历史读取和工作区派生角色；推荐直接设置此选项，而不是仅在 agent 的 env 表里设置 `CODEX_HOME`。

保存后重启受影响的 bothouse 实例；仅保存配置或热重载不足以切换已创建的 agent。正常发起新会话后，确认记录写入独立目录，桌面不再出现这个新会话。向导不会替你创建独立 Codex home。

## 已有角色：保留上下文后再切换

只改 `codex_home` 不会搬走原记录。原来的 bothouse 会话仍映射到旧 Codex 会话 ID，新目录里没有对应记录时无法恢复原上下文。需要保留时，按以下顺序维护：

1. 等该角色任务结束，暂停会写入这些会话的机器人进程；保留无关的桌面任务和其他实例。备份 bothouse 配置、数据目录中的会话映射，以及迁移涉及的 Codex 文件。
2. 从 bothouse 的会话映射确认属于该角色的 `agent_session_id`；需要保留历史时也核对 `past_agent_session_ids` 和相关子会话。不要仅凭工作目录或标题判断归属，同一工作目录可能也有人的桌面会话。
3. 在独立 home 准备好登录和配置。按已安装 Codex 版本的存储布局，将选定会话的 rollout JSONL **复制**到新 home，保留原会话 ID 和 `sessions/` 或 `archived_sessions/` 下的相对路径。保留原文件；不要把整个桌面会话库或 SQLite 数据库复制进来，也不要将会话目录或数据库链接回桌面。
4. 用指向新 home 的 Codex 验证迁移：App Server 完成 `initialize` / `initialized` 握手后，对待恢复 ID 调用 `thread/read`，核对返回的 ID 和 rollout 路径确实属于新 home；再对代表性会话调用 `thread/resume`，确认仍是同一 ID。无需发送模型回合。Codex 版本若不能从复制的 rollout 恢复，停止切换，保留备份并按该版本的迁移能力处理，不要直接改 SQLite 表。
5. 验证通过后再写入 bothouse 的 `codex_home` 并重启。保留原来的会话映射，检查连接恢复、下一次使用仍续接原 ID，且新增记录只写入独立 home。
6. 新 home 确认可用后，才在桌面通过原生归档功能逐个归档确认属于机器人的旧副本。归档根会话可能连带其子会话，先核对归属。遇到活跃写入者应先处理该会话的任务，不要删锁、杀无关进程或修改桌面数据库来强行隐藏记录。

改目录只能隔离后续写入，不会自动隐藏桌面已收录的旧会话。归档保留记录，不等于删除。技能等可单独复用，但 `sessions/`、`archived_sessions/` 与 SQLite 存储必须独立。凭据和真实对话只留在本机，不进入 Issue / PR。

回滚时先暂停受影响的机器人，再恢复原配置及对应的会话映射；通过桌面原生功能取消归档需要恢复的旧副本。切换后如已有新消息或新会话，先保全这些增量再回迁，避免回到旧 home 后丢失它们。不要用迁移前的整库备份覆盖仍在使用的桌面数据库。

## 验收

- 角色运行时使用独立 `CODEX_HOME`；Codex 配置中的 SQLite 路径没有指回桌面。
- 需要保留的原会话都可在新 home 读取，恢复后 ID 不变，rollout 路径位于新 home。
- bothouse 的会话映射仍在，重启后平台连接正常；后续会话不再进入桌面活动列表。
- 已归档的桌面副本与原始备份仍保留，无关桌面任务未受影响。

Codex 配置和存储说明见 [Advanced Configuration](https://developers.openai.com/codex/config-advanced) 与 [Configuration Reference](https://developers.openai.com/codex/config-reference)；原生会话读取、恢复和归档接口见 [App Server](https://developers.openai.com/codex/app-server)。
