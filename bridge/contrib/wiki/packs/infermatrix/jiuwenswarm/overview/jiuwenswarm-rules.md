---
name: jiuwenswarm-rules
description: JiuwenSwarm 仓库审查规则 JIUWENSW-I2/I3/I6/I8/I10/I11/I12：Python 3.11 兼容、uv.lock 同步、JIUWENCLAW_ 前缀、metadata 分层、技能单份、Team/SwarmFlow 启停、中英文文档同步
metadata:
  scope: 只收本仓库自身的审查规则及代码快速入口表；全仓架构归 jiuwenswarm-architecture，功能导航归 jiuwenswarm-feature-map
---
# JiuwenSwarm 仓库审查规则

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: jiuwenswarm；created: 2026-09-30；updated: 2026-09-30

### 代码快速入口（Direct）

<!-- kb-init:quick-map -->

- 触发词：test、tests、测试、pytest、UT、单元测试、CI、coverage、覆盖率。PR 描述或改动命中下表一行时，先读该行的规则，再读页面其余部分。

| PR 描述在做什么 | 精确规则 | 第一批 live 源码 |
|---|---|---|
| 代码必须能在 Python 3.11 上运行（支持范围 `>=3.11, <3.14`） | JIUWENSW-I2 | `tests/`、`pytest.ini`、`run_tests.sh` |
| 改依赖必须在同一 PR 里同步 `uv.lock`，可选通道的依赖放进 extras | JIUWENSW-I3 | `tests/`、`pytest.ini`、`run_tests.sh` |
| 改名为 JiuwenSwarm 后不要再引入 `JIUWENCLAW_*`，也不要乱改其他通道的变量名 | JIUWENSW-I6 | `tests/`、`pytest.ini`、`run_tests.sh` |
| 分清几种 `metadata`，不要写错层 | JIUWENSW-I8 | `tests/`、`pytest.ini`、`run_tests.sh` |
| 技能实体只有一份：放在全局技能库，可见性只靠 JSON 声明 | JIUWENSW-I10 | `skills/` |
| Team 会话切换和 SwarmFlow 启停要区分本地/分布式模式和触发来源 | JIUWENSW-I11 | `tests/`、`pytest.ini`、`run_tests.sh` |
| 改协议或接口的实现时同步更新文档，中英文一起改 | JIUWENSW-I12 | `docs/zh/A2A.md`、`docs/zh/E2A-protocol.md`、`jiuwenswarm/common/e2a/models.py` |

### [JIUWENSW-I2] 代码必须能在 Python 3.11 上运行（支持范围 `>=3.11, <3.14`）

- 最低版本 3.11 分散写在 README 徽章、ACP 文档和 FAQ 里；CI 矩阵只覆盖 3.11/3.12/3.13。
- 拒绝只有 3.12 及以上才有的语法或 API，例如 PEP 695 的 `type X = ...` 和 `def f[T]()` 泛型语法、PEP 701 的 f-string 内复用同种引号、`itertools.batched`。
- 如果调整了 `pyproject.toml` 里的 Python 版本约束，CI 矩阵和 FAQ（中英文）要一起更新。

### [JIUWENSW-I3] 改依赖必须在同一 PR 里同步 `uv.lock`，可选通道的依赖放进 extras

- 仓库用 `uv` 管理依赖（`uv sync`、`uv run pytest`、`uv sync --extra a2a`）。`TESTING.md` 里的 `pip install -e ".[test]"` 只是另一种安装入口，不能成为漏更新锁文件的理由。
- 在 `pyproject.toml` 里增、删、改任何依赖，都要在同一 PR 里重新生成 `uv.lock`。
- `a2ui-agent-sdk` 保持 `==0.2.1` 这种精确锁定。升级时必须在同一 PR 里更新锁文件、跑协议校验测试，并完成 Web 前端的 `npm run build`。
- 只有某个可选通道才用到的依赖（例如 A2A 的 `a2a-sdk`）应放进对应的 extra（`jiuwenswarm[a2a]`），不要加进主依赖。

### [JIUWENSW-I6] 改名为 JiuwenSwarm 后不要再引入 `JIUWENCLAW_*`，也不要乱改其他通道的变量名

- v0.2.0 起 JiuwenClaw 升级为 JiuwenSwarm。A2UI 的运行时覆盖项只认 `JIUWENSWARM_A2UI_*`，`JIUWENCLAW_A2UI_*` 从 2026-06-04 起不再兼容。
- 新代码不能把 `JIUWENCLAW_` 前缀当后备来读，也不要新增这个前缀的变量。用户数据目录统一是 `~/.jiuwenswarm/`，例如 `~/.jiuwenswarm/config/.env`。
- 各通道已有自己的变量前缀（`A2A_SERVER_*`、`ACP_GATEWAY_*`、`WEB_HOST`/`WEB_PORT`/`WEB_PATH`），不要为了“统一”去改名，那样会破坏现有部署。

### [JIUWENSW-I8] 分清几种 `metadata`，不要写错层

- 请求信封顶层的 `metadata`：旧 `AgentRequest` 留下的字段，只在 `from_dict` 时迁入 `channel_context`，新代码不能写。
- `envelope_from_a2a_send_message` 的 `metadata` 参数：写入 `a2a_metadata`，只用于和 A2A 互通；`acp_meta` 同理只用于 ACP。
- `E2AResponse.metadata`：这是合法字段，存放通道或业务的自定义键值（对应旧的 `AgentResponse.metadata`），协议转换失败时也可临时写入兜底内容。旧格式整包 JSON 使用 `E2A_WIRE_LEGACY_AGENT_RESPONSE_KEY` / `E2A_WIRE_LEGACY_AGENT_CHUNK_KEY`，业务自定义键建议加通道前缀，避免冲突。
- A2A 通道里的元数据写到内部 `Message.metadata`，这不是 E2A 字段。
- 评审时核对三点：字段写在了哪一层的 `metadata`；有没有把业务键写进 `a2a_metadata`/`acp_meta`；有没有在请求侧重新写顶层 `metadata`。

### [JIUWENSW-I10] 技能实体只有一份：放在全局技能库，可见性只靠 JSON 声明

- 技能安装只写入全局库 `~/.jiuwenswarm/agent/workspace/skills/`。`.agent_teams/<team_name>/team-workspace/` 和 `workspaces/<agent_name>_workspace/` 下都不能出现 `skills/` 目录、软链或副本。
- 可见性只能通过团队和成员各自的 `skills-visibility.json`，以及 `skills.visibility.get`/`set`/`update` 修改。合并规则：deny 优先于 allow；团队的 deny 成员无法撤销；`allow` 为空表示继承整个技能库。
- 配置里各角色的 `skills` 只在第一次生成声明文件时作为初始 `allow`。`skills-visibility.json` 已存在时，不能被配置覆盖。
- FAQ 的升级备份表把自定义技能路径写成 `~/.jiuwenswarm/agent/skills`，和 AgentTeam 文档的 `~/.jiuwenswarm/agent/workspace/skills/` 不一致。涉及技能路径的改动以代码实际路径为准，并顺手修正写错的那份文档。

### [JIUWENSW-I11] Team 会话切换和 SwarmFlow 启停要区分本地/分布式模式和触发来源

- TUI `/exit` 或双击 Ctrl+C：兜底暂停，保留进度。
- 暂停后不能自动恢复，是否恢复由 Leader 决定。重启后没跑完的 run 显示为“暂停待恢复”，按钮置灰。

### [JIUWENSW-I12] 改协议或接口的实现时同步更新文档，中英文一起改

- `docs/zh/A2A.md` 和 `docs/zh/E2A-protocol.md` 都声明：文档与代码冲突时以源码为准，并要回头修正文档。所以修改 `jiuwenswarm/common/e2a/models.py`（`E2AEnvelope`/`E2AResponse` 的字段）、`constants.py` 里的元组、A2A 环境变量默认值或字段映射时，PR 要同步更新对应文档。
- 中英文文档成对维护：`docs/zh/<页面>.md` 对应 `docs/en/<页面>.md`（FAQ 和 E2A 明确要求同步，A2UI 的改动也是中英文一起改），`README_CN.md` 对应 `README.md`。只改了一边的，要求补齐另一边。
- `docs/zh/` 下的新页面沿用末尾的“返回导航”段落，链接 `../README.md` 和 `../../README_CN.md`，并在 `docs/README.md` 的导航里登记。
