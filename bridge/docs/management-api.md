# bothouse Management API Specification

> **Version:** 1.1-draft  
> **Status:** Draft — subject to change before implementation  
> **Last Updated:** 2026-03-24

---

## 1. Overview

The bothouse Management API is an HTTP-based REST API that enables external applications (web dashboards, TUI clients, GUI desktop apps, Mac tray apps) to manage and monitor bothouse instances. It complements the existing internal Unix socket API by providing a network-accessible, token-authenticated interface suitable for remote and local management tools.

### 1.1 Architecture

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

### 1.2 Design Principles

- **RESTful:** Resource-oriented URLs, standard HTTP methods
- **JSON:** All request/response bodies use `application/json`
- **Consistent envelope:** Every response uses `{"ok": true|false, "data"|"error": ...}`
- **Token auth:** Bearer token or query parameter for all endpoints

---

## 2. Configuration

### 2.1 Management Block

Add the following to `config.toml`:

```toml
[management]
enabled = true
port = 9820
token = "mgmt-secret"
```

| Field    | Type    | Default   | Description                                      |
|----------|---------|-----------|--------------------------------------------------|
| `enabled`| boolean | `false`   | Enable the Management API server                 |
| `port`   | integer | `9820`    | TCP port to listen on                            |
| `token`  | string  | (required)| Shared secret for authentication                 |

When `enabled` is `false`, the Management API is not started. The token should be a strong, random string (e.g. 32+ characters).

### 2.2 Base URL

All endpoints are relative to:

```
http://<host>:<port>/api/v1
```

Example: `http://localhost:9820/api/v1/status`

---

## 3. Authentication

Every request must include a valid token. Two methods are supported:

### 3.1 Bearer Token (Recommended)

```
Authorization: Bearer <token>
```

Example:

```bash
curl -H "Authorization: Bearer mgmt-secret" http://localhost:9820/api/v1/status
```

### 3.2 Query Parameter

```
GET /api/v1/status?token=mgmt-secret
```

> **Note:** Query parameter auth is provided for environments where setting headers is difficult. Prefer Bearer token for security (tokens in URLs may be logged).

### 3.3 Unauthorized Response

If the token is missing or invalid:

- **HTTP Status:** `401 Unauthorized`
- **Body:**

```json
{
  "ok": false,
  "error": "unauthorized: missing or invalid token"
}
```

---

## 4. Response Format

### 4.1 Success

```json
{
  "ok": true,
  "data": { ... }
}
```

### 4.2 Error

```json
{
  "ok": false,
  "error": "human-readable error message"
}
```

### 4.3 HTTP Status Codes

| Code | Meaning                                      |
|------|----------------------------------------------|
| 200  | Success                                      |
| 400  | Bad request (invalid body, missing params)   |
| 401  | Unauthorized (missing/invalid token)        |
| 404  | Resource not found (project, session, etc.) |
| 405  | Method not allowed                          |
| 500  | Internal server error                        |

---

## 5. Endpoint Reference

### 5.1 System

#### GET /api/v1/status

Returns system status and summary.

**Response:**

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

| Field                 | Type     | Description                                      |
|-----------------------|----------|--------------------------------------------------|
| `version`             | string   | bothouse version (e.g. `v1.2.0`)              |
| `uptime_seconds`      | number   | Process uptime in seconds                        |
| `connected_platforms` | string[] | Platform types currently connected               |
| `projects_count`      | number   | Number of configured projects                    |
| `bridge_adapters`     | array   | External adapters connected via Bridge WebSocket |

---

#### POST /api/v1/restart

Triggers a graceful restart. The process will shut down cleanly and exec itself. A "restart successful" message may be sent to the session that initiated the restart (if applicable).

**Request body (optional):**

```json
{
  "session_key": "telegram:123:456",
  "platform": "telegram"
}
```

If provided, the restart notification will be sent to the specified session after the new process starts.

**Response:**

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

Reloads configuration from disk without restarting the process. New projects may be added; removed projects are stopped. Changed project settings take effect.

**Response:**

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

Returns the current configuration with secrets redacted. Useful for debugging and UI display.

**Query parameters:** None

**Response:**

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

Secrets (e.g. `api_key`, `token`, `app_secret`, `client_secret`) are replaced with `"***"`.

---

#### GET /api/v1/logs

Returns recent log entries.

**Query parameters:**

| Param   | Type   | Default | Description                          |
|---------|--------|---------|--------------------------------------|
| `level` | string | `info`  | Minimum level: `debug`, `info`, `warn`, `error` |
| `limit` | int    | `100`   | Max entries to return (1–1000)       |

**Response:**

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

### 5.2 Projects

#### GET /api/v1/projects

Lists all projects with a summary.

**Response:**

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

Returns detailed information for a single project.

**Path parameters:**

| Param  | Type   | Description        |
|--------|--------|--------------------|
| `name` | string | Project name       |

**Response:**

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

**Error (404):**

```json
{
  "ok": false,
  "error": "project not found: my-backend"
}
```

---

#### PATCH /api/v1/projects/{name}

Updates project settings. Only provided fields are updated.

**Request body:**

```json
{
  "quiet": true,
  "admin_from": "user1,user2,user3",
  "language": "zh",
  "disabled_commands": ["restart", "upgrade", "cron"]
}
```

| Field               | Type     | Description                                              |
|---------------------|----------|----------------------------------------------------------|
| `quiet`             | boolean  | Suppress thinking/tool progress messages                 |
| `admin_from`        | string   | Comma-separated user IDs for privileged commands; `"*"` = all |
| `language`          | string   | UI language: `en`, `zh`, `zh-TW`, `ja`, `es`             |
| `disabled_commands` | string[] | Commands to disable (e.g. `restart`, `upgrade`, `cron`)  |

**Response:**

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

### 5.3 Sessions

Sessions are conversation contexts within a project. A session is identified by a `session_key` (format: `platform:chatId:userId`) and optionally by an internal `id` for named sessions (e.g. `/new work` creates a named session).

#### GET /api/v1/projects/{name}/sessions

Lists sessions for a project with summary info including the last message preview.

**Response:**

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
        "agent_type": "claudecode",
        "active": true,
        "live": true,
        "history_count": 12,
        "created_at": "2026-03-10T09:00:00Z",
        "updated_at": "2026-03-10T10:30:00Z",
        "last_message": {
          "role": "assistant",
          "content": "Done! The tests are passing now...",
          "timestamp": "2026-03-10T10:30:00Z"
        },
        "user_name": "Alice",
        "chat_name": "dev-channel"
      }
    ],
    "active_keys": {
      "telegram:123:456": "telegram"
    }
  }
}
```

| Field          | Type    | Description                                                       |
|----------------|---------|-------------------------------------------------------------------|
| `active`       | boolean | Whether this is the selected session for its user key             |
| `live`         | boolean | Whether there is a running agent process for this session         |
| `last_message` | object  | Preview of the last message (role, content truncated to 200 chars, timestamp). `null` if no history. |
| `user_name`    | string  | Display name of the user (from platform metadata)                 |
| `chat_name`    | string  | Name of the chat/channel (from platform metadata)                 |
| `active_keys`  | object  | Map of session keys with active agent connections → platform name |

---

#### POST /api/v1/projects/{name}/sessions

Creates a new session.

**Request body:**

```json
{
  "session_key": "telegram:123:456",
  "name": "work"
}
```

| Field        | Type   | Required | Description                          |
|--------------|--------|----------|--------------------------------------|
| `session_key`| string | yes      | Platform routing key (e.g. `telegram:123:456`) |
| `name`       | string | no       | Human-readable session name           |

**Response:**

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

Returns session detail including message history.

**Path parameters:**

| Param  | Type   | Description                          |
|--------|--------|--------------------------------------|
| `name` | string | Project name                         |
| `id`   | string | Session ID                           |

**Query parameters:**

| Param   | Type | Default | Description                    |
|---------|------|---------|--------------------------------|
| `history_limit` | int | 50 | Max history entries to return |

**Response:**

```json
{
  "ok": true,
  "data": {
    "id": "sess_abc123",
    "session_key": "telegram:123:456",
    "name": "work",
    "platform": "telegram",
    "agent_type": "claudecode",
    "agent_session_id": "as_xxx",
    "active": true,
    "live": true,
    "history_count": 12,
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

| Field   | Type    | Description                                                   |
|---------|---------|---------------------------------------------------------------|
| `live`  | boolean | Whether the session has an active agent process (can receive messages via `/send`) |

---

#### DELETE /api/v1/projects/{name}/sessions/{id}

Deletes a session and its history.

**Response:**

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

Switches the active session for a given session_key (e.g. when a user has multiple named sessions).

**Request body:**

```json
{
  "session_key": "telegram:123:456",
  "session_id": "sess_xyz789"
}
```

| Field         | Type   | Required | Description                    |
|---------------|--------|----------|--------------------------------|
| `session_key` | string | yes      | Platform routing key           |
| `session_id`  | string | yes      | Session ID to make active      |

**Response:**

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

Sends a message to a session. The message is delivered to the agent as if the user had sent it via the platform. **Requires the session to be live** (i.e., have an active agent process). Check the `live` field from session detail to verify before sending.

**Request body:**

```json
{
  "session_key": "telegram:123:456",
  "message": "Review the latest commit"
}
```

| Field         | Type   | Required | Description                    |
|---------------|--------|----------|--------------------------------|
| `session_key`| string | yes      | Platform routing key           |
| `message`    | string | yes      | Text to send to the agent      |

**Response:**

```json
{
  "ok": true,
  "data": {
    "message": "message sent"
  }
}
```

---

### 5.4 Providers

Providers are API backends (e.g. Anthropic, OpenAI, custom endpoints) that supply the AI model for a project's agent.

#### GET /api/v1/projects/{name}/providers

Lists providers with active indicator.

**Response:**

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

Adds a new provider.

**Request body:**

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

| Field     | Type            | Required | Description                              |
|-----------|-----------------|----------|------------------------------------------|
| `name`    | string          | yes      | Provider identifier                      |
| `api_key` | string          | no*      | API key (*required if no `env`)          |
| `base_url`| string          | no       | Custom API endpoint                      |
| `model`   | string          | no       | Model override                           |
| `thinking`| string          | no       | `"disabled"` for providers without adaptive thinking |
| `env`     | object (k/v)    | no       | Extra environment variables              |

**Response:**

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

Removes a provider. The active provider cannot be removed; switch first.

**Response:**

```json
{
  "ok": true,
  "data": {
    "message": "provider removed"
  }
}
```

**Error (400):**

```json
{
  "ok": false,
  "error": "cannot remove active provider; switch to another first"
}
```

---

#### POST /api/v1/projects/{name}/providers/{provider}/activate

Switches the active provider.

**Response:**

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

Lists available models for the project's agent type.

**Response:**

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

Sets the model for the project.

**Request body:**

```json
{
  "model": "claude-3-5-sonnet-20241022"
}
```

**Response:**

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

### 5.5 Cron Jobs

#### GET /api/v1/cron

Lists all cron jobs, optionally filtered by project.

**Query parameters:**

| Param     | Type   | Description        |
|-----------|--------|--------------------|
| `project` | string | Filter by project  |

**Response:**

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

Adds a cron job. Either `prompt` or `exec` must be provided, not both. `session_key` is required for both kinds: the run posts its start notice and result to that chat, so a job without one is rejected with `400 session_key is required` (it used to be persisted and then fail at fire-time).

**Request body (prompt job):**

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

**Request body (exec job):**

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

| Field        | Type    | Required | Description                                    |
|--------------|---------|----------|------------------------------------------------|
| `project`    | string  | no*      | Project name (*required if multiple projects) |
| `session_key`| string  | yes      | Chat the job reports to when it fires (`platform:chatId[:userId]`, e.g. `qq:10001`); required for exec jobs too |
| `cron_expr`  | string  | yes      | Cron expression (5 or 6 fields)                |
| `prompt`     | string  | no*      | Prompt to send (*required if no `exec`)        |
| `exec`       | string  | no*      | Shell command (*required if no `prompt`)       |
| `work_dir`   | string  | no       | Working directory for exec                    |
| `description`| string  | no       | Human-readable label                           |
| `silent`     | boolean | no       | Suppress start notification                   |
| `session_mode` | string | no       | `reuse` (default) or `new_per_run` — new agent session each run |
| `timeout_mins` | int    | no       | Scheduler wait per run: omit = 30 min, `0` = no time limit |

**Response:**

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

Deletes a cron job.

**Response:**

```json
{
  "ok": true,
  "data": {
    "message": "cron job deleted"
  }
}
```

#### POST /api/v1/cron/{id}/exec

Triggers an existing cron job immediately. Disabled jobs can still be triggered manually.
`/api/v1/cron/{id}/run` is accepted as a compatibility alias.

**Response:**

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

### 5.6 Heartbeat

Heartbeat runs periodic prompts in a session (e.g. "check inbox") to keep the agent aware of the environment.

#### GET /api/v1/projects/{name}/heartbeat

Returns heartbeat status.

**Response:**

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

Pauses heartbeat.

**Response:**

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

Resumes heartbeat.

**Response:**

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

Triggers heartbeat immediately (one-shot).

**Response:**

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

Sets the heartbeat interval.

**Request body:**

```json
{
  "minutes": 15
}
```

**Response:**

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

Lists connected bridge adapters (external platforms via WebSocket).

**Response:**

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

### 5.8 Social (QQ 说说 / avatar, optional)

These routes act as the bot's own QQ account: a 说说 is visible to other people and an
avatar is visible everywhere. Both are **off by default** and stay unavailable until the
project's `qq` platform options turn them on:

```toml
[projects.platforms.options]
allow_qzone = true    # list / post / delete this account's own 说说
allow_avatar = true   # change this account's own avatar
```

They are capability-based, not platform-name-based: a project whose platform does not
implement the capability answers `not_supported` instead of guessing by platform name.
Nothing here runs on a schedule — posting on a timer is the cron section's job and stays a
separate decision.

#### GET /api/v1/projects/{name}/social

Reads the capability flags and the account's own recent posts (newest first).

**Query:** `limit` — how many posts to read (default 20, max 50).

**Response:**

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

`status` is one of:

| status | meaning |
|--------|---------|
| `ready` | the actions are on; `moments` holds the list |
| `off` | the capability exists but config has not turned it on; `message` names the config key |
| `error` | reading the list failed; `message` says why, the write actions still follow `capabilities` |
| `not_supported` | this project's platform cannot do it at all |

`moments` is always an array (`[]`, never `null`), so a panel can read `.length` directly.

---

#### POST /api/v1/projects/{name}/social/moment

Publishes one 说说 (text only for now; pictures go through the QQ client's own picture path).

**Request body:**

```json
{ "text": "今天画了张图" }
```

**Response:**

```json
{ "ok": true, "data": { "moment": { "id": "stub01", "text": "今天画了张图", "time": "2026-11-05T06:21:06+08:00", "images": [], "private": false } } }
```

Errors: `400` empty text, `403` the action is off (message names `allow_qzone`), `501` the
platform cannot post, `502` the OneBot implementation rejected it (the message names the
upstream action and says to upgrade NapCat when the extension is missing).

---

#### POST /api/v1/projects/{name}/social/moment/replace

Replaces one existing post's words. One action in one call, not the panel posting a new one
and then deleting the old one as two separate steps — that way a failure in between leaves
two posts or none.

**Request body:**

```json
{ "id": "d43708d9240ae56ae9670e00", "text": "Said it differently" }
```

**Response:**

```json
{ "ok": true, "data": { "moment": { "id": "new-tid", "text": "Said it differently", "time": "2026-11-08T06:00:00+08:00", "images": [], "private": false } } }
```

**Order and failure** (important): QQ空间 has no upstream call that edits a post's words; it
has publish, delete, read and visibility only. So the implementation **publishes the new post
first and only then deletes the old one**, and the order cannot be reversed:

1. Publishing failed → the old post is **untouched**, the error says "the old one is kept as it
   was", and the person still has the words they had.
2. The new post went out but deleting the old one failed → the route returns non-2xx, the
   message names the new tid and says both posts now exist, and the new post comes back with it.
   It never pretends the replacement was clean.

So it always moves forward and never loses the original words; the price is that the edge case
briefly leaves two posts. The flag is `capabilities.replace_moment`; when a platform has no such
capability the panel hides the button and the route answers `501`.

Errors: `400` missing `id` or empty text, `403` not enabled (the message names `allow_qzone`),
`501` the platform cannot replace.

---

#### POST /api/v1/projects/{name}/social/moment/delete

Deletes one of the account's own posts. A post that is already gone counts as deleted.

**Request body:**

```json
{ "id": "stub01" }
```

**Response:**

```json
{ "ok": true, "data": { "result": "deleted" } }
```

---

#### POST /api/v1/projects/{name}/social/avatar

Replaces the account's avatar.

**Request:** `multipart/form-data` with a `file` field. Accepted: any file whose sniffed
type is `image/*`, up to 2 MiB.

**Response:**

```json
{ "ok": true, "data": { "result": "changed", "mime": "image/png", "bytes": 94 } }
```

Errors: `400` not an image or empty, `403` the action is off (message names `allow_avatar`),
`413` over 2 MiB, `501` the platform cannot change its avatar.

---

### 5.9 Image Generation (optional)

Opt-in: these routes answer `not_configured` unless `config.toml` has an `[image_gen]` section with
`enabled = true` and a key (`[image_gen.openai] api_key`). Nothing is drawn automatically and nothing
is sent to a channel: a picture is written to `<data_dir>/images` and the caller decides what to do
with the path. Only OpenAI-compatible `/images/generations` endpoints are supported.

`out_dir` must stay inside `data_dir` (default `<data_dir>/images`); a wider directory is refused with
`status: "error"` and nothing is drawn. The bytes route below has no token, so the directory it can
reach is the boundary that keeps it from serving other pictures on this machine. Picture names are
`gen-<YYYYMMDD-HHMMSS>-<8 hex>.png` — the random suffix exists so two pictures finished in the same
second cannot overwrite each other.

`POST` additionally requires the management `token` to be set (else `403`): reads are cheap, a draw
spends the owner's money, and an empty token means the port is open to the whole network.

#### GET /api/v1/image-gen

**Response:**

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

`status` is `ready`, `not_configured` or `error` (with `message`). `api_key_set` says whether a key
exists; the key itself is never returned.

#### POST /api/v1/image-gen

```json
{ "prompt": "an orange cat with glasses, pixel avatar" }
```

**Response:** the drawn picture, same shape as one `pictures` item above. `400` when `prompt` is empty
or blank (nothing is sent to the provider), `403` when the management API has no `token` (a draw spends
money, so it needs authentication even though reads do not), `409` when a picture is still being drawn
(each queued request would buy another one), `503` when not configured or when `out_dir` is outside
`data_dir`, `502` when the provider refused (the message carries the status code and the provider's own
text).

#### GET /api/v1/image-gen/file/<name>

Picture bytes, like `library/avatar-image` **not** behind the token, because an `<img>` tag cannot
send a `Bearer` header. Only plain file names this server wrote are served; anything else is `404` —
a name with a separator or `..`, a symlink (even to a file inside `out_dir`), a file whose real path
falls outside the resolved `out_dir`, and a file whose bytes are not `image/*` when sniffed.

---

### 5.10 Plugins (DSH profile)

The DSH profile's own plugin list, and the two writes a person actually needs: install a package
(`dsh plugin --profile <profile> add`, the same command a user would type) and switch a bundle on or
off. The page is a window on the profile files (`package.json` dependencies +
`dsh.profile.bundles`), not a second registry: DSH's own Plugins page reads and writes exactly the
same files, so the two agree.

Both writes require a management token. With none configured the routes answer `403`, because an
unauthenticated management port cannot tell the owner from anyone else on the machine.

#### GET /api/v1/plugins

**Response:**

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

`shipped` marks a bundle that resolves from the DSH installation rather than this profile; those are
the panel's own surface, so the response lists them but the page offers no switch. A dependency that
does not declare `dsh.bundle` has `layer: false`: it is installed, but DSH never loads it as a plugin.

#### GET /api/v1/plugins/inspect?spec=<package spec>

Describes a spec **before** anything is installed. Nothing is written and no process runs.

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

- `kind` is one of `registry`, `git`, `tarball`, `path`. Only `registry` is accepted unless
  `[plugins] allow_non_registry = true`; the other kinds then report `allowed: false` with a
  `reason`, and `POST /plugins/install` refuses them with `403`.
- `compatible` is present only when the declared `engines.dsh` (or `@deepseek-ai/dsh`
  peer) range is one this build evaluates. Absent means "left to DSH at install", which is honest:
  a wrong pre-flight answer is worse than none.
- `required` is what the plugin may do once loaded. DSH plugins run in the same process as the panel
  and the agent, in-process, with no per-plugin sandbox.
- `error` reports a registry read that failed. The install can still be attempted; the run's own
  output is the authority.

#### POST /api/v1/plugins/install

```json
{"spec": "demo-bundle@1.2.3"}
```

Only an npm registry package name is accepted by default: lowercase, optional `@scope/`, optional
`@version` or tag, at most 214 characters, and never a leading `-`. A `git:`/`github:` shorthand, a
git URL, an `http(s)://…tgz`, or a `file:`/`link:`/absolute path is a different risk (the bytes are
not the ones the registry published) and needs both the config switch and a second confirmation in
the page.

The response is an NDJSON stream, because the run takes minutes on a cold npm cache:

```
{"line": "Progress: resolved 1, reused 0, downloaded 0, added 0"}
{"done": true, "state": { …the same shape as GET /plugins …}}
```

On failure the last line carries `error` (pnpm's own line) and `kind`, which the page turns into its
own language: `pnpm-missing`, `build-blocked`, `not-found`, `no-matching-version`, `disk-full`,
`permission`, `integrity`, `network`, `timeout`, `unknown`.

#### POST /api/v1/plugins/switch

```json
{"name": "some-bundle", "enabled": false}
```

Rewrites only the `dsh.profile.bundles` array of the profile's `package.json`, byte-for-byte
elsewhere, under the same `package.json.lock` that DSH and `dsh plugin` take; a timestamped backup is
written first. Nothing is uninstalled, so switching back on restores the old state. `changed: false`
when the profile already had that state.

`@deepseek-ai/dsh-base` is refused: it is the panel itself, and switching it off removes the UI.
A DSH restart is needed for either write to take effect; the response reports
`restart_required: true`.

---

## 6. Error Handling Conventions

### 6.1 Standard Error Response

All errors use the same envelope:

```json
{
  "ok": false,
  "error": "human-readable message"
}
```

### 6.2 Common Errors

| HTTP | Error message example                          | Cause                          |
|------|-------------------------------------------------|--------------------------------|
| 400  | `"project is required (multiple projects)"`     | Missing required parameter     |
| 400  | `"either prompt or exec is required"`           | Invalid cron job body          |
| 401  | `"unauthorized: missing or invalid token"`      | Auth failure                   |
| 404  | `"project not found: xyz"`                      | Unknown project/session/cron   |
| 404  | `"session not found"`                           | Unknown session ID             |
| 405  | `"method not allowed"`                          | Wrong HTTP method              |
| 500  | `"internal error"`                              | Unexpected server error        |

### 6.3 Validation Errors

When request body validation fails:

```json
{
  "ok": false,
  "error": "invalid request: session_key is required"
}
```

---

## 7. Session Key Format

The `session_key` is a composite identifier used to route messages to the correct platform and chat:

```
<platform>:<chat_id>:<user_id>
```

Examples:

- `telegram:123456789:123456789` — Telegram user 123456789 in chat 123456789
- `feishu:ou_xxx:chat_yyy` — Feishu user in chat
- `slack:C01234:U05678` — Slack channel and user
- `discord:123456789:987654321` — Discord guild and user

For multi-workspace mode, the format may include a workspace prefix:

```
<workspace>:<platform>:<chat_id>:<user_id>
```

---

## 8. CORS

When the Management API is used by web dashboards, CORS headers should be configurable. A suggested config extension:

```toml
[management]
enabled = true
port = 9820
token = "mgmt-secret"
cors_origins = ["http://localhost:3000", "https://dashboard.example.com"]
```

If not configured, CORS may be disabled or use a default (e.g. `*` for same-origin only).

---

## 9. Changelog

| Version   | Date       | Changes                    |
|-----------|------------|----------------------------|
| 1.1-draft | 2026-03-24 | Enrich session list/detail with `live`, `last_message`, `agent_type`, `user_name`, `chat_name`, `active_keys` fields |
| 1.2-draft | 2026-11-05 | Add optional QQ 说说 / avatar routes (`/projects/{name}/social…`), off unless `allow_qzone` / `allow_avatar` |
| 1.2-draft | 2026-11-08 | Add `POST /projects/{name}/social/moment/replace` (replace a post: publish new, then delete old) and `capabilities.replace_moment` |
| 1.2-draft | 2026-11-05 | Add optional image generation routes (`/image-gen`, `/image-gen/file/<name>`) |
| 1.2-draft | 2026-11-05 | Add the DSH plugin page routes (`/plugins…`), writes need the management token |
| 1.0-draft | 2026-03-10 | Initial specification      |

---

## 10. References

- [Bridge Protocol](bridge-protocol.md) — WebSocket protocol for external platform adapters
- [Usage Guide](usage.md) — End-user features and slash commands
- [config.example.toml](../config.example.toml) — Configuration template
