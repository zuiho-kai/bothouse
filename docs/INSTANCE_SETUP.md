# 独立实例配置与多设备部署指南（Instance Setup）

本文档说明如何在新机器、第二台设备或同机多实例环境下配置与运行 `companion`（包括电脑语音入口 `companion/voice` 与自主活动/日志调度 `companion/autonomy`），以及旧生产实例（`~/.cc-connect-maomao/`）的升级兼容方式与回滚边界。

---

## 1. 隔离原则与安全失败边界

为支持「一位 AI 一台设备」（例如 **G哥 + Cursor 双设备/双实例展示**），`companion` 已解除旧部署路径与固定角色默认值：

1. **移除旧生产硬编码**：
   - 不再默认读写 `~/.cc-connect-maomao/` 或 `/Users/zhaixinyang/agents-demo/journal`。
   - 不再内置固定频道 `discord:1560320196239953953`，也不再将 `voice` 锁死在 `gge`（G哥）或将 `autonomy` 主持人锁死在 `cjiang`。
2. **关键绑定全部显式配置**：
   - `voice` 必须显式指定：`project`、`role_name`、`session_key`、`bridge_socket`、`model_path`、`data_dir`、`shared_memory_dir`。
   - `autonomy` 初始化与运行必须显式指定：`main_channel`、`leader`、`bridge_config`、`socket`、`timer_store`、`journal_dir`。
3. **缺失即报错（Fail-Closed）**：
   - 当配置文件不存在或缺失任一关键字段时，命令立即返回可操作的中文/英文报错并退出，**不会回退到旧频道或旧角色，也不会发送任何 Discord 消息或注册定时任务**。

---

## 2. 新机器 / 双设备实例开发与部署步骤

### 2.1 推荐实例目录结构

每个独立实例建议使用互不重叠的实例根目录（例如单机默认 `~/.conest/`，或双实例 `~/.conest-gge/` 与 `~/.conest-cursor/`）：

```text
~/.conest-<instance>/
├── config.toml                 # 本实例 cc-connect 桥接配置
├── data/
│   ├── run/api.sock            # 本实例桥接 Unix Socket
│   └── timers/jobs.json        # 本实例桥接定时器存储
├── voice/
│   ├── config.json             # 本实例语音服务配置
│   └── events.jsonl            # 本实例语音轮次事件记录
├── shared-memory/              # 本实例（或明确授权同频道）共享语音记忆
└── autonomy/
    ├── config.json             # 本实例自主活动配置
    ├── state.json              # 本实例调度状态
    ├── messages.sqlite3        # 本实例采集消息库
    └── journal/                # 本实例生成的每日手记静态页
```

### 2.2 配置电脑语音入口（`companion/voice`）

#### 方式 A：从脱敏示例模板创建配置（推荐）

仓库在 `companion/examples/` 下提供了两份脱敏示例：

- G哥实例模板：`companion/examples/voice-config.example.json`（默认端口 `8787`）
- Cursor 实例模板：`companion/examples/voice-config-cursor.example.json`（默认端口 `8788`）

复制并填入当前设备的真实路径与频道 ID：

```bash
mkdir -p ~/.conest-cursor/voice
cp companion/examples/voice-config-cursor.example.json ~/.conest-cursor/voice/config.json
chmod 600 ~/.conest-cursor/voice/config.json
```

核对 `config.json` 中的关键字段：

- `project` / `role_name`：例如 `"cursor"` / `"Cursor"` 或 `"gge"` / `"G哥"`
- `session_key`：例如 `"discord:<目标频道ID>"`
- `bridge_socket`：指向本实例桥接的 `data/run/api.sock`
- `model_path`：本地 Whisper 识别模型快照目录
- `data_dir` / `shared_memory_dir`：指向本实例独立目录
- `port`：同机运行多个语音实例时必须使用不同端口（如 `8787` 与 `8788`）

#### 方式 B：在临时 `HOME` 或独立目录下使用 `init` 初始化

可通过环境变量或参数在独立目录中生成初始配置（不会读写 `~/.cc-connect-maomao/`）：

```bash
VOICE_PROJECT=cursor \
VOICE_ROLE_NAME=Cursor \
VOICE_SESSION_KEY=discord:1000000000000000002 \
VOICE_MODEL_PATH=/path/to/whisper-large-v3-turbo \
VOICE_PORT=8788 \
companion/scripts/voice init --config ~/.conest-cursor/voice/config.json
```

未显式指定 `VOICE_DATA_DIR`、`VOICE_SHARED_MEMORY_DIR`、`VOICE_BRIDGE_SOCKET` 时，`init` 会自动将它们派生在 `--config` 所在的实例根目录（`~/.conest-cursor/`）内。

#### 启动与状态检查

```bash
companion/scripts/voice serve --config ~/.conest-cursor/voice/config.json
companion/scripts/voice status --config ~/.conest-cursor/voice/config.json
```

对于多伙伴轮流语音或讨论模式，使用显式 `--config` 与 `--roles`：

```bash
cd companion
uv run python -m voice.multi \
  --config ~/.conest-gge/voice/config.json \
  --roles examples/voice-roles.json
```

### 2.3 配置自主活动与每日日志（`companion/autonomy`）

可参考 `companion/examples/autonomy-config.example.json`，或通过 `init` 子命令显式指定频道、主持人和桥接配置：

```bash
companion/scripts/autonomy \
  --config ~/.conest-gge/autonomy/config.json \
  init \
  --channel 1000000000000000001 \
  --leader gge \
  --bridge-config ~/.conest-gge/config.toml
```

- `init` 创建的配置默认处于暂停状态（`"enabled": false`），不会立即触发任何活动。
- 如需自定义 socket、timer_store 或日志目录，可追加 `--socket`、`--timer-store`、`--journal-dir`；未指定时默认派生在 `--bridge-config` 所在目录和 `--config` 同级 `journal/` 下。
- 每个独立 `autonomy` 实例必须绑定各自独立的桥接实例（`socket` / `bridge_config`）；若同一桥接中已存在指向其它 `--config` 路径或其它频道的 `autonomy` 定时任务，`install`、`leader`、`status` 会在任何 `/cron/edit` 之前直接报错拒绝，防止后装实例接管前一个实例的定时任务。
- 核对无误后再安装 cron 与恢复调度：

```bash
companion/scripts/autonomy --config ~/.conest-gge/autonomy/config.json preview
companion/scripts/autonomy --config ~/.conest-gge/autonomy/config.json install
companion/scripts/autonomy --config ~/.conest-gge/autonomy/config.json resume
```

---

## 3. 旧生产实例（`~/.cc-connect-maomao/`）升级兼容方式

已有生产实例升级到包含本改动的版本时，**无需迁移现有数据目录**，只需确保显式传入配置文件路径且配置文件字段完整：

1. **显式指定配置文件路径**：
   - 语音服务：启动参数传 `--config ~/.cc-connect-maomao/voice/config.json`，或在启动环境中设置 `VOICE_CONFIG=~/.cc-connect-maomao/voice/config.json`。
   - 自主活动：启动参数传 `--config ~/.cc-connect-maomao/autonomy/config.json`（已安装的 cron 命令本身已包含 `--config <绝对路径>`），或设置 `AUTONOMY_CONFIG=~/.cc-connect-maomao/autonomy/config.json`。
2. **核对旧配置文件字段完整性**：
   - 旧版通过 `init` 生成的 `voice/config.json` 与 `autonomy/config.json` 已经持久化了全部字段（`project`、`role_name`、`session_key`、`bridge_socket`、`model_path`、`data_dir`、`shared_memory_dir` 以及 `leader`、`bridge_config`、`socket`、`timer_store`、`journal_dir`），可直接通过新版的严格校验。
   - 若旧配置曾手写删减了部分字段（依赖旧版代码中的硬编码默认值），升级后运行 `status` 会立即提示具体缺失字段名称，补齐对应字段即可恢复运行。

---

旧 cron 的命令必须能解析出唯一、明确的绝对配置路径（支持 --config PATH 和 --config=PATH）。命令缺失、损坏、路径相对或多次指定配置时，不能仅凭主持人/频道相同推断归属，系统会拒绝接管。需要先人工核实原任务及工作目录；不要用第二个实例的 install 自动修复来源不明的任务。

## 4. 回滚边界与安全保障

1. **数据与配置格式零破坏**：
   - 本次改动不修改 `events.jsonl`、`shared-memory/*.jsonl`、`state.json`、`messages.sqlite3` 的存储结构，也不改动完备 `config.json` 的字段名。
2. **回滚步骤**：
   - 若需将代码回滚至本改动之前的版本，已显式写全字段的 `~/.cc-connect-maomao/voice/config.json` 与 `~/.cc-connect-maomao/autonomy/config.json` 可继续被旧版直接读取。
   - 注意：旧版 `voice` 仅允许 `project == "gge"`；若新创建的独立实例配置了其它角色（如 `"project": "cursor"`），在旧版代码下无法启动该非 `gge` 实例，但不会影响原 `gge` 实例。
3. **故障隔离保证**：
   - 任何配置缺失或校验错误均在本地配置加载阶段终止，不会向桥接 Socket 发送请求、不会向 Discord 发言，也不会修改其它实例的状态文件。
