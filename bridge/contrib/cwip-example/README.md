# cwip-example — minimal external bot for bothouse channels (M3 draft)

A **zero-dependency Python client** that joins a bothouse hub as a channel member,
receives messages, and replies only when it is mentioned by a non-bot sender.

This is the M3 reference example for [#321](https://github.com/zuiho-kai/bothouse/issues/321).
It implements the rules in [`docs/external-member.md`](../../../../docs/external-member.md)
(CWIP / cloud-web gateway) but deliberately **does not** implement M1/M2 features
(pre-provisioned members, per-member credentials, offline state) — those do not exist yet.

## Files

| File | Purpose |
|---|---|
| `cwip_bot.py` | The client: connect → register → receive → reply; reconnect with backoff |
| `selfcheck.py` | Starts a fake hub on 127.0.0.1, runs the client, asserts the three core rules |
| `README.md` | This file |

## Requirements

- Python 3.8+ (standard library only — no pip install).
- A bothouse hub exposing the cloud-web gateway, e.g. `ws://127.0.0.1:<port>/cloud-web/ws`.

## Quick start (real hub)

Set the connection values in environment variables; never commit the auth value.

```bash
export CWIP_URL='ws://127.0.0.1:3000/cloud-web/ws'
export CWIP_AUTH='<bot-auth-value>'     # from the hub operator
export CWIP_BOT_ID='my-bot'
export CWIP_NAME='MyBot'
export CWIP_MENTION_ID='123'           # numeric mention id, if your platform has one
export CWIP_ROOM='1'                   # recommended: scope to one room
python cwip_bot.py
```

The same values can be passed as flags: `--url`, `--auth`, `--bot`, `--name`,
`--mention-id`, `--room`. Flags are visible in the process list, so prefer environment
variables for the auth value.

## Self-check (no real hub)

```bash
python selfcheck.py
```

Expected output:

```
SELF-CHECK PASS: registered via fake hub; replied once to mentioned/human; stayed silent for unmentioned and from_bot messages
```

The fake hub checks the register frame, query parameters and `Authorization` header,
then sends three messages:

1. `mentioned=true, from_bot=false` → the client must reply once;
2. `mentioned=false` → no reply;
3. `mentioned=true, from_bot=true` → no reply.

## Rules implemented (and why)

- **Only reply when `mentioned && !from_bot`** — prevents the bot from answering random
  channel chatter and prevents bot-to-bot reply loops.
- **Dedupe by `msg_id`** (last 500) — reconnects/replays can deliver a message twice.
- **Never parse mentions itself** — the hub computes `mentioned`; client-side parsing is
  language/format fragile.
- **Reconnect with backoff** — a `4003` means another process took over this member id;
  the old process should exit rather than fight for it.
- **Auth only from env/flags** — keep it out of source control and logs.

## What this example does NOT do

| Missing | Why |
|---|---|
| Pre-registration / room assignment by admin | M1 (persistent members) |
| Per-member credentials / rotation / revocation | M1 |
| Offline state, mention-offline feedback | M2 |
| Approval cards for high-risk actions | M2 |
| LLM call | Replace the marked line in `_on_message()` with your bot/LLM |

## Security notes

- Use `wss://` (TLS) or a protected tunnel for remote hubs; `ws://` is loopback-only.
- The current gateway uses one shared bot auth value; treat it as sensitive and rotate it
  via the hub operator if exposed. See the limitations section of `docs/external-member.md`.
- The example only logs message ids and reply counts, not the auth value.

## PR note (draft)

This directory is intended to land as `bridge/contrib/cwip-example/` in the bothouse repo.
It adds no runtime dependency and touches no core files (M3 scope). The client was
validated with `python selfcheck.py` (fake hub) on Windows + Python 3.13.
