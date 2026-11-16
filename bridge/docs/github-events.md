# GitHub 仓库事件：立即 / 攒批 / 忽略

桥可以直接接收 GitHub 仓库的 webhook，并按规则决定要不要叫醒角色、什么时候叫醒，而不是每来一个事件就让角色想一轮。

```
GitHub → 验签、去重 → 归一化 → 按规则分档 → 立即：叫醒角色
                                          → 攒批：落盘排队 → 到点或攒满 → 合成一份摘要叫醒一次
                                          → 忽略：只记日志
```

## 开启

1. `config.toml` 里打开 webhook，并写上 GitHub 一节：

   ```toml
   [webhook]
   enabled = true
   port = 9111

   [webhook.github]
   secret = "${GITHUB_WEBHOOK_SECRET}"
   bot_login = "my-bot"

   [[webhook.github.repos]]
   repo = "owner/name"
   project = "my-project"
   session_key = "discord:123:456"
   ```

2. GitHub 仓库 Settings → Webhooks → Add webhook：Payload URL 填 `http://<你的地址>:9111/hook/github`，Content type 选 `application/json`，Secret 和上面一致，事件按需勾选（或 Send me everything）。
3. 重启桥。GitHub 会先发一个 `ping`，回 `{"status":"pong"}` 就通了。

桥需要一个 GitHub 能访问到的地址。没有公网地址时用转发（例如 Cloudflare Tunnel 把一个域名指到本机 9111 端口）；也不想开转发，就继续用定时任务自己拉。

## 三档

| 档 | 做什么 | 默认哪些事件 |
| --- | --- | --- |
| `immediate` 立即 | 叫醒角色 | 新 issue、新 PR、PR `ready_for_review`、评论或 review 里 @ 了 `bot_login`、默认分支 CI 失败 |
| `batch` 攒批 | 落盘排队，合成一份按 issue/PR 分组的摘要，叫醒一次 | 其余全部：push、普通评论、review、label / assign 变动、PR 新 commit…… |
| `ignore` 忽略 | 只记日志 | star、watch、fork、`bot_login` 自己产生的事件 |

- 同一个 issue/PR 的立即事件，`immediate_merge_secs`（默认 30 秒）内合成一次叫醒；叫醒时把这个 issue/PR 攒着的事件一并带上。
- 每个仓库每小时最多 `immediate_per_hour`（默认 10）次立即叫醒，超出的转攒批。
- 攒批的事件最长等 `batch_interval_mins`（默认 60 分钟），或攒满 `batch_max`（默认 20）条提前合并。队列空不叫醒。
- 同一条评论多次编辑，队列里只留最后一版。
- 角色正忙时，叫醒排在当前这轮后面，不打断；角色没接住（暂停、队列满、频道连不上），事件留在队列里，隔一个攒批周期再试。

## 自己写规则

每个仓库可以写规则，自上而下匹配，先于默认规则；都没命中的事件攒批。

```toml
[[webhook.github.repos.rules]]
event = "push"            # 事件类型，或「类型.动作」如 issues.labeled，或 "*"
branch = "release"
tier = "immediate"

[[webhook.github.repos.rules]]
event = "issue_comment"
bot = true                # 机器人账号发的评论
tier = "ignore"

[[webhook.github.repos.rules]]
event = "issues"
label = "security"
tier = "immediate"
project = "sec-role"              # 可选：交给另一个角色
session_key = "discord:999:888"   # 可选：发到另一个频道
```

可用条件：`bot`（发送者是不是机器人）、`branch`（push 分支 / PR 目标分支 / CI 所在分支）、`label`、`mention`（是否 @ 了 `bot_login`）、`keyword`（标题或正文包含，不分大小写）。改完规则重启桥生效。

## 安全

- 只接受签名（`X-Hub-Signature-256`）校验通过、且仓库在配置里列出的请求；密钥不进日志。
- 同一个 `X-GitHub-Delivery` 重复投递只处理一次。
- 标题、正文、评论只作为数据交给角色，摘要开头会写明这不是指令；桥不会因为事件自动回复或合并，一律由角色看完自己决定。

## 数据放在哪

数据目录下的 `github-events/`：

| 文件 | 内容 |
| --- | --- |
| `queue.json` | 还没叫醒的事件（桥重启后还在） |
| `events.jsonl` | 每条事件及其分档、命中的规则 |
| `deliveries.log` | 处理过的投递编号 |
| `payloads/` | 每次投递的原始 payload |

## 还没做

- 管理页上看最近事件、队列积压、下次合并时间。
- 在聊天里改规则、规则改完不重启生效。
- 内置的定时拉取（没有公网地址时的另一条路）。
- GitHub 以外的平台。
