# 发起人身份签名与权限关口（#1062）

多人共用一个 bot 时，bot 去跑 GPU、调 API、登服务器之前，要知道「这一轮是哪个真人让做的」，并按管理员定的规则放行。模型看到的只是文字，文字谁都能打，所以「我是管理员」这类自报身份一律不算。只有桥知道每条消息真正是哪个平台账号发的。

bothouse 提供两样东西，不绑定任何具体后端：

1. **发起人凭证**：每一轮，桥记下发起人；轮内的工具向桥要一张用桥私钥签名的短期凭证。
2. **参考关口 `bothouse guard`**：验签、查管理员写的对照表、以对应身份执行一条固定命令、写审计日志。GPU、ssh、内部 API 都只是对照表里的一个「动作」。

```
平台用户 ──消息──> 桥（知道真实发送者，持有签名私钥）
                     │  轮内工具：bothouse identity token
                     ▼
            凭证 bh1.<内容>.<签名>（5 分钟有效）
                     │
                     ▼
        关口（本机 sudo / 远端 ssh 强制命令，只有公钥）
           验签 → 查对照表 → 以 run_as 执行固定命令 → 审计
```

## 凭证格式

`bh1.<base64url(JSON)>.<base64url(Ed25519 签名)>`，签名覆盖 `bh1.<base64url(JSON)>`。JSON 字段：

| 字段 | 含义 |
|---|---|
| `v` | 版本，现在是 1 |
| `kid` | 签名公钥指纹（sha256 前 8 字节十六进制） |
| `project` | 发起这一轮的 bot 项目名 |
| `platform` / `user_id` / `user_name` | 平台和平台账号 id、显示名（显示名只供日志，判断只用 id） |
| `chat_id` / `session` | 频道 id、桥的会话 key |
| `kind` | `human` 真人消息；`bot` 队友 bot、webhook、relay；`scheduled` cron/timer/交接叫醒；`local` 本地输入接口 |
| `turn` / `turn_at` | 这一轮的随机编号、开始时间 |
| `iat` / `exp` / `nonce` | 签发时间、过期时间（签发后 5 分钟）、随机数 |

规则：
- 只在一轮进行中签发；这一轮（连同排队的消息）结束后，同一会话再要凭证会被拒。
- 有效期短：模型就算把甲那一轮的凭证存下来，到乙那一轮也很快过期。每次调用前现取。
- 一轮由多条消息合并时，发起人是触发这一轮的那条消息的发送者。频道里别人之前说的话只是上下文。

## 接口

桥另开一个只管身份的本地 socket：`<data_dir>/run/identity.sock`，权限 0666，只有两个读接口；完整控制桥的 `api.sock` 仍是 0600。

| 接口 | 返回 |
|---|---|
| `GET /identity/token?project=<项目>&session=<会话>` | `{"token": "...", "claims": {...}}`；不在轮内回 409 |
| `GET /identity/pubkey` | `{"pubkey": "bothouse-ed25519 <base64>", "kid": "..."}` |

命令行（`CC_PROJECT`、`CC_SESSION_KEY`、`CC_DATA_DIR` 由桥注入角色进程，不用自己填）：

```sh
bothouse identity token            # 打印本轮凭证
bothouse identity show             # 打印本轮凭证内容
bothouse identity pubkey           # 打印桥公钥，拷到关口机器
bothouse identity verify --pubkey bridge.pub <token>   # 离线验签
```

密钥文件：`<data_dir>/identity/signing.key`（0600，第一次用时生成）、`signing.pub`（0644）。任何语言都能用 Ed25519 公钥自己验签，不必用 bothouse。

## 参考关口 bothouse guard

```sh
bothouse guard [--policy FILE] [--token T] [--check] [--ssh] <动作> [参数...]
```

- 凭证来源依次是 `--token`、`$BOTHOUSE_CALLER_TOKEN`、本机桥（按 `CC_PROJECT`/`CC_SESSION_KEY` 现取）。
- `--check` 只判断、打印结论，不执行。
- `--ssh` 给 `authorized_keys` 的强制命令用：从 `$SSH_ORIGINAL_COMMAND` 读 `<凭证> <动作> [参数...]`。
- 凭证缺失、签名不对、过期、`kind` 不在允许列表、账号不在对照表、角色没有这个动作，一律拒绝，退出码 1。
- 每次判断写一行审计（允许和拒绝都写），执行完再写一行（退出码、耗时）。审计文件写不进去就拒绝执行。
- 执行身份：关口以 root 运行时直接切到 `run_as`；否则 `run_as` 与当前用户相同就直接跑，不同就用 `sudo -n -u <run_as>`。`as_user = false` 时不切用户，`run_as` 只作为命令里的占位符（适合 `ssh {run_as}@host`）。
- 调用方参数原样追加在固定命令后面，不经过 shell。

对照表（TOML，由管理员维护，角色账号不能写）：

```toml
trusted_keys = ["/etc/bothouse/bridge.pub"]   # 可列多个桥的公钥
audit_log    = "/var/log/bothouse-guard.jsonl"
allow_kinds  = ["human"]                        # 默认只认真人

[roles.admin]
actions = ["*"]

[roles.member]
actions     = ["gpu-run"]
max_seconds = 14400                             # 可选：单次运行时长上限，不写不限

[[users]]
platform = "discord"
user_id  = "111111111111111111"
run_as   = "alice"
role     = "admin"

[[users]]
platform = "discord"
user_id  = "222222222222222222"
run_as   = "bob"
role     = "member"

[actions.gpu-run]
command = ["gpu", "run"]
```

命令里可用占位符：`{run_as}` `{user_id}` `{platform}` `{project}` `{user_name}`。子进程环境里还有 `BOTHOUSE_CALLER_PLATFORM`、`BOTHOUSE_CALLER_USER_ID`、`BOTHOUSE_CALLER_USER_NAME`、`BOTHOUSE_CALLER_PROJECT`、`BOTHOUSE_CALLER_TURN`、`BOTHOUSE_CALLER_RUN_AS`，后端可以自己再记一次。

## 接到各种后端

**本机命令（同一台机器）**：关口装成只有它能用 sudo 的入口，角色账号的 sudoers 只放这一条：

```
botrole ALL=(root) NOPASSWD: /usr/local/bin/bothouse guard --policy /etc/bothouse/guard.toml *
```

角色里这样调：`sudo bothouse guard --policy /etc/bothouse/guard.toml --token "$(bothouse identity token)" gpu-run train.py`。

**远端 GPU / 服务器（ssh）**：远端只放公钥和对照表。角色的 ssh 公钥在远端 `authorized_keys` 里加强制命令，这把钥匙就只能走关口：

```
command="/usr/local/bin/bothouse guard --policy /etc/bothouse/guard.toml --ssh",no-pty,no-port-forwarding ssh-ed25519 AAAA... botrole
```

角色里这样调：`ssh gpu-host "$(bothouse identity token)" gpu-run train.py`。远端关口以 root 运行时会切到对照表里的 `run_as` 去跑。注意 `--ssh` 模式按空格切参数，不支持引号。

**HTTP API / 自己写的服务**：把凭证放在请求头里（例如 `X-Bothouse-Caller: <token>`），服务端用桥公钥验 Ed25519 签名、检查 `exp` 和 `kind`，再按自己的规则放行。也可以在服务前面挂 `bothouse guard`，动作命令写成 `curl`。

## 怎样才真挡得住模型

签名只证明「桥说是谁」。模型能不能绕开，取决于系统账号怎么分：

1. **桥和角色分两个系统账号。** 桥用 `bothouse` 账号运行，`<data_dir>/identity/signing.key` 属于它、权限 0600。角色（Claude Code、Codex 等 CLI 进程）用另一个账号 `botrole` 运行。同一个账号时，模型可以直接读私钥自己签，签名就不算数。角色账号要能进到 `<data_dir>/run/` 目录去连 `identity.sock`（目录给执行权限即可），但不能读 `identity/`。
2. **真正干活的权限只给关口。** GPU 机器的登录钥匙、云 API 密钥、sudo 权限都只放在关口那边。角色账号只剩「调用关口」这一条路。只拦在模型自己的钩子里（例如 Claude Code PreToolUse）挡不住：钩子配置和模型是同一个账号，模型能改。
3. **对照表和审计日志角色不能写。** 放在 root 或管理员账号下。
4. **每个 bot 一个系统账号更好。** 多个 bot 共用一个账号时，它们能互相读对方的文件，也能替对方会话取凭证。凭证里带 `project`，关口可以据此分开记账，但要彻底隔开就得分账号。

现在 bothouse 自身没有内置「以另一个系统账号启动角色 CLI」的开关。分账号时，把桥配置里的 agent 命令指到一个包装脚本，用 `sudo -u botrole` 启动真正的 CLI；包装脚本和 sudoers 由管理员维护。

## 已知边界

- 凭证证明的是「这一轮由谁触发」，不证明这句话是他本人想让做的具体操作：同一轮里模型仍可能误解。危险动作请在对照表里只给需要的人。
- 有效期内重放：同一轮里取到的凭证 5 分钟内都能用。需要更严时，后端可以记下用过的 `nonce` 拒绝重复。
- webhook 消息在平台上没有真人账号，`kind` 是 `bot`，默认被拒。
