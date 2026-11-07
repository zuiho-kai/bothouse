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

返回当前配置，敏感信息已脱敏。适用于调试和 UI 展示。

**查询参数：** 无

**响应：**

```json
{
  "ok": true,
  "data": {
    "data_dir": "/home/user/.bothouse",
    "language": "en",
    "projects": [
      {
        "name": "my-backend",
        "agent": {
          "type": "claudecode",
          "providers": [
            {
              "name": "anthropic",
              "api_key": "***",
              "base_url": "",
              "model": "claude-sonnet-4-20250514"
            }
          ]
        },
        "platforms": [
          {
            "type": "feishu",
            "options": {
              "app_id": "***",
              "app_secret": "***"
            }
          }
        ]
      }
    ]
  }
}
```

敏感信息（如 `api_key`、`token`、`app_secret`、`client_secret`）将被替换为 `"***"`。

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
        "private": false
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

---

#### POST /api/v1/projects/{name}/social/moment

发一条说说（目前只发文字；带图走 QQ 客户端自己的路径）。

**请求体：**

```json
{ "text": "今天画了张图" }
```

**响应：**

```json
{ "ok": true, "data": { "moment": { "id": "stub01", "text": "今天画了张图", "time": "2026-11-05T06:21:06+08:00", "images": [], "private": false } } }
```

错误：`400` 文字为空、`403` 没打开（消息里点名 `allow_qzone`）、`501` 平台做不了、
`502` 上游拒绝（消息里带上游 action，扩展不存在时提示升级 NapCat）。

---

#### POST /api/v1/projects/{name}/social/moment/replace

换说说：把一个已有的说说改成新的文字。它是一次调用里的一个动作，不是让面板自己
「先发一条、再删一条」——那样中途失败会留下两条或者零条。

**请求体：**

```json
{ "id": "d43708d9240ae56ae9670e00", "text": "换了个说法" }
```

**响应：**

```json
{ "ok": true, "data": { "moment": { "id": "new-tid", "text": "换了个说法", "time": "2026-11-08T06:00:00+08:00", "images": [], "private": false } } }
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
也不发一条没图的再把带图的删掉。

能力开关是 `capabilities.replace_moment`；平台没实现 `MomentReplacer` 时面板不显示按钮、
接口回 `501`。

错误：`400` 缺 `id` 或文字为空、`403` 没打开（消息里点名 `allow_qzone`；和发说说一致）、
`501` 平台不能换、`502` 上游拒绝（部分成功的 `moment` 见上）。

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
密钥本身永不返回。

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

列出 DSH 那份 profile 里已有的插件，并提供两个真正要用的写操作：装一个包（`dsh plugin --profile <profile> add`，跟用户自己在终端敲的是同一条命令）、开关一个 bundle。这页是 profile 文件的窗口（`package.json` 的依赖 + `dsh.profile.bundles`），不是第二份注册表：DSH 自己的插件页读写的就是同一批文件，两边一致。

两个写操作都要求管理 API 设了 token。没设时路由直接回 `403`：没认证的管理端口分不清谁是这台机器的主人。

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
        "enabled": true,
        "shipped": true,
        "rows": [{"id": "web", "name": "@deepseek-ai/dsh-web", "disabled": false}]
      }
    ]
  }
}
```

`shipped` 表示这个 bundle 来自 DSH 安装本身而不是这份 profile：它们是面板自己的层，照样列出来，但页面不给开关。没有声明 `dsh.bundle` 的依赖 `layer: false`：装上了，但 DSH 不会把它当插件加载。

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

#### POST /api/v1/plugins/switch

```json
{"name": "some-bundle", "enabled": false}
```

只改 profile `package.json` 里 `dsh.profile.bundles` 这一段，其余字节原样保留；用的是 DSH 和 `dsh plugin` 同一个 `package.json.lock`，改之前先写一份带时间戳的备份。不卸载任何东西，所以再开回来就恢复原状。profile 本来就是那个状态时 `changed: false`。

`@deepseek-ai/dsh-base` 会被拒：它是面板本体，关掉就没有界面了。两个写操作都要重启 DSH 才生效，响应里 `restart_required: true`。

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
| 1.1-draft  | 2026-11-08 | 新增 `POST /projects/{name}/social/moment/replace`（换说说，先发新再删旧）与 `capabilities.replace_moment` |
| 1.2-draft  | 2026-11-05 | 新增可选的生图接口（`/image-gen`、`/image-gen/file/<name>`） |
| 1.2-draft  | 2026-11-05 | 新增插件管理页接口（`/plugins…`），写操作需要管理 token |

---

## 10. 参考

- [Bridge 协议](bridge-protocol.md) — 外部平台适配器的 WebSocket 协议
- [使用指南](usage.md) — 终端用户功能与斜杠命令
- [config.example.toml](../config.example.toml) — 配置模板
