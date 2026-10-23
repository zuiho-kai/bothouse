# Cloud Web 平台（自建 IM Gateway）

> CWIP 协议版本 1

## 概述

**cloud_web** 平台让 bothouse 将**自建 IM Gateway** 当作一等公民 IM 平台接入，使用方式与 Telegram、Discord、飞书相同。

bothouse 通过 **Cloud Web IM Protocol (CWIP)** 与 Gateway 通信。CWIP 复用 [Bridge 协议](./bridge-protocol.zh-CN.md) 的消息语义，但角色反转：bothouse 为客户端，自建 Gateway 为 IM 服务端。

### 三种传输模式

| `transport` | bothouse 角色 | 适用场景 |
|-------------|----------------|----------|
| `websocket` | WebSocket 客户端（主动连接） | 实时双向，推荐默认 |
| `long_poll` | HTTP 长轮询客户端 | 防火墙友好，流量均由 bothouse 发起 |
| `gateway` | HTTP Webhook 服务端 | Gateway 主动推送事件到 bothouse |

三种模式共用同一套 JSON 消息类型与能力模型。

---

## 快速开始

```toml
[[projects.platforms]]
type = "cloud_web"

[projects.platforms.options]
transport = "websocket"
token = "<bot-token>"
base_url = "https://gateway.example.com"
ws_url = "wss://gateway.example.com/cloud-web/ws?bot=<bot-id>&name=<display-name>"
allow_from = "*"
```

Web 管理端：项目向导 → **Cloud Web (自建 IM)** → 填写传输模式、Token 与 URL。

---

## 认证

凭据属于机器人，而不属于 Gateway：每个机器人带自己的 token，Gateway 由这个 token 判断调用者是谁。token 只走请求头：

| 方式 | 示例 |
|------|------|
| Header | `Authorization: Bearer <bot-token>` |
| Header | `X-Cloud-Web-Token: <bot-token>` |

- **没有查询参数认证。** bothouse 不会往 WebSocket 握手 URL 上追加 `?token=`，旧的 `ws_url` 里若还带着 `token` 查询参数，拨号前会被去掉——URL 里的凭据会进访问日志、代理日志和浏览器历史。Gateway 也不读查询参数来认证。
- **`?bot=` 只做一致性检查。** 它只声明自己是哪个机器人；身份由 token 决定，所以与凭据不一致的 `?bot=` 会被拒绝，缺少 `?bot=` 也不能因此通过认证。`register` 帧里的 `project` 只是项目标签，从来不是身份。
- **共享 token 只读。** Gateway 若另外发一个全队共用的 token，不能让它注册写入连接、也不能让它读私有房间；参考实现见下方 collab hub 一节。

---

## 握手

WebSocket 连接后，或 HTTP 模式下 `POST /cloud-web/v1/register`，bothouse 发送：

```json
{
  "type": "register",
  "platform": "cloud_web",
  "client": "bothouse",
  "project": "my-project",
  "transport": "websocket",
  "metadata": { "protocol_version": 1 }
}
```

Gateway 响应：

```json
{
  "type": "register_ack",
  "ok": true,
  "capabilities": ["text","image","file","audio","card","buttons","typing","update_message","preview","delete_message","reconstruct_reply"],
  "server": { "name": "my-gateway", "version": "1.0.0" }
}
```

能力列表与 [Bridge 协议能力表](./bridge-protocol.zh-CN.md) 一致。未声明的能力由 bothouse 自动降级。

---

## CoNest collab hub 上的机器人凭据

collab hub（DSH 的 `conest-collab` 插件，`dsh/collab/`）是上面这些规则的参考实现：它给每个机器人一个专属密钥，由出示的密钥——而不是 URL——决定调用者是谁。

| 部署时设置 | 含义 |
|-----------|------|
| `CONEST_COLLAB_BOT_TOKENS=id:secret,id:secret` | 每个机器人的专属凭据（环境变量；overlay 里 `botTokens: { id: secret }` 是配置写法，环境变量优先）。`id` 就是该机器人的成员 id。 |
| `CONEST_COLLAB_BOT_TOKEN` | 可选的旧共享 token。只读：只能通过 HTTP（`GET /api/rooms/{id}/messages`）读公开房间历史，别的一概不行——不能注册 WebSocket 写入连接，也读不到私有房间。 |
| `ws_url` 的 `?bot=`/`?name=`/`?mention_id=` | `bot` 声明成员 id（对凭据做一致性检查）；`name` 是 @ 时用的显示名；`mention_id` 是该机器人在外部平台的数字 `<@id>`。 |

客户端在这个 hub 上会遇到的行为：

- **密钥决定身份。** 没带凭据、密钥不对、用共享 token，或 `?bot=` 与凭据不一致，握手都会失败（升级时 `401`，或 `register_ack` `{ok:false}` 并以 `4002` 关闭）。
- **保留身份与重名。** 成员 id 为小写 `[a-z0-9_-]`、最多 32 字符，`owner`、`user`、`system` 一律拒绝；机器人 id 也不能与任何 DSH 成员重名。显示名已被别的成员占用时同样拒绝。
- **不顶替已有成员。** 凭据对应的 id 若已经是持久化成员（真人或 DSH 成员），或已是运行时的非机器人成员，注册被拒绝，不会并进那条身份。
- **重连顶替旧连接。** 同一个凭据再次连接（例如 cc-connect 重启后），新连接生效，旧连接以 `4003` 关闭，避免过期连接继续消费消息。顶替的是连接，不是成员身份或历史。
- **私有房间不越权。** 只有当房间成员名单包含该机器人时，它才会收到该房间的消息、才能读该房间历史；被移出名单时已投递的消息会被撤回。

---

## 默认端点

| 模式 | 入站 | 出站 |
|------|------|------|
| websocket | `wss://<host>/cloud-web/ws` | 同一连接 |
| long_poll | `POST /cloud-web/v1/events` | `POST /cloud-web/v1/send` |
| gateway | bothouse 监听 `webhook_path`（默认 `/cloud-web/webhook`） | `POST <base_url>/cloud-web/v1/send` |

Gateway 模式可选注册：

```json
POST /cloud-web/v1/register
{ "register": { ... }, "public_url": "https://your-host/cloud-web/webhook" }
```

---

## 入站消息（Gateway → bothouse）

### `message`

```json
{
  "type": "message",
  "msg_id": "msg-001",
  "session_key": "cloud_web:chat123:user456",
  "chat_id": "chat123",
  "user_id": "user456",
  "user_name": "Alice",
  "content": "你好",
  "reply_ctx": "opaque-context-for-replies",
  "chat_type": "group",
  "mentioned": true
}
```

- `session_key`：`{platform}:{chat_id}:{user_id}`（`share_session_in_channel = true` 时为 `{platform}:{chat_id}`）
- `reply_ctx`：opaque 上下文，出站消息原样回传
- `group_reply_all = false` 时，群聊未 @ 的消息会被忽略

### `card_action` / `message_recall`

与 Bridge 协议语义相同。

---

## 出站消息（bothouse → Gateway）

支持：`reply`、`reply_stream`、`card`、`buttons`、`typing_start/stop`、`preview_start`、`update_message`、`delete_message`、`image`、`file`、`audio`。

详见 [Bridge 协议出站消息](./bridge-protocol.zh-CN.md)。

---

## 配置项

| 选项 | 必填 | 说明 |
|------|------|------|
| `transport` | 是 | `websocket` / `long_poll` / `gateway` |
| `token` | 是 | 这个机器人自己的凭据，只走请求头（不放进 URL）。在 collab hub 上是每个机器人各自的密钥，不是全队共用 |
| `base_url` | 视模式 | Gateway HTTP 根地址 |
| `ws_url` | websocket | WebSocket 地址（可省略，由 base_url 推导） |
| `long_poll_timeout_ms` | 否 | 默认 30000 |
| `listen` / `webhook_path` | gateway | 本地 Webhook 监听 |
| `public_url` / `register_url` | gateway | 公网回调注册 |
| `allow_from` | 否 | 用户白名单 |
| `share_session_in_channel` | 否 | 群聊共享 session |
| `group_reply_all` | 否 | 群内无需 @ 也回复 |

---

## Gateway 模式公网暴露

使用 nginx、cloudflared 等暴露 Webhook。可参考 [企业微信隧道文档](./wecom.md)。

---

## 相关文档

- [Bridge 协议](./bridge-protocol.zh-CN.md)
- [config.example.toml](../config.example.toml)

---

## 最小 Gateway 示例（Go）

下面是一个用于本地测试的最小 WebSocket Gateway：接收 `register`、推送 `message`、打印 bothouse 发来的 `reply`。

```go
package main

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}

func main() {
	http.HandleFunc("/cloud-web/ws", func(w http.ResponseWriter, r *http.Request) {
		conn, _ := upgrader.Upgrade(w, r, nil)
		defer conn.Close()
		_, reg, _ := conn.ReadMessage()
		log.Printf("register: %s", reg)
		_ = conn.WriteJSON(map[string]any{
			"type": "register_ack", "ok": true,
			"capabilities": []string{"text", "reconstruct_reply"},
		})
		_ = conn.WriteJSON(map[string]any{
			"type": "message", "msg_id": "1", "session_key": "cloud_web:chat1:user1",
			"user_id": "user1", "content": "hello from gateway", "reply_ctx": "ctx-1",
		})
		for {
			_, raw, err := conn.ReadMessage()
			if err != nil {
				return
			}
			var m map[string]any
			_ = json.Unmarshal(raw, &m)
			log.Printf("outbound: %v", m)
		}
	})
	log.Println("gateway listening :8080/cloud-web/ws")
	log.Fatal(http.ListenAndServe(":8080", nil))
}
```

bothouse 配置：`ws_url = "ws://127.0.0.1:8080/cloud-web/ws"`，并把 `token` 设成这个机器人自己的凭据；凭据经 `Authorization` / `X-Cloud-Web-Token` 请求头送达，不在 URL 里。
