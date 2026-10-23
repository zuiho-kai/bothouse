# Cloud Web Platform (Self-hosted IM Gateway)

> CWIP Protocol Version 1

## Overview

The **cloud_web** platform lets bothouse treat your **self-hosted IM gateway** as a first-class messaging platform — the same way it integrates with Telegram, Discord, or Feishu.

bothouse connects to your gateway using the **Cloud Web IM Protocol (CWIP)**, which reuses the message semantics of the [Bridge Protocol](./bridge-protocol.md) with reversed roles: bothouse is the client, your gateway is the IM server.

### Three transport modes

| `transport` | bothouse role | Use when |
|-------------|-------------------|----------|
| `websocket` | WebSocket client (dial out) | Real-time bidirectional; best default |
| `long_poll` | HTTP client (blocking poll) | Firewall-friendly; bothouse initiates all traffic |
| `gateway` | HTTP webhook server | Your gateway pushes events to bothouse |

All modes share the same JSON message types and capability model.

---

## Quick start

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

Web UI: Project wizard → **Cloud Web (Self-hosted IM)** → fill transport + token + URLs.

---

## Authentication

The credential belongs to the bot, not to the gateway: each bot presents its own token and the gateway derives the caller's identity from it. It travels in headers only:

| Method | Example |
|--------|---------|
| Header | `Authorization: Bearer <bot-token>` |
| Header | `X-Cloud-Web-Token: <bot-token>` |

- **No query token.** bothouse does not append `?token=` to the WebSocket handshake URL, and it drops a `token` query parameter that an older `ws_url` still carries before dialing — a credential in a URL ends up in access logs, proxy logs and browser history. Gateways do not read the query string for authentication.
- **`?bot=` is a consistency check only.** It states which bot is calling. The token alone fixes the identity, so a `?bot=` that disagrees with the presented credential is rejected, and a missing `?bot=` authenticates nobody. The `register` frame's `project` is a project label, never an identity.
- **A shared token is read-only.** A gateway that also issues one shared token for the whole team must not let it register a writer or read private rooms; the collab hub section below documents the reference behaviour.

---

## Handshake

After connection (WebSocket) or via `POST /cloud-web/v1/register` (HTTP modes), bothouse sends:

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

Gateway responds:

```json
{
  "type": "register_ack",
  "ok": true,
  "capabilities": ["text","image","file","audio","card","buttons","typing","update_message","preview","delete_message","reconstruct_reply"],
  "server": { "name": "my-gateway", "version": "1.0.0" }
}
```

Capabilities match [Bridge Protocol capabilities](./bridge-protocol.md#capabilities). Undeclared capabilities are automatically degraded by bothouse.

maomao fork: `subtask_table` means the gateway renders the sub-agent table (`__cc_connect_subtask_table_v1__:` payload, sent with `preview_start` / `update_message`). Without it bothouse sends no table.

---

## Bot credentials on the CoNest collab hub

The collab hub (the DSH `conest-collab` plugin, `dsh/collab/`) is the reference gateway for the rules above. It keeps one dedicated secret per bot, so the presented secret — not the URL — decides who is calling.

| Deploy-time setting | Meaning |
|---------------------|---------|
| `CONEST_COLLAB_BOT_TOKENS=id:secret,id:secret` | Dedicated credential per bot (env; the overlay's `botTokens: { id: secret }` map is the config form, env wins). Each `id` is the bot's member id. |
| `CONEST_COLLAB_BOT_TOKEN` | Optional legacy shared token. Read-only: it may read public room history over HTTP (`GET /api/rooms/{id}/messages`) and nothing else — it cannot register a WebSocket writer and cannot read private rooms. |
| `ws_url` `?bot=`/`?name=`/`?mention_id=` | `bot` claims the member id (consistency check against the credential); `name` is the display name used for @-mentions; `mention_id` is the bot's numeric `<@id>` on the external platform. |

Rules a client must expect on this hub:

- **The secret fixes identity.** No credential, a wrong secret, the shared token, or a `?bot=` that disagrees with the credential makes the handshake fail (`401` at the upgrade, or `register_ack` `{ok:false}` plus close code `4002`).
- **Reserved identities.** Member ids are lowercase `[a-z0-9_-]`, at most 32 characters, and `owner`, `user`, `system` are refused; a bot id must also differ from every DSH member's id. A display name already used by another member is refused.
- **No takeover of an existing member.** A credential whose id already exists as a persisted member (a human or a DSH member) or as a non-bot runtime member is refused rather than merged into it.
- **Reconnect replaces the socket.** When the same credential connects again — e.g. after cc-connect restarts — the new socket wins and the old one is closed with code `4003`, so a stale connection cannot keep consuming messages. That replaces the *connection*, not the member's identity or history.
- **Private rooms stay private.** A bot is told about a room, and may read its history, only when the room's member list includes it; leaving the list also recalls already delivered messages.

---

## Endpoints (defaults)

| Mode | Inbound | Outbound |
|------|---------|----------|
| websocket | `wss://<host>/cloud-web/ws` | same connection |
| long_poll | `POST /cloud-web/v1/events` | `POST /cloud-web/v1/send` |
| gateway | bothouse listens `webhook_path` (default `/cloud-web/webhook`) | `POST <base_url>/cloud-web/v1/send` |

Optional gateway registration:

```json
POST /cloud-web/v1/register
{ "register": { ... }, "public_url": "https://your-host/cloud-web/webhook" }
```

---

## Inbound messages (Gateway → bothouse)

### `message`

```json
{
  "type": "message",
  "msg_id": "msg-001",
  "session_key": "cloud_web:chat123:user456",
  "chat_id": "chat123",
  "user_id": "user456",
  "user_name": "Alice",
  "content": "Hello",
  "reply_ctx": "opaque-context-for-replies",
  "chat_type": "group",
  "mentioned": true,
  "from_bot": false,
  "chat_name": "大厅",
  "images": [],
  "files": [],
  "audio": null
}
```

- `session_key`: `{platform}:{chat_id}:{user_id}` (or `{platform}:{chat_id}` when `share_session_in_channel = true`)
- `reply_ctx`: opaque string/json echoed on every outbound message
- `chat_type`: `direct` | `group` | `channel` — with `group_reply_all = false`, non-`mentioned` group messages are ignored
- `mentioned`: this bot was @-mentioned; copied to `Message.Mentioned` (the gate always lets a mentioned bot reply)
- `from_bot`: sent by a teammate bot (maomao fork). Copied to `Message.FromBot`; without `mentioned` it is listen-only context and never starts a turn, as on Discord. `allow_from` does not apply to it — the gateway vouches for its bots
- `chat_name`: the channel's display name (maomao fork). Copied to `Message.ChatName`, so the team status block names the channel a teammate is busy in, as on Discord
- `user_mention_id`: for `from_bot` messages, the sending bot's `<@id>` (maomao fork). When it equals `team_lead_bot` and `mentioned` is true, the turn was dispatched by the team lead: its final answer gets `<@team_lead_bot>` prepended unless it already mentions the lead (same as Discord `lead_return`). A person's message (not `from_bot`) that mentions this bot and contains `<@team_lead_bot>` counts the same (issue #182: the user @-s the lead and a sub together; the sub answers, the lead checks when @-ed back)

### `card_action`

User clicked a card button (same semantics as Bridge `card_action`).

### `message_recall`

Message was recalled; maps to `Message.Recalled`.

---

## Outbound messages (bothouse → Gateway)

Same types as Bridge outbound: `reply`, `reply_stream`, `card`, `buttons`, `typing_start`, `typing_stop`, `preview_start`, `update_message`, `delete_message`, `image`, `file`, `audio`.

See [Bridge Protocol — bothouse → Adapter](./bridge-protocol.md) for full schemas.

---

## Configuration reference

| Option | Required | Description |
|--------|----------|-------------|
| `transport` | yes | `websocket`, `long_poll`, or `gateway` |
| `token` | yes | This bot's credential, sent in the headers only (never in the URL). On the collab hub it is the bot's own secret, not a team-wide one |
| `base_url` | mode-dependent | Gateway HTTP base URL |
| `ws_url` | websocket | Override WebSocket URL |
| `long_poll_timeout_ms` | no | Default `30000` |
| `events_path` | no | Default `/cloud-web/v1/events` |
| `send_path` | no | Default `/cloud-web/v1/send` |
| `listen` | gateway | Default `:8099` |
| `webhook_path` | gateway | Default `/cloud-web/webhook` |
| `public_url` | gateway | Public callback URL for registration |
| `register_url` | gateway | Optional register endpoint |
| `allow_from` | no | User whitelist (`*` = all) |
| `share_session_in_channel` | no | Shared group session |
| `group_reply_all` | no | Reply to all group messages without @mention |
| `team_lead_bot` | no | The team lead's `<@id>` (maomao fork; same value as the Discord platform's). A sub's final answer to the lead's @ is routed back to it |

---

## Public URL for gateway mode

Expose the webhook with nginx, cloudflared, or similar. See [WeCom tunnel guide](./wecom.md) for cloudflared examples.

---

## Related

- [Bridge Protocol](./bridge-protocol.md) — message type reference
- [config.example.toml](../config.example.toml) — commented examples

---

## Minimal Gateway Example (Go)

Below is a minimal WebSocket Gateway for local testing. It accepts `register`, pushes a `message`, and prints outbound `reply` frames from bothouse.

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

Point bothouse at `ws_url = "ws://127.0.0.1:8080/cloud-web/ws"` and set this bot's `token`; the credential reaches the gateway in the `Authorization` / `X-Cloud-Web-Token` headers, not in the URL.
