# bothouse 管理 API 规范

> **版本：** 1.0-draft  
> **状态：** 草案 — 实现前可能变更  
> **最后更新：** 2026-03-10

---

## 1. 概述

bothouse 管理 API 是基于 HTTP 的 REST API，供外部应用（Web 控制台、TUI 客户端、GUI 桌面应用、Mac 托盘应用等）管理和监控 bothouse 实例。它是对现有内部 Unix 套接字 API 的补充，提供可通过网络访问、基于令牌认证的接口，适用于远程和本地管理工具。

### 1.1 架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         bothouse Process                               │
│                                                                          │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐  │
│  │  Unix Socket API │    │  Management API   │    │  Bridge Server   │  │
│  │  (internal)      │    │  (HTTP :9820)     │    │  (WebSocket)     │  │
│  └────────┬─────────┘    └────────┬─────────┘    └────────┬─────────┘  │
│           │                       │                       │             │
│           └───────────────────────┼───────────────────────┘             │
│                                   │                                      │
│                          ┌────────┴────────┐                            │
│                          │  Core Engine(s)  │                            │
│                          │  Projects       │                            │
│                          │  Sessions      │                            │
│                          │  Cron/Heartbeat │                            │
│                          └─────────────────┘                            │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
     ┌────────┴────────┐   ┌───────┴───────┐   ┌─────────┴─────────┐
     │  Web Dashboard  │   │  TUI Client   │   │  Mac Tray App      │
     └─────────────────┘   └───────────────┘   └────────────────────┘
```

### 1.2 设计原则

- **RESTful：** 资源导向的 URL，标准 HTTP 方法
- **JSON：** 所有请求/响应体使用 `application/json`
- **统一封装：** 每个响应均使用 `{"ok": true|false, "data"|"error": ...}`
- **令牌认证：** 所有端点支持 Bearer 令牌或查询参数认证

---

## 2. 配置

### 2.1 管理配置块

在 `config.toml` 中添加以下配置：

```toml
[management]
enabled = true
port = 9820
token = "mgmt-secret"
```

| 字段       | 类型    | 默认值   | 说明                                      |
|------------|---------|----------|-------------------------------------------|
| `enabled`  | boolean | `false`  | 是否启用管理 API 服务                     |
| `port`     | integer | `9820`   | 监听 TCP 端口                             |
| `token`    | string  | (必填)   | 认证用共享密钥                            |

当 `enabled` 为 `false` 时，管理 API 不会启动。令牌应为强随机字符串（建议 32 字符以上）。

### 2.2 基础 URL

所有端点相对于以下基础路径：

```
http://<host>:<port>/api/v1
```

示例：`http://localhost:9820/api/v1/status`

---

## 3. 认证

每个请求必须携带有效令牌。支持两种方式：

### 3.1 Bearer 令牌（推荐）

```
Authorization: Bearer <token>
```

示例：

```bash
curl -H "Authorization: Bearer mgmt-secret" http://localhost:9820/api/v1/status
```

### 3.2 查询参数

```
GET /api/v1/status?token=mgmt-secret
```

> **注意：** 查询参数认证适用于难以设置请求头的环境。出于安全考虑，建议使用 Bearer 令牌（URL 中的令牌可能被记录到日志）。

### 3.3 未授权响应

若令牌缺失或无效：

- **HTTP 状态：** `401 Unauthorized`
- **响应体：**

```json
{
  "ok": false,
  "error": "unauthorized: missing or invalid token"
}
```

---

## 4. 响应格式

### 4.1 成功

```json
{
  "ok": true,
  "data": { ... }
}
```

### 4.2 错误

```json
{
  "ok": false,
  "error": "human-readable error message"
}
```

### 4.3 HTTP 状态码

| 状态码 | 含义                                      |
|--------|-------------------------------------------|
| 200    | 成功                                      |
| 400    | 请求错误（无效请求体、缺少参数）          |
| 401    | 未授权（缺少/无效令牌）                   |
| 404    | 资源未找到（项目、会话等）                |
| 405    | 方法不允许                                |
| 500    | 服务器内部错误                            |

---

## 5. 端点参考

### 5.1 系统

#### GET /api/v1/status

返回系统状态与摘要信息。

**响应：**

```json
{
  "ok": true,
  "data": {
    "version": "v1.2.0",
    "uptime_seconds": 3600,
    "connected_platforms": ["feishu", "telegram"],
    "projects_count": 2,
    "bridge_adapters": [
      {
        "platform": "custom",
        "project": "my-backend",
        "capabilities": ["text", "images"]
      }
    ]
  }
}
```

| 字段                   | 类型     | 说明                                      |
|------------------------|----------|-------------------------------------------|
| `version`               | string   | bothouse 版本（如 `v1.2.0`）            |
| `uptime_seconds`       | number   | 进程运行时长（秒）                        |
| `connected_platforms`  | string[] | 当前已连接的平台类型                      |
| `projects_count`       | number   | 已配置项目数量                            |
| `bridge_adapters`      | array    | 通过 Bridge WebSocket 连接的外部适配器    |

---

#### POST /api/v1/restart

触发优雅重启。进程将正常退出并重新 exec 自身。若适用，可能向发起重启的会话发送「重启成功」消息。

**请求体（可选）：**

```json
{
  "session_key": "telegram:123:456",
  "platform": "telegram"
}
```

若提供，新进程启动后将向指定会话发送重启通知。

**响应：**

```json
{
  "ok": true,
  "data": {
    "message": "restart initiated"
  }
}
```

---

#### POST /api/v1/reload

从磁盘重新加载配置，无需重启进程。可添加新项目；已移除的项目将被停止。项目配置变更将生效。

**响应：**

```json
{
  "ok": true,
  "data": {
    "message": "config reloaded",
    "projects_added": ["new-project"],
    "projects_removed": [],
    "projects_updated": ["my-backend"]
  }
}
```

---

#### GET /api/v1/config

返回当前配置文件的 TOML 文本，敏感信息已脱敏。面板「系统 → 配置」页把这段文本原样展示，所以注释、键顺序和格式都保留，只有凭证的值被替换。

**查询参数：** 无

**响应：** `text/plain; charset=utf-8`，即配置文件原文，所有凭证类键的值替换为 `"***"`：

```toml
[management]
port = 51442
token = "***"

[feishu]
app_id = "cli_xxxxxxxx"     # 不是密钥，原样返回
app_secret = "***"

[[projects.agent.providers]]
name = "anthropic"
api_key = "***"
max_tokens = 8192           # token 计数不是密钥
```

脱敏按键名判断，不区分大小写和分隔符，并递归进入表、数组和内联表（`env = { ANTHROPIC_API_KEY = "***", REGION = "us" }`）。键名包含 `secret`、`password`、`credential`、`api_key`、`private_key`、`access_key`，或以 `token`、`_aes_key`、`encrypt_key`、`_signing_key` 结尾的，一律替换为 `"***"`。只表示位置的 `token_endpoint`、`token_url`、`credentials_file`，以及 `max_tokens`、`min_tokens`、`max_context_tokens` 这类计数保持原值。

文件读不到或脱敏失败时接口返回错误且不返回配置内容，失败不会泄露密钥。

---

#### GET /api/v1/logs

返回近期日志条目。

**查询参数：**

| 参数     | 类型   | 默认值  | 说明                                          |
|----------|--------|---------|-----------------------------------------------|
| `level`  | string | `info`  | 最低级别：`debug`、`info`、`warn`、`error`    |
| `limit`  | int    | `100`   | 返回条目上限（1–1000）                        |

**响应：**

```json
{
  "ok": true,
  "data": {
    "entries": [
      {
        "time": "2026-03-10T10:30:00Z",
        "level": "info",
        "message": "api server started",
        "attrs": {"socket": "/home/user/.bothouse/run/api.sock"}
      }
    ]
  }
}
```

---

### 5.2 项目

#### GET /api/v1/projects

列出所有项目及摘要信息。

**响应：**

```json
{
  "ok": true,
  "data": {
    "projects": [
      {
        "name": "my-backend",
        "agent_type": "claudecode",
        "platforms": ["feishu", "telegram"],
        "sessions_count": 3,
        "heartbeat_enabled": true
      }
    ]
  }
}
```

---

#### GET /api/v1/projects/{name}

返回单个项目的详细信息。

**路径参数：**

| 参数   | 类型   | 说明        |
|--------|--------|-------------|
| `name` | string | 项目名称    |

**响应：**

`platforms[].connected` 是这个平台的运行期就绪状态，不是「config.toml 里写了」：
起不来、或异步平台还在重连的，列出来但 `"connected": false`。bridge 传输在
`GET /api/v1/status` 的 `bridge` 字段里，不在这里列。

```json
{
  "ok": true,
  "data": {
    "name": "my-backend",
    "agent_type": "claudecode",
    "platforms": [
      {
        "type": "feishu",
        "connected": true
      },
      {
        "type": "telegram",
        "connected": true
      }
    ],
    "sessions_count": 3,
    "active_session_keys": ["telegram:123:456", "feishu:ou_xxx:chat_xxx"],
    "heartbeat": {
      "enabled": true,
      "paused": false,
      "interval_mins": 30,
      "session_key": "telegram:123:456"
    },
    "settings": {
      "quiet": false,
      "admin_from": "user1,user2",
      "language": "en",
      "disabled_commands": ["restart", "upgrade"]
    }
  }
}
```

**错误（404）：**

```json
{
  "ok": false,
  "error": "project not found: my-backend"
}
```

---

#### PATCH /api/v1/projects/{name}

更新项目设置。仅更新提供的字段。

**请求体：**

```json
{
  "quiet": true,
  "admin_from": "user1,user2,user3",
  "language": "zh",
  "disabled_commands": ["restart", "upgrade", "cron"]
}
```

| 字段                 | 类型     | 说明                                                      |
|----------------------|----------|-----------------------------------------------------------|
| `quiet`              | boolean  | 是否隐藏思考过程/工具进度消息                             |
| `admin_from`         | string   | 特权命令用户 ID 列表（逗号分隔）；`"*"` 表示全部用户      |
| `language`           | string   | 界面语言：`en`、`zh`、`zh-TW`、`ja`、`es`                 |
| `disabled_commands`  | string[] | 要禁用的命令（如 `restart`、`upgrade`、`cron`）           |
| `platform_allow_from`| object   | 按平台类型写 `allow_from`，如 `{"qq": "12345", "discord": "user1,user2"}`；键按平台 `type` 不区分大小写匹配。这是 `allow_from` 的**唯一写入者**：`PATCH /projects/{name}/qq/settings` 和 `qqbot` 面板传 `allow_from` 都会返回 `400`。传 `""` 表示清空该平台的允许名单 |

**响应：**

```json
{
  "ok": true,
  "data": {
    "name": "my-backend",
    "settings": {
      "quiet": true,
      "admin_from": "user1,user2,user3",
      "language": "zh",
      "disabled_commands": ["restart", "upgrade", "cron"]
    }
  }
}
```

---

#### GET /api/v1/projects/{name}/qq/settings

读取项目已保存的 OneBot v11（`qq`）连接配置。访问令牌从不返回，`token_set`
只表示有没有存。项目里没有 `qq` 平台时返回 `200` 且 `configured: false`。项目
引擎没在跑也能读写这条接口。

**响应：**

```json
{
  "ok": true,
  "data": {
    "configured": true,
    "settings": {
      "ws_url": "ws://127.0.0.1:3001",
      "http_url": "http://127.0.0.1:3000",
      "token_set": true,
      "allow_from": "12345",
      "share_session_in_channel": false,
      "split_bubbles": false,
      "allow_groups_with": "",
      "command_allow_from": "",
      "save_images_dir": "",
      "allow_qzone": false,
      "allow_avatar": false
    }
  }
}
```

---

#### PATCH /api/v1/projects/{name}/qq/settings

保存局部更新：只改请求体里出现的字段，出现未知字段返回 `400`。字符串字段传
`""` 表示从 `config.toml` 里删掉这个 key，这正是适配器读「没设置」的方式。布尔是
三态：不传就不动，显式传 `false` 会写成 `false`。

| 字段 | 类型 | 说明 |
|------|------|------|
| `ws_url` | string | OneBot 正向 WebSocket 地址；设置了就必须是 `ws://` 或 `wss://` |
| `http_url` | string | 文件发送用的 OneBot HTTP API 地址；`""` 删除 |
| `token` | string | 访问令牌；不传保留，`""` 删除 |
| `share_session_in_channel` | boolean | 群成员共用一个会话 |
| `split_bubbles` | boolean | 按空行拆成多条（`platform/qq`） |
| `allow_groups_with` | string | 逗号分隔的 QQ 号：含这些人的群也放行 |
| `command_allow_from` | string | 谁能发斜杠命令；`""` 保持默认 |
| `save_images_dir` | string | 收到的图片另存到哪；`""` 停止另存 |
| `allow_qzone` | boolean | 查/发/换/删这个号自己的说说（NapCat 扩展） |
| `allow_avatar` | boolean | 换这个号自己的头像（NapCat 扩展） |

`allow_from` **不能**从这里写：它只有一个写入者，即 `PATCH
/api/v1/projects/{name}` 的 `platform_allow_from`。传了会返回 `400`，而不是
悄悄什么都不做。

**请求体：**

```json
{
  "split_bubbles": true,
  "allow_groups_with": "12345,67890",
  "save_images_dir": "/path/to/received-images"
}
```

**响应：**

```json
{
  "ok": true,
  "data": {
    "message": "qq settings saved",
    "changed": ["split_bubbles", "allow_groups_with", "save_images_dir"],
    "restart_required": true,
    "settings": { "ws_url": "ws://127.0.0.1:3001", "split_bubbles": true }
  }
}
```

`changed` 只列真正和已存值不同的字段，`restart_required` 跟着它：没有变化时
返回 `false`，也不会重写文件。平台在项目启动时读这些选项，所以改动重启后生效。

错误：`404` 项目不存在，`400` 取值非法 / 没有 `qq` 平台 / 写了只读的
`allow_from`，`503` 管理接口没接上配置读写回调。

---

#### GET /api/v1/projects/{name}/qqbot/settings

读取项目已保存的 QQ 官方 Bot（`qqbot`）配置。**AppID 和 AppSecret 都不返回**，
`app_id_set` / `app_secret_set` 只说有没有存过：面板既不重填也不显示，换 AppID
就是重新添加一个 Bot。项目里没有 `qqbot` 平台时返回 `200` 且 `configured: false`；
引擎没在跑也能读写。

**响应：**

```json
{
  "ok": true,
  "data": {
    "configured": true,
    "settings": {
      "app_id_set": true,
      "app_secret_set": true,
      "sandbox": false,
      "allow_from": "OPEN_ID_1",
      "share_session_in_channel": false,
      "markdown_support": false
    }
  }
}
```

---

#### PATCH /api/v1/projects/{name}/qqbot/settings

保存局部更新：只改请求体里出现的字段，出现未知字段返回 `400`。布尔是三态：不传
就不动，显式传 `false` 会写成 `false`。

| 字段 | 类型 | 说明 |
|------|------|------|
| `app_secret` | string | 换 AppSecret；**留空或省略都表示保留原值**，不会被当成「删除凭据」 |
| `sandbox` | boolean | 连沙箱 API 而不是正式环境 |
| `share_session_in_channel` | boolean | 群成员共用一个会话 |
| `markdown_support` | boolean | 发 Markdown 消息（需要机器人在 QQ 后台有这个权限） |

`app_id` 不能从这里改：它是 Bot 的身份，面板不回显也不编辑，换号请重新添加 Bot。
`allow_from` 同样**不能**从这里写，只有 `PATCH /api/v1/projects/{name}` 的
`platform_allow_from` 能写；传了返回 `400`。

**请求体：**

```json
{
  "sandbox": true,
  "markdown_support": true
}
```

**响应：**

```json
{
  "ok": true,
  "data": {
    "message": "qqbot settings saved",
    "changed": ["sandbox", "markdown_support"],
    "restart_required": true,
    "settings": { "app_id_set": true, "sandbox": true, "markdown_support": true }
  }
}
```

`changed` 只列真正和已存值不同的字段；没有变化时 `restart_required` 是 `false`，
也不重写文件。适配器在项目启动时读这些选项，所以改动重启后生效。

错误：`404` 项目不存在，`400` 取值非法 / 没有 `qqbot` 平台 / 写了只读的
`allow_from`，`503` 管理接口没接上配置读写回调；配置读写失败一律 `500` 且只回
一句固定提示，细节进日志。

---

### 5.3 会话

会话是项目内的对话上下文。会话由 `session_key`（格式：`platform:chatId:userId`）标识，命名会话还可通过内部 `id` 标识（例如 `/new work` 会创建命名会话）。

#### GET /api/v1/projects/{name}/sessions

列出项目的会话列表。

**响应：**

```json
{
  "ok": true,
  "data": {
    "sessions": [
      {
        "id": "sess_abc123",
        "session_key": "telegram:123:456",
        "name": "work",
        "platform": "telegram",
        "active": true,
        "created_at": "2026-03-10T09:00:00Z",
        "updated_at": "2026-03-10T10:30:00Z",
        "history_count": 12
      }
    ]
  }
}
```

---

#### POST /api/v1/projects/{name}/sessions

创建新会话。

**请求体：**

```json
{
  "session_key": "telegram:123:456",
  "name": "work"
}
```

| 字段          | 类型   | 必填 | 说明                                      |
|---------------|--------|------|-------------------------------------------|
| `session_key` | string | 是   | 平台路由键（如 `telegram:123:456`）       |
| `name`        | string | 否   | 人类可读的会话名称                        |

**响应：**

```json
{
  "ok": true,
  "data": {
    "id": "sess_xyz789",
    "session_key": "telegram:123:456",
    "name": "work",
    "created_at": "2026-03-10T10:35:00Z"
  }
}
```

---

#### GET /api/v1/projects/{name}/sessions/{id}

返回会话详情，包含消息历史。

**路径参数：**

| 参数   | 类型   | 说明                          |
|--------|--------|-------------------------------|
| `name` | string | 项目名称                      |
| `id`   | string | 会话 ID 或 session_key        |

**查询参数：**

| 参数             | 类型 | 默认值 | 说明                    |
|------------------|------|--------|-------------------------|
| `history_limit`  | int  | 50     | 返回的历史条目上限      |

**响应：**

```json
{
  "ok": true,
  "data": {
    "id": "sess_abc123",
    "session_key": "telegram:123:456",
    "name": "work",
    "platform": "telegram",
    "active": true,
    "agent_session_id": "as_xxx",
    "created_at": "2026-03-10T09:00:00Z",
    "updated_at": "2026-03-10T10:30:00Z",
    "history": [
      {
        "role": "user",
        "content": "Hello",
        "timestamp": "2026-03-10T09:00:05Z"
      },
      {
        "role": "assistant",
        "content": "Hi! How can I help?",
        "timestamp": "2026-03-10T09:00:10Z"
      }
    ]
  }
}
```

---

#### DELETE /api/v1/projects/{name}/sessions/{id}

删除会话及其历史记录。

**响应：**

```json
{
  "ok": true,
  "data": {
    "message": "session deleted"
  }
}
```

---

#### POST /api/v1/projects/{name}/sessions/switch

切换指定 session_key 的活跃会话（例如用户有多个命名会话时）。

**请求体：**

```json
{
  "session_key": "telegram:123:456",
  "session_id": "sess_xyz789"
}
```

| 字段          | 类型   | 必填 | 说明                    |
|---------------|--------|------|-------------------------|
| `session_key` | string | 是   | 平台路由键              |
| `session_id`  | string | 是   | 要设为活跃的会话 ID     |

**响应：**

```json
{
  "ok": true,
  "data": {
    "message": "active session switched",
    "active_session_id": "sess_xyz789"
  }
}
```

---

#### POST /api/v1/projects/{name}/send

向会话发送消息。消息会像用户通过平台发送一样传递给 Agent。

**请求体：**

```json
{
  "session_key": "telegram:123:456",
  "message": "Review the latest commit"
}
```

| 字段          | 类型   | 必填 | 说明                    |
|---------------|--------|------|-------------------------|
| `session_key` | string | 是   | 平台路由键              |
| `message`     | string | 是   | 发送给 Agent 的文本     |

**响应：**

```json
{
  "ok": true,
  "data": {
    "message": "message sent"
  }
}
```

---

### 5.4 提供商

提供商是 API 后端（如 Anthropic、OpenAI、自定义端点），为项目的 Agent 提供 AI 模型。

#### GET /api/v1/projects/{name}/providers

列出提供商及其活跃状态。

**响应：**

```json
{
  "ok": true,
  "data": {
    "providers": [
      {
        "name": "anthropic",
        "active": true,
        "model": "claude-sonnet-4-20250514",
        "base_url": ""
      },
      {
        "name": "relay",
        "active": false,
        "model": "claude-sonnet-4-20250514",
        "base_url": "https://api.relay.example.com"
      }
    ],
    "active_provider": "anthropic"
  }
}
```

---

#### POST /api/v1/projects/{name}/providers

添加新提供商。

**请求体：**

```json
{
  "name": "relay",
  "api_key": "sk-xxx",
  "base_url": "https://api.relay.example.com",
  "model": "claude-sonnet-4-20250514",
  "thinking": "disabled",
  "env": {
    "CLAUDE_CODE_USE_BEDROCK": "1",
    "AWS_PROFILE": "bedrock"
  }
}
```

| 字段        | 类型           | 必填 | 说明                                          |
|-------------|----------------|------|-----------------------------------------------|
| `name`      | string         | 是   | 提供商标识符                                  |
| `api_key`   | string         | 否*  | API 密钥（*未提供 `env` 时为必填）            |
| `base_url`  | string         | 否   | 自定义 API 端点                               |
| `model`     | string         | 否   | 模型覆盖                                      |
| `thinking`  | string         | 否   | `"disabled"` 表示提供商不支持自适应思考      |
| `env`       | object (k/v)   | 否   | 额外环境变量                                  |

**响应：**

```json
{
  "ok": true,
  "data": {
    "name": "relay",
    "message": "provider added"
  }
}
```

---

#### DELETE /api/v1/projects/{name}/providers/{provider}

移除提供商。无法移除当前活跃的提供商，需先切换。

**响应：**

```json
{
  "ok": true,
  "data": {
    "message": "provider removed"
  }
}
```

**错误（400）：**

```json
{
  "ok": false,
  "error": "cannot remove active provider; switch to another first"
}
```

---

#### POST /api/v1/projects/{name}/providers/{provider}/activate

切换活跃提供商。

**响应：**

```json
{
  "ok": true,
  "data": {
    "active_provider": "relay",
    "message": "provider activated"
  }
}
```

---

#### GET /api/v1/projects/{name}/models

列出项目 Agent 类型可用的模型。

**响应：**

```json
{
  "ok": true,
  "data": {
    "models": [
      "claude-sonnet-4-20250514",
      "claude-3-5-sonnet-20241022",
      "claude-3-opus-20240229"
    ],
    "current": "claude-sonnet-4-20250514"
  }
}
```

---

#### POST /api/v1/projects/{name}/model

设置项目使用的模型。

**请求体：**

```json
{
  "model": "claude-3-5-sonnet-20241022"
}
```

**响应：**

```json
{
  "ok": true,
  "data": {
    "model": "claude-3-5-sonnet-20241022",
    "message": "model updated"
  }
}
```

---

### 5.5 定时任务

#### GET /api/v1/cron

列出所有定时任务，可按项目筛选。

**查询参数：**

| 参数      | 类型   | 说明        |
|-----------|--------|-------------|
| `project` | string | 按项目筛选  |

**响应：**

```json
{
  "ok": true,
  "data": {
    "jobs": [
      {
        "id": "cron_abc123",
        "project": "my-backend",
        "session_key": "telegram:123:456",
        "cron_expr": "0 6 * * *",
        "prompt": "Summarize GitHub trending",
        "exec": "",
        "work_dir": "",
        "description": "Daily GitHub Trending",
        "enabled": true,
        "silent": true,
        "created_at": "2026-03-10T08:00:00Z",
        "last_run": "2026-03-10T06:00:00Z",
        "last_error": ""
      }
    ]
  }
}
```

---

#### POST /api/v1/cron

添加定时任务。必须提供 `prompt` 或 `exec` 之一，不可同时提供。`session_key` 两类任务都必填：任务到点后要把开始提醒和结果发到那个会话，没填会被直接拒成 `400 session_key is required`（以前是先存下、到点才失败）。

**请求体（prompt 任务）：**

```json
{
  "project": "my-backend",
  "session_key": "telegram:123:456",
  "cron_expr": "0 6 * * *",
  "prompt": "Summarize GitHub trending",
  "description": "Daily GitHub Trending",
  "silent": true
}
```

**请求体（exec 任务）：**

```json
{
  "project": "my-backend",
  "session_key": "telegram:123:456",
  "cron_expr": "0 9 * * 1",
  "exec": "npm run weekly-report",
  "work_dir": "/path/to/project",
  "description": "Weekly Report",
  "silent": false
}
```

| 字段          | 类型    | 必填 | 说明                                        |
|---------------|---------|------|---------------------------------------------|
| `project`     | string  | 否*  | 项目名称（*多项目时为必填）                 |
| `session_key` | string  | 是   | 任务到点后回报的会话（`平台:聊天[:用户]`，如 `qq:10001`）；exec 任务也必填 |
| `cron_expr`   | string  | 是   | Cron 表达式（5 或 6 个字段）                |
| `prompt`      | string  | 否*  | 要发送的 prompt（*未提供 `exec` 时为必填）  |
| `exec`        | string  | 否*  | Shell 命令（*未提供 `prompt` 时为必填）     |
| `work_dir`    | string  | 否   | exec 的工作目录                             |
| `description` | string  | 否   | 人类可读的标签                              |
| `silent`      | boolean | 否   | 是否隐藏启动通知                            |
| `session_mode` | string | 否   | `reuse`（默认）或 `new_per_run`：每次运行新建 agent 会话 |
| `timeout_mins` | int    | 否   | 单次调度最长等待：省略=30 分钟，`0`=不限制 |

**响应：**

```json
{
  "ok": true,
  "data": {
    "id": "cron_xyz789",
    "project": "my-backend",
    "session_key": "telegram:123:456",
    "cron_expr": "0 6 * * *",
    "prompt": "Summarize GitHub trending",
    "description": "Daily GitHub Trending",
    "enabled": true,
    "created_at": "2026-03-10T10:40:00Z"
  }
}
```

---

#### DELETE /api/v1/cron/{id}

删除定时任务。

**响应：**

```json
{
  "ok": true,
  "data": {
    "message": "cron job deleted"
  }
}
```

#### POST /api/v1/cron/{id}/exec

立即触发一个已存在的 cron 任务。即使任务已禁用，仍然允许手动触发。
`/api/v1/cron/{id}/run` 作为兼容别名仍可使用。

**响应：**

```json
{
  "ok": true,
  "data": {
    "id": "cron_xyz789",
    "status": "triggered"
  }
}
```

---

### 5.6 心跳

心跳在会话中定期执行 prompt（如「检查收件箱」），使 Agent 持续感知环境状态。

#### GET /api/v1/projects/{name}/heartbeat

返回心跳状态。

**响应：**

```json
{
  "ok": true,
  "data": {
    "enabled": true,
    "paused": false,
    "interval_mins": 30,
    "only_when_idle": true,
    "session_key": "telegram:123:456",
    "silent": true,
    "run_count": 42,
    "error_count": 0,
    "skipped_busy": 5,
    "last_run": "2026-03-10T10:00:00Z",
    "last_error": ""
  }
}
```

---

#### POST /api/v1/projects/{name}/heartbeat/pause

暂停心跳。

**响应：**

```json
{
  "ok": true,
  "data": {
    "message": "heartbeat paused"
  }
}
```

---

#### POST /api/v1/projects/{name}/heartbeat/resume

恢复心跳。

**响应：**

```json
{
  "ok": true,
  "data": {
    "message": "heartbeat resumed"
  }
}
```

---

#### POST /api/v1/projects/{name}/heartbeat/run

立即触发一次心跳（单次执行）。

**响应：**

```json
{
  "ok": true,
  "data": {
    "message": "heartbeat triggered"
  }
}
```

---

#### POST /api/v1/projects/{name}/heartbeat/interval

设置心跳间隔。

**请求体：**

```json
{
  "minutes": 15
}
```

**响应：**

```json
{
  "ok": true,
  "data": {
    "interval_mins": 15,
    "message": "interval updated"
  }
}
```

---

### 5.7 Bridge

#### GET /api/v1/bridge/adapters

列出已连接的 Bridge 适配器（通过 WebSocket 连接的外部平台）。

**响应：**

```json
{
  "ok": true,
  "data": {
    "adapters": [
      {
        "platform": "custom",
        "project": "my-backend",
        "capabilities": ["text", "images", "files"],
        "connected_at": "2026-03-10T09:00:00Z"
      }
    ]
  }
}
```

---

### 5.8 说说与头像（可选）

这两个接口以机器人自己的 QQ 号身份对外生效：说说别人看得见，头像处处看得见。所以
**默认关闭**，必须在项目的 qq 平台选项里显式打开：

```toml
[projects.platforms.options]
allow_qzone = true    # 查/发/删这个号自己的说说
allow_avatar = true   # 换这个号自己的头像
```

能力判断按接口而不是平台名：项目里的平台没实现这个能力时返回 `not_supported`，不靠平台名猜。
这里没有任何定时动作——定时发是定时任务那一节的事，两个决定分开。

#### GET /api/v1/projects/{name}/social

读出能力开关和这个号最近的说说（新的在前）。

**查询参数：** `limit` — 读几条（默认 20，最多 50）。

**响应：**

```json
{
  "ok": true,
  "data": {
    "status": "ready",
    "platform": "qq",
    "capabilities": {
      "list_moments": true,
      "post_moment": true,
      "remove_moment": true,
      "replace_moment": true,
      "set_avatar": true,
      "disabled_reason": ""
    },
    "moments": [
      {
        "id": "d43708d9240ae56ae9670e00",
        "text": "今天画了张图",
        "time": "2026-11-05T06:21:06+08:00",
        "images": [],
        "private": false,
        "private_known": true
      }
    ]
  }
}
```

`status` 取值：

| status | 含义 |
|--------|------|
| `ready` | 已打开，`moments` 是列表 |
| `off` | 能力在，但配置没打开；`message` 指明是哪个配置项 |
| `error` | 读列表失败；`message` 说明原因，写操作仍按 `capabilities` 走 |
| `not_supported` | 这个项目的平台根本做不了 |

`moments` 永远是数组（`[]` 而不是 `null`），面板可以直接读 `.length`。

`private` 和 `private_known` 是两个字段，不是一个。`private_known: true` 表示平台真的回答了：
`private: false` 是「所有人可见」，`private: true` 是「仅部分人可见（或只有自己）」。
`private_known: false` 表示它**没有回答**——这时 `private` 没有意义，调用方不能把它读成
「公开」。QQ 那边的来源是 `get_qzone_msg_list` 每行的 `is_private`：这一行没有这个字段，
或者值不是布尔 / 数字 / 纯数字字符串，就按「不知道」返回。

这个字段还有一个**它说不了**的事，换说说时很关键：SnowLuma 那条路径上 `is_private` 是必填
布尔，所以它几乎总在；而上游在它派生自的原始 `secret` 缺失时会把值补成 `false`。因此一行
`private: false` 既可能是「真的所有人可见」，也可能是「压根没读到」，在这里两者无法区分。
请把 `private_known && !private` 读成「没有任何迹象显示它是有范围的」，而不是「已经证明它
是公开的」。

---

#### POST /api/v1/projects/{name}/social/moment

发一条说说（目前只发文字；带图走 QQ 客户端自己的路径）。

**请求体：**

```json
{ "text": "今天画了张图" }
```

**响应：**

```json
{ "ok": true, "data": { "moment": { "id": "stub01", "text": "今天画了张图", "time": "2026-11-05T06:21:06+08:00", "images": [], "private": false, "private_known": true } } }
```

错误：`400` 文字为空、`403` 没打开（消息里点名 `allow_qzone`）、`501` 平台做不了、
`502` 上游拒绝（消息里带上游 action，扩展不存在时提示升级 NapCat）。

---

#### POST /api/v1/projects/{name}/social/moment/replace

换说说：把一个已有的说说改成新的文字。它是一次调用里的一个动作，不是让面板自己
「先发一条、再删一条」——那样中途失败会留下两条或者零条。

**请求体：**

```json
{ "id": "d43708d9240ae56ae9670e00", "text": "换了个说法", "accept_audience_change": true }
```

`accept_audience_change` 是必填的，缺省为 `false`：不带它或不等于 `true` 时接口回 `400`，
一个上游请求都不发。它代表调用方问过人、人知道「换一条可能改变谁能看见、而且删掉旧的之后
回不去」并且同意了。为什么这件事不能由服务端自己决定，见下面的**可见范围**。

**响应：**

```json
{ "ok": true, "data": { "moment": { "id": "new-tid", "text": "换了个说法", "time": "2026-11-08T06:00:00+08:00", "images": [], "private": false, "private_known": true } } }
```

**顺序与失败**（重要）：QQ空间的接口里没有「改一条说说的正文」，只有发、删、读和改权限。
所以这里的实现是**先发新的、成功了才删旧的**，顺序不能反。**这不是原子替换**，三种结果：

1. **干净换完**：新的发出去了、旧的也删掉了 → `200`，`data.moment` 是新那条。
2. **发新的失败** → 旧的**原样保留**，回非 2xx，消息里写明「旧的原样保留」。什么都没多发。
3. **部分成功**：新的发出去了，但旧的没删掉（或者上游没给新 tid，没法确认删对了哪条）→
   回非 2xx，`ok:false`，消息里写明「现在空间里有两条」/「可能现在有两条」，**并在同一个
   响应体里带上 `moment`**（新那条），面板据此提示并重新读列表：

```json
{ "ok": false, "error": "换说说：新的已经发出（tid=…），但旧的 … 没删掉，现在空间里有两条", "moment": { "id": "new-tid", "text": "…" } }
```

这种状态下**再点一次换说说会再多一条**，面板不会自动重试；要先把多的那条删掉。

**配图**：换说说只改文字，不接收图片参数。旧说说带的图由平台自己读回来（最近 50 条里
按 tid 找），再随新说说一起发出去，所以「换一条」不会把图弄丢。读不回旧说说时（太老、
不在最近 50 条里、或列表读失败）**一个新请求都不发**，直接失败并保留原文——宁可不换，
也不发一条没图的再把带图的删掉。一行说它有图、其中一张却没给地址时也一样：把其余几张
带过去、少掉那一张，等于删了一张调用方没同意删的图，所以同样一个请求都不发。

**可见范围**：「这一条谁能看见」有三种回答，它们不能互相替代。前两种**直接拒绝（400，
线上是 `ErrSocialCannotReplace`「这条不能这么换」），一个上游请求都不发**：

- `private_known: false`——列表这一行没说，说明这份响应不是我们认识的形状。既可能本来是
  公开的，也可能本来是「仅部分人可见」，两种都同样活着：不是可信的「所有人」，所以不发也不删。
- `private: true`——原来那条是「仅部分人可见」。上游只给一个布尔（`is_private`，来自
  `secret` 是否为 0），分不出好友可见、部分好友、仅自己、部分不可见这四种，而发说说不传
  `ugc_right` 时的缺省值是 1（所有人可见）。照这样换等于把有范围限制的说说变成公开的，
  删掉旧的之后不可逆。**这一种即使 `accept_audience_change: true` 也照样拒绝**：它不是
  「可能改宽」，是确定改宽。要改就在 QQ 里手动改。

第三种回答是 `private_known: true, private: false`——`accept_audience_change` 就是为它存在的。
上游这个布尔是从原始的 `secret` 翻出来的，而 `secret` 缺失时它会**补一个 `false`**。所以桥接
收到的这个值有两种来源，逐字节相同：

- 这条真的所有人可见（`secret` 是 0），或者
- 上游压根没读到可见范围，直接用了自己的缺省值。

响应里没有第二份东西能把它们分开：`get_qzone_msg_detail` 既不返回图片也不返回可见范围，
native 那种列表形状也没有这个字段，整行就一个布尔。与其把「从网上飘过来的缺省值」当成
「可以把它改宽然后删掉原来的」的授权，不如把这件事问回调用方：只有传了
`accept_audience_change: true`（即已经告诉过人、人同意了）才走发新删旧；不带就是 `400`，
不写上游。带了之后就是一次普通的换说说，没有别的附加条件。

面板在同一件事上多挡一层：编辑器里有一个默认不勾的勾选框（「我知道换一条可能会改变谁能看见
这条」），每次打开编辑器都清空，不勾住保存按钮就是禁用的。

**读列表**：QQ 这边是有意要 `get_qzone_msg_list` 的 `format=snowluma`。不传 `format` 时，
上游一见到 cursor 就换另一种格式，而那种既没有可见范围字段、图片又是另一个形状——正好
是换说说需要的两样。

**带不过去的还有**：评论、点赞、发布时间、`tid` 都会变——换说说本质是「发新的、删旧的」，
不是原地编辑。这一点面板的确认文案里也写了。

能力开关是 `capabilities.replace_moment`；平台没实现 `MomentReplacer` 时面板不显示按钮、
接口回 `501`。

错误：`400` 缺 `id`、文字为空，或 `accept_audience_change` 不是 `true`（这一种什么都不发，
连旧说说都不去读）；`403` 没打开（消息里点名 `allow_qzone`；和发说说一致——它排在确认之前，
因为关着的时候确认了也没用）；`501` 平台不能换；`502` 上游拒绝（部分成功的 `moment` 见上）。

---

#### POST /api/v1/projects/{name}/social/moment/delete

删掉自己的一条说说。已经不在的也算删掉。

**请求体：**

```json
{ "id": "stub01" }
```

**响应：**

```json
{ "ok": true, "data": { "result": "deleted" } }
```

---

#### POST /api/v1/projects/{name}/social/avatar

换这个号的头像。

**请求：** `multipart/form-data`，字段名 `file`。接受嗅探为 `image/*` 的文件，最大 2 MiB。

**响应：**

```json
{ "ok": true, "data": { "result": "changed", "mime": "image/png", "bytes": 94 } }
```

错误：`400` 不是图片或文件为空、`403` 没打开（消息里点名 `allow_avatar`）、`413` 超过 2 MiB、
`501` 平台不能换头像。

---

### 5.9 生图（可选）

按需开启：`config.toml` 里没有 `[image_gen]`（`enabled = true` 且 `[image_gen.openai] api_key`
填好）时，这些接口一律回 `not_configured`。不自动生图，也不往任何频道发图：图片写进
`<data_dir>/images`，拿到路径的人自己决定怎么用。只支持 OpenAI 兼容的 `/images/generations`。

`out_dir` 必须落在 `data_dir` 下（默认就是 `<data_dir>/images`），指到外面会被拒绝：状态回
`error`，一张也不画。下面的取图接口不带 token，它能碰到的目录就是安全边界。图片文件名是
`gen-<YYYYMMDD-HHMMSS>-<8 位十六进制>.png`，随机后缀是为了让同一秒画完的两张不会互相覆盖。

`POST` 还要求管理 API 设了 `token`（没设回 `403`）：读不要紧，画图花的是主人的钱，token 空着
等于这个端口对整个网段敞开。

#### GET /api/v1/image-gen

**响应：**

```json
{
  "ok": true,
  "data": {
    "status": "ready",
    "can_draw": true,
    "provider": "openai",
    "model": "gpt-image-1",
    "base_url": "https://api.openai.com/v1",
    "out_dir": "/home/me/.bothouse/images",
    "api_key_set": true,
    "pictures": [
      { "name": "gen-20261105-052031-3f9a1c02.png", "file": "/home/me/.bothouse/images/gen-20261105-052031-3f9a1c02.png",
        "url": "/api/v1/image-gen/file/gen-20261105-052031-3f9a1c02.png", "bytes": 1384211, "mime": "image/png",
        "seconds": 24.3, "model": "gpt-image-1" }
    ]
  }
}
```

`status` 是 `ready`、`not_configured` 或 `error`（带 `message`）；`api_key_set` 只说明有没有填密钥，
密钥本身永不返回。`base_url` 照实给出端点（主机、路径、`size` 这类参数都保留），但写在里面的
凭据换成 `***`：`https://user:sk-…@relay/v1` 回 `https://***@relay/v1`，`…?token=sk-…` 回
`…?token=***`。`token`、`api_key`、`secret`、`password`、`signature` 一类参数名（含 `x-api-key`
这种写法）都按凭据处理，别的参数不动。出错时（请求失败、服务商报错原文、下载图片失败）报错
文字里的 URL 也先这样脱敏再返回。

#### POST /api/v1/image-gen

```json
{ "prompt": "一只戴眼镜的橘猫，像素头像" }
```

**响应：** 画好的那张图，字段同上。`prompt` 为空或全空白时 `400`（一个字节也不会发去服务商），
管理 API 没设 `token` 时 `403`（画图要花钱，读可以免，花钱必须验身份），上一张还没画完时 `409`
（排队会给主人多买一张），没配置或 `out_dir` 不在 `data_dir` 下时 `503`，服务商拒绝时 `502`
（错误信息带状态码和服务商原文）。

#### GET /api/v1/image-gen/file/<name>

图片字节，和 `library/avatar-image` 一样**不要 token**（`<img>` 带不了 `Bearer` 头）。
只认本服务自己写出的普通文件名，其余 `404`：名字里带分隔符或 `..`、符号链接（哪怕指向
`out_dir` 里的文件）、真实路径跑出 `out_dir` 的文件、嗅探出来不是 `image/*` 的文件，一律不认。

---

### 5.10 Plugins（DSH profile）

列出 DSH 那份 profile 里已有的插件，并提供三个真正要用的写操作：装一个包（`dsh plugin --profile <profile> add`，跟用户自己在终端敲的是同一条命令）、开关一个 bundle、卸掉一个包（在一个 profile 锁里调 DSH 自己的 `runProfilePnpm` 跑 `pnpm remove`，理由见本节的卸载小节）。这页是 profile 文件的窗口（`package.json` 的依赖 + `dsh.profile.bundles`），不是第二份注册表：DSH 自己的插件页读写的就是同一批文件，两边一致。

两个写操作都要求管理 API 设了 token。没设时路由直接回 `403`：没认证的管理端口分不清谁是这台机器的主人。

插件页的「打开 DSH 配置插件」复用现有启动和认证入口。在 DSH 左侧选择「插件」，打开插件提供的配置表单后编辑并保存；未提供表单的插件按其文档配置。配置保存由 DSH 原生实现处理，本接口不另存一份配置。面板直接打开和嵌在 DSH 侧栏时分别沿现有代理路径及同源路径进入。

#### GET /api/v1/plugins

**响应：**

```json
{
  "ok": true,
  "data": {
    "profile": "web",
    "profile_dir": "/Users/me/.dsh/profiles/web",
    "can_install": true,
    "writes_allowed": true,
    "allow_non_registry": false,
    "registry": "https://registry.npmjs.org/",
    "plugins": [
      {
        "name": "@deepseek-ai/dsh-base",
        "version": "0.2.1-rc.5",
        "description": "DSH base surface",
        "layer": true,
        "client_only": false,
        "enabled": true,
        "shipped": true,
        "rows": [{"id": "web", "name": "@deepseek-ai/dsh-web", "disabled": false}]
      }
    ]
  }
}
```

`shipped` 表示这个 bundle 来自 DSH 安装本身而不是这份 profile：它们是面板自己的层，照样列出来，但页面不给开关。没有声明 `dsh.bundle` 的依赖 `layer: false`：装上了，但 DSH 不会把它当插件加载。`client_only`（#1376 新增）把两种非 layer 依赖分开：`true` 表示这个包声明了 `dsh.client`（至少读到 `platform`），即安装脚本装进 profile、由 DSH 渲染的客户端 UI 包（如 `@deepseek-ai/dsh-experimental-client-ui-discord`）；`false` 表示两段都没有，是纯依赖（如 `is-odd`）。它特意单列一个字段：`layer: false` 仍然只表示「不是 bundle」，`client_only` 不会把它变成 bundle。客户端 UI 包在这页没有开关——DSH 能不能关掉它不是这页要回答的事。

#### GET /api/v1/plugins/inspect?spec=<包规格>

装之前先说明要装的是什么。不写任何文件，也不跑任何进程。

```json
{
  "ok": true,
  "data": {
    "spec": "demo-bundle@next",
    "name": "demo-bundle",
    "kind": "registry",
    "version": "0.4.2",
    "registry": "https://registry.npmjs.org/",
    "publisher": "publisher-x",
    "description": "Demo bundle",
    "bundle": true,
    "runtime": "0.2.1-rc.5",
    "requires": "engines.dsh ^0.2.0",
    "compatible": true,
    "required": "插件和面板、agent 在同一个进程里跑，没有单独的沙箱：…",
    "allowed": true
  }
}
```

- `kind` 是 `registry` / `git` / `tarball` / `path` 之一。只有 `registry` 默认能装；其余来源要 `[plugins] allow_non_registry = true`，否则 `allowed: false` 并给出 `reason`，`POST /plugins/install` 也会回 `403`。
- `compatible` 只在声明的 `engines.dsh`（或 `@deepseek-ai/dsh` peer）范围是本实现认识的写法时出现。没有这个字段表示「交给 DSH 在装的时候核」——装前瞎猜一个答案是更糟的。
- `required` 是装上后能做什么。DSH 插件和面板、agent 在同一个进程里跑，没有按插件划分的沙箱。
- `error` 表示这次读 registry 失败。仍然可以尝试安装，最终以这次运行自己的输出为准。

#### POST /api/v1/plugins/install

```json
{"spec": "demo-bundle@1.2.3"}
```

默认只收 npm registry 的包名：小写、可带 `@scope/`、可带 `@版本` 或标签、最多 214 字符、不能以 `-` 开头。`git:`/`github:` 简写、git URL、`http(s)://…tgz`、`file:`/`link:`/绝对路径是另一种风险（内容不是 registry 发布的那一份），要同时打开配置开关并在页面上再确认一次。

响应是 NDJSON 流（冷缓存时安装要几分钟）：

```
{"line": "Progress: resolved 1, reused 0, downloaded 0, added 0"}
{"done": true, "state": { …同 GET /plugins… }}
```

失败时最后一行带 `error`（pnpm 原话）和 `kind`，页面翻成中文：`pnpm-missing`、`build-blocked`、`not-found`、`no-matching-version`、`disk-full`、`permission`、`integrity`、`network`、`timeout`、`unknown`。

版本门禁拒绝是 `kind: "incompatible"`。这种失败 DSH 自己会打出确切的放行命令，最后一行同时带 `allow_version`（DSH 没打就是空串）：

```
{"error": "…", "kind": "incompatible", "log": "…",
 "allow_version": "dsh plugin --profile web allow-version dsh-ops@0.5.2 --dsh-version 0.2.1-rc.5 --accept-risk"}
```

页面只把这句话显示出来，不会替你执行：放行是 DSH 自己的精确版本豁免，只对那个包的那个运行时版本有效，要不要承担命令里写的风险由人决定。

#### POST /api/v1/plugins/switch

```json
{"name": "some-bundle", "enabled": false}
```

只改 profile `package.json` 里 `dsh.profile.bundles` 这一段，其余字节原样保留；用的是 DSH 和 `dsh plugin` 同一个 `package.json.lock`，改之前先写一份带时间戳的备份。不卸载任何东西，所以再开回来就恢复原状。profile 本来就是那个状态时 `changed: false`。

`@deepseek-ai/dsh-base` 会被拒：它是面板本体，关掉就没有界面了。两个写操作都要重启 DSH 才生效，响应里 `restart_required: true`。

#### POST /api/v1/plugins/uninstall

```json
{"name": "some-bundle", "confirm": "some-bundle"}
```

把这份 profile 的一个依赖卸掉。成功的响应：

```json
{"uninstalled": true, "restart_required": true, "state": {"…同 GET /api/v1/plugins…"}}
```

`uninstalled: true` 说的是**这次操作在 profile 里留下的结果**：服务端在放锁之前重读
`package.json`，`dependencies` 里没有这个包、`dsh.profile.bundles` 里也没有它，才算卸掉了。
`dsh plugin remove`（或它启动的 pnpm）退出码是 0 但 profile 还列着这个包时，回答的不是成功，
而是 409 `unknown`：面板依据的是文件，不是子进程的自述。

`name` 必须是 profile `dependencies` 里的精确包名，不接受 `name@version`、前缀或模糊匹配。
`confirm` 必须**等于 `name`**：页面是让人在弹窗里把包名打一遍才发这个字段，服务端不接受
`true` / `1` / 空。

卸载和安装抢同一个 `package.json.lock`。这里的做法是**一个临界区**：服务端先拿到锁，然后在锁里
依次做完 ① 下面那三道检查 ② 调 DSH 自己的 `runProfilePnpm` 跑 `pnpm remove`，由它的
`reconcile()` 把该包从 `dsh.profile.bundles` 里摘掉 ③ 重读 profile 核对结果，最后才放锁。
它**不是**一次 `dsh plugin --profile <profile> remove`：那条命令自己会去拿同一把锁，在桥已经
持锁的情况下再起它，父子互相等锁，就是死锁。所以桥起的是一个内嵌脚本，脚本直接调
`runProfilePnpm`（`dsh plugin` 在锁内用的正是这个函数），不碰锁。Unix 上 helper 使用独立于
桥的进程组，超时杀该组；Windows 上先把 helper 纳入 Job，再喂入脚本，取消时复用
`taskkill /T /F` 并终止 Job，确认其中活跃进程数归零后才放锁。即使 helper 已退出，Job 仍追踪
pnpm 的后代。归零等待有上限（与卸载的 5 秒管道等待同量级）：超过上限仍不归零时返回错误并
保留 profile 写锁。锁里记的是桥自己的 PID；桥 PID 消失仅使该锁满足已有机制的接管条件，
不能证明旧 helper、pnpm 及其后代已经停止写入。恢复前须先确认这些进程均已退出且不再写
profile，再按已有锁机制恢复；未确认时应保持停止写入并排查。单独重启桥不能保证安全恢复。

检查（第 ① 步，都在锁里、都在起进程之前做完）：

| 拦下的是 | HTTP | `kind` | 文案 |
| --- | --- | --- | --- |
| 内置层（`@deepseek-ai/dsh-base`） | 403 | `not-removable` | dsh-base 是 DSH 的面板本体，卸掉就没有界面可用了。 |
| 从 DSH 安装目录 `link:` 进来的层（如 `@deepseek-ai/dsh-web-app`） | 403 | `not-removable` | 这一层随 DSH 一起安装，不能在这里卸载。 |
| profile 里没有这个名字 | 404 | `not-installed` | 这份 profile 里没有这个包。 |
| 还被别的包依赖 | 409 | `in-use` | 「A、B 还在用它，先卸载 A、B。」（响应另带 `in_use_by: ["A","B"]`） |
| `confirm` 与 `name` 不一致 | 400 | `confirm-mismatch` | 包名不对，再输一次。 |

被依赖时只拦、不连带卸。反向依赖扫的是 profile 的 `node_modules/<pkg>/package.json` 和
`node_modules/@<scope>/<pkg>/package.json` 里的 `dependencies` / `peerDependencies` /
`optionalDependencies`，不用 `pnpm why`：对 `link:` 包它会返回空，看不出谁在依赖。

第 ②③ 步的结果按下面的表翻成页面上的那句话，**不把 pnpm 的英文原话交给页面**：

| 发生了什么 | HTTP | `kind` |
| --- | --- | --- |
| pnpm 报 `ERR_PNPM_CANNOT_REMOVE_MISSING_DEPS`（这个包其实不在依赖里） | 403 | `not-removable` |
| 这份 profile 里还有上一次安装/卸载留下的进程没退（DSH 的运行记录还指着一个活着的进程） | 409 | `unknown` |
| 这份 DSH 没带插件管理器（版本太旧或装不完整） | 409 | `unknown` |
| 找不到 pnpm，或这台电脑没有能跑卸载的 Node | 409 | `unknown` |
| 桥自己的超时到了，卸载进程树已清理完成 | 409 | `timeout` |
| 命令说做完了，但 profile 里还列着它 | 409 | `unknown` |
| 其他 | 409 | `unknown` |

卸载要重启 DSH 才生效（DSH 只在启动时读 `dsh.profile.bundles`），所以成功的响应里
`restart_required` 固定为 `true`。

这次不做：回滚/撤销、批量卸载、清 pnpm 内容寻址 store、清 `.plugin-manager/logs`、清孤儿
`cordis.patch.yml` 覆盖、卸完自动重启 DSH。

#### GET /api/v1/plugins/config?id=<行 id>

```json
{
  "ok": true,
  "data": {
    "id": "demo-tool",
    "name": "demo-tool",
    "layer": "bundle",
    "editable": true,
    "config_yaml": "dataDir: !!js process.env.DEMO_DATA || (process.env.HOME + '/.demo')",
    "overridden": false
  }
}
```

读一行插件自己的 config。`id` 是 `GET /api/v1/plugins` 里某一行的 id，不是包名。

`config_yaml` **是 YAML 文本，不是 JSON 对象**，这是故意的：字段归插件所有、由插件自己校验，而且值可能是 DSH 启动时求值的 `!!js` 表达式。把 config 解码成 JSON 再编码回去，会把 `!!js process.env.X` 变成它渲染出来的那个字符串，悄悄改掉用户文件的意思。所以面板按文本给、按文本收，`!!js` 标签原样不动。

`layer` 说明当前生效的值来自哪一层（顺序就是 DSH 的叠加顺序）：

| `layer` | 含义 |
| --- | --- |
| `bundle` | 插件自带的 patch；在这里存一份就是往 profile patch 写覆盖 |
| `profile` | 这份 profile 的 `cordis.patch.yml`，也就是保存写的地方（`overridden: true`） |
| `home` | `$DSH_HOME/cordis.patch.yml`，在 profile 之后生效、对所有 profile 都生效 |
| `none` | 没人设过，这一行用插件代码里的默认值（`config_yaml` 为空） |

插件自带的 patch 读不出来时是报错，不是 `none`：「没人设过」和「读不出是谁设的」要做的事不一样，只有前一种才能安全地显示成空框。

`editable` 只有 `home` 这一种情况是 `false`：在那儿写 profile 看着像存上了其实不生效，响应里带 `reason` 指明该改哪份文件。

#### POST /api/v1/plugins/config

```json
{"id": "demo-tool", "config_yaml": "dataDir: /srv/demo\nverbose: true\n"}
```

把这段文本写成该行的 `config`，落在 profile 的 `cordis.patch.yml` 里：已有覆盖就替换（不会追加第二条），本来没有就追加一条 `- id:`。文件里别的东西都保留——其它条目、它们的顺序、注释、`!!js` 标签。整个读-改-写跑在 profile 的 `package.json.lock` 上（DSH 和 `dsh plugin` 同一个锁），所以 DSH 自己的插件页同时改也不会被覆盖掉。写之前留一份带时间戳的 `.bak-`，文件仍是 `0600`。存进去的内容和文件里已有的完全一样时不算改动：返回 `changed: false`，也不再多留 `.bak-`，所以反复存同一段不会堆出一排备份。

`config_yaml` 传空串表示**删掉该行在 profile 中的所有配置覆盖**（条目没有注释和其它设置时才移除条目），回到 bundle 层原本的值。以下情况返回 `400`：不是合法 YAML、不是「字段: 值」的映射、行 id 不存在、这一行受 HOME 控制。空映射 `{}` 是有效覆盖。JavaScript 语法与字段校验交给 DSH／插件；编辑器保留表达式，不执行它。保存成功仅表示已经写入，不代表插件一定接受该配置。和其它 profile 写操作一样，下次 DSH 启动才生效（`changed` 时 `restart_required: true`）。

和安装、开关一样要 management token：没设 token 的管理 API 分不清谁是主人，而这个接口改的是这台机器会加载什么。

---

## 6. 错误处理约定

### 6.1 标准错误响应

所有错误使用相同封装格式：

```json
{
  "ok": false,
  "error": "human-readable message"
}
```

### 6.2 常见错误

| HTTP | 错误消息示例                                  | 原因                          |
|------|-----------------------------------------------|-------------------------------|
| 400  | `"project is required (multiple projects)"`   | 缺少必填参数                  |
| 400  | `"either prompt or exec is required"`         | 定时任务请求体无效            |
| 401  | `"unauthorized: missing or invalid token"`    | 认证失败                      |
| 404  | `"project not found: xyz"`                    | 未知项目/会话/定时任务       |
| 404  | `"session not found"`                         | 未知会话 ID                   |
| 405  | `"method not allowed"`                       | HTTP 方法错误                 |
| 500  | `"internal error"`                           | 服务器意外错误                |

### 6.3 校验错误

当请求体验证失败时：

```json
{
  "ok": false,
  "error": "invalid request: session_key is required"
}
```

---

## 7. Session Key 格式

`session_key` 是用于将消息路由到正确平台和会话的复合标识符：

```
<platform>:<chat_id>:<user_id>
```

示例：

- `telegram:123456789:123456789` — Telegram 用户 123456789，会话 123456789
- `feishu:ou_xxx:chat_yyy` — 飞书用户与会话
- `slack:C01234:U05678` — Slack 频道与用户
- `discord:123456789:987654321` — Discord 服务器与用户

多工作区模式下，格式可能包含工作区前缀：

```
<workspace>:<platform>:<chat_id>:<user_id>
```

---

## 8. CORS

当管理 API 被 Web 控制台调用时，CORS 头应可配置。建议的配置扩展：

```toml
[management]
enabled = true
port = 9820
token = "mgmt-secret"
cors_origins = ["http://localhost:3000", "https://dashboard.example.com"]
```

若未配置，CORS 可能被禁用或使用默认值（例如仅同源时为 `*`）。

---

## 9. 更新日志

| 版本       | 日期       | 变更                    |
|------------|------------|-------------------------|
| 1.0-draft  | 2026-03-10 | 初始规范                |
| 1.1-draft  | 2026-11-05 | 新增可选的 QQ 说说 / 头像接口（`/projects/{name}/social…`），`allow_qzone` / `allow_avatar` 未打开时不生效 |
| 1.1-draft  | 2026-11-08 | 新增 `POST /projects/{name}/social/moment/replace`（换说说，先发新再删旧）与 `capabilities.replace_moment`；仅部分人可见的旧说说拒绝替换；`Moment` 增 `private_known`：读不到可见范围时也拒绝替换，不按公开处理 |
| 1.1-draft  | 2026-11-08 | 换说说改为必须带 `accept_audience_change: true`：上游在 `secret` 缺失时会把 `is_private` 补成 `false`，单看这一行分不出「真的公开」和「没读到」，改宽可见范围这件事不再由缺省值决定 |
| 1.2-draft  | 2026-11-05 | 新增可选的生图接口（`/image-gen`、`/image-gen/file/<name>`） |
| 1.2-draft  | 2026-11-09 | 新增 `POST /plugins/uninstall`：卸载 profile 的一个依赖，检查、`runProfilePnpm`、结果核对在同一个 profile 锁里做完（不调会自己抢锁的 `dsh plugin remove`），内置层 / 安装目录 link 进来的层 / 被别的包依赖三种情况直接拦住并给中文原因；`uninstalled: true` 以重读 profile 的结果为准，需重启生效 |
| 1.2-draft  | 2026-11-09 | 生图状态与报错里的 `base_url` 脱敏：URL 里的用户信息（`https://…@relay`）和 `token` / `api_key` / `secret` 一类查询参数换成 `***`，端点本身照旧显示 |
| 1.2-draft  | 2026-11-08 | 新增 `GET`/`POST /plugins/config`：读出单个插件行自己的配置（YAML 文本，标明是插件自带 / profile / HOME 哪一层设的），存进 profile 的 patch，整个读-改-写跑在 DSH 自己的锁上 |
| 1.2-draft  | 2026-11-05 | 新增插件管理页接口（`/plugins…`），写操作需要管理 token |

---

## 10. 参考

- [Bridge 协议](bridge-protocol.md) — 外部平台适配器的 WebSocket 协议
- [使用指南](usage.md) — 终端用户功能与斜杠命令
- [config.example.toml](../config.example.toml) — 配置模板
