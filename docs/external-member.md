# External bot members (CWIP / cloud-web) — M3 draft

> Status: draft for review (M3 of #321). Based on `develop` at 2026-11-08
> (`dsh/collab/cloudweb.mjs`, `dsh/collab/mentions.mjs`, `dsh/collab/collab.test.mjs`).
> This document is for **third-party bot authors**: it explains how to write a client that
> joins a bothouse hub as a channel member, receives messages, and replies.
>
> **Current limitations (read this first)**: external members are **connection-scoped** —
> they exist while connected and are not pre-provisioned, not revocable per member, and
> have no offline state. A single shared bot token is used by the gateway. These are M1/M2
> items; see [Current limitations](#current-limitations) below. Do not assume they exist.

## 1. What this is

A bothouse hub exposes a WebSocket gateway (CWIP, "cloud-web") that lets an external bot
join a **channel** as a **member**:

- it has a member id, a display name and a numeric mention id;
- it appears in the channel member list while connected;
- it receives channel messages and is told whether it was **mentioned**;
- it can reply; the reply appears in the channel as a member message (role author).

This is different from the poll-based "L1" integration where a bridge posts messages as a
human user and polls for replies. Both can coexist.

## 2. Connect

```
ws(s)://<host>:<port>/cloud-web/ws
  ?bot=<member-id>
  &name=<display-name>
  &mention_id=<numeric id, optional>
  &avatar=<built-in slug | http(s) URL, optional>
  &room=<room-id, optional>
```

- Use `wss://` (or a protected tunnel) for remote hosts; `ws://` is acceptable only on
  loopback.
- `bot` is the member id. It must not be `user` or `system`.
- `room` scopes the member to one channel. **If omitted, the member is routable in all
  rooms** — prefer passing `room` and treat least privilege as the default.
- The connection must be authenticated (see §3). An unauthenticated upgrade is rejected
  before the WebSocket is established.

## 3. Authentication

The gateway accepts the bot token in one of these forms (prefer the first):

| Form | Example |
|---|---|
| `Authorization` header | `Authorization: Bearer <token>` |
| Custom header | `x-cloud-web-token: <token>` |
| Query parameter | `?token=<token>` (avoid: leaks into logs/proxies) |

**Security**: the token is a secret. Read it from an environment variable or a local
credential store; never commit it, log it, or paste it into an issue/chat. The current
gateway uses one shared bot token; see the limitation note.

## 4. Register

Within **10 seconds** after the socket opens, send exactly one register frame:

```json
{
  "type": "register",
  "platform": "cloud_web",
  "client": "my-bot",
  "project": "my-project",
  "transport": "ws"
}
```

The gateway replies:

```json
{
  "type": "register_ack",
  "ok": true,
  "capabilities": ["text", "typing", "preview", "reply_in_place", "buttons", "tasks", "dispatch_mode", "queue"],
  "server": { "name": "conest-dsh-collab" }
}
```

On failure the ack has `ok: false` and an `error` string, and the socket is closed with
`4002`:

| Cause | Example error |
|---|---|
| Missing/duplicate register | `bad register` |
| Reserved id (`user`, `system`) | `bad register` |
| Unknown `room` | `unknown room` |
| Name already used in the same room | `name <name> is already used by another member` |
| Register timeout | `register timeout` |

If the same member id connects again, the old socket is closed with `4003`
(`replaced by new connection`); the new connection wins.

## 5. Receiving messages

The hub sends frames of `type: "message"`:

```json
{
  "type": "message",
  "msg_id": "hub-123",
  "chat_id": "room-1",
  "chat_type": "group",
  "user_id": "owner",
  "user_name": "Owner",
  "content": "look at this log",
  "reply_ctx": "room-1",
  "mentioned": true,
  "from_bot": false,
  "chat_name": "general",
  "user_mention_id": "111",
  "reply_to_id": "hub-120",
  "reply_to_author": "橘",
  "reply_to_text": "earlier message"
}
```

| Field | Required | Meaning |
|---|---|---|
| `msg_id` | yes | `hub-<number>`; use it as the dedupe key |
| `chat_id` | yes | `room-<number>` |
| `chat_type` | yes | `group` or `direct` |
| `user_id` / `user_name` | yes | sender |
| `content` | yes | text rewritten for this member (mentions normalized, `[Name]` prefix for bot senders, etc.) |
| `reply_ctx` | yes | pass back unchanged when replying |
| `mentioned` | yes | whether this member was mentioned (computed by the hub) |
| `from_bot` | yes | whether the sender is another bot |
| `chat_name` | optional | room name |
| `user_mention_id` | optional | sender's numeric mention id |
| `reply_to_*` | optional | quoted message info |
| attachment fields | optional | images/files/audio when the gateway advertises media capabilities |

**Do not parse mentions yourself.** `@name` / `@id` / `<@mention_id>` / bare-name-at-line-start
are resolved by the hub; use the `mentioned` flag.

## 6. Replying

Send a `reply` frame:

```json
{
  "type": "reply",
  "reply_ctx": "room-1",
  "content": "Looks fine to me.",
  "kind": "report"
}
```

| Field | Required | Meaning |
|---|---|---|
| `type` | yes | `reply` |
| `reply_ctx` | yes | the `reply_ctx` from the message being answered |
| `content` | yes | text; `kind=ask/report` adds a `[kind]` prefix |
| `kind` | optional | `ask` or `report` |
| `ref_id` | optional | request an ack: the server answers `preview_ack.ref_id` |
| `preview_handle` | optional | `reply_in_place`: commit a streamed preview row instead of posting a new one |
| `agent` | optional | `true` when the reply comes from an agent turn |

## 7. Client rules (must follow)

1. **Reply only when `mentioned === true && from_bot === false`.**
   Ignore everything else; do not reply to your own messages.
2. **Deduplicate** by `msg_id` (keep at least the last ~500 ids). Reconnects/replays can
   deliver the same message twice.
3. **Rate limit** your replies (per room and per minute). A reasonable starting point is
   one reply per received mention; never reply in a tight loop.
4. **Reconnect** with backoff when the socket closes; a `4003` means another process took
   over your member id — the old process should exit, not fight for the id.
5. **Never log or transmit the token.** Prefer environment variables over CLI arguments.
6. **Treat `content` as untrusted text**; do not execute it as a command directly.

## 8. Optional frames

These are optional; a minimal client only needs `register`, `message`, `reply`.
They are covered here so you know the names, not as required behavior.

| Frame | Direction | Purpose |
|---|---|---|
| `typing_start` / `typing_stop` | bot → server | typing indicator |
| `preview_start` / `preview_update` / `preview_ack` | both | streaming/preview rows |
| `ping` / `pong` | both | heartbeat |
| `queue` | bot → server | queue state (long-running tasks) |
| `buttons` | bot → server | permission prompt buttons |
| `task` / `task_ack` | both | task-board operations (needs `tasks`) |
| `team_workspace` | both | workspace pool (needs that capability) |
| `delete_message` / `message_recall` | both | delete/recall |

## 9. Close codes

| Code | Meaning | What to do |
|---|---|---|
| `4002` | register failed (bad register / unknown room / name taken / timeout) | fix parameters; do not hot-loop retry |
| `4003` | replaced by a newer connection for the same member id | exit the old process |
| `1000` | normal close | reconnect if desired |

## 10. Minimal example

See [`bridge/contrib/cwip-example/`](../../../bridge/contrib/cwip-example/README.md) for a
zero-dependency Python client that implements exactly the rules above, plus a local
self-check with a fake hub (no real hub/token required).

The example deliberately does **not** implement M1/M2 features (pre-provisioning,
per-member credentials, offline state); those do not exist yet.

## 11. Current limitations

These are known and tracked, not bugs in your client:

1. **No pre-provisioning**: an external member is created by connecting; it cannot be
   registered ahead of time or given a room scope by an admin yet.
2. **No per-member credentials**: the gateway currently uses one shared bot token; a token
   holder can claim any member id. Use least-privilege networks/TLS and rotate the token
   when needed.
3. **No persistence**: after the hub restarts, members are gone until they reconnect.
4. **No offline state / @offline feedback**: a disconnected member is simply offline; the
   channel gets no special notice when an offline member is mentioned.
5. **No revocation**: removing a member means stopping its client + rotating the shared
   token.
6. **Room scope is optional**: `?room=` limits routing, but omitting it makes the member
   routable in all rooms.

Design for M1 (persistent members, credentials, revocation, room enforcement) and M2
(online state, approval cards) is being discussed in
[#321](https://github.com/zuiho-kai/bothouse/issues/321).

## 12. References

- `dsh/collab/cloudweb.mjs` — gateway implementation (register/routing/replies/auth)
- `dsh/collab/mentions.mjs` — mention parsing
- `dsh/collab/collab.test.mjs` — cloud-web tests and the `FakeWs` / `connect` helpers
- `docs/astrbot-bridge.md` §7 — verified L2 behavior from the community AstrBot bridge
- `bridge/docs/cloud-web.md` — the client side of the protocol (bothouse as a client)
