# Signed originator identity

`bothouse originator sign --action <action> --expires-at <RFC3339>` returns a
short-lived, single-operation identity ticket for the currently running agent
turn. The caller's `CC_PROJECT` and `CC_SESSION_KEY` select its active turn;
these values do not supply the person. Only the platform adapter's authenticated
`Message.UserID`, `Platform` and `MessageID` are signed.

The ticket contains `claims`, `key_id`, `public_key` and `signature`, all JSON
safe. It has no message body, username, private key, authorization role or
execution account. A deployment-specific gateway must authorize the signed
`platform:user_id`, project and action. There is deliberately no `--user` option.

## Who may ask for a ticket

`POST /originator/sign` is reachable by anything that can open the bridge socket,
and the request body's `project` and `session` come from `CC_PROJECT` /
`CC_SESSION_KEY` — environment the model can set itself before it runs the CLI.
So the body authorizes nothing. The bridge checks the caller instead:

1. It reads the peer pid of the unix socket connection (`SO_PEERCRED` on Linux,
   `LOCAL_PEERPID` on macOS).
2. It walks that pid's ancestry and looks for a process that is a **direct child
   of the bridge** and whose environment holds `CC_SESSION_KEY` together with
   `CC_AGENT`. That pair is what the bridge itself injects into the agent
   process it starts for a turn; the model cannot change what the bridge wrote
   there.
3. The request must name that process's own session, and its project when the
   process has one. Anything else is `403`.

Why "direct child of the bridge" matters: a model can set `CC_AGENT` and
`CC_SESSION_KEY` in its own shell and exec this CLI naming a different session.
That shell's parent is an agent process, not the bridge, so its forged variables
are never read. Only the bridge's own children are trusted. A command the model
runs through its tools still works: the CLI is a descendant of the agent process,
reaches it in the ancestry walk, and signs for that session.

A caller with no such ancestor (an unrelated program, a process another OS user
started, a platform where peer credentials are unavailable) is refused: unknown
is not permission. Note what this check is and is not:

- The ticket attests *who started this turn*. It does not attest what the person
  asked for: the action comes from the agent's own command line. An agent that
  may ask at all may ask for any action in that turn.
- Any process the bridge started that carries a session key can ask for that
  session's ticket while its turn is running — including a workspace role
  process, which carries the chat's session key.
- It does not isolate same-uid processes from each other: a same-uid process can
  read the bridge key and call the socket directly.

The bridge generates `<data-dir>/originator/ed25519.key` with owner-only access
on first signing. Back up that file securely. A verifier gets the public key from
an independent configuration channel and trusts its SHA-256 fingerprint in
`key_id`; never accept a previously unseen ticket key as its own trust root.

**Required deployment boundary:** run the bridge and agent processes as distinct
OS users. The Unix socket mode and key mode do not isolate same-uid processes.
This interface does not create such isolation. An agent that can read the bridge
key can forge tickets. Scheduled turns, batch turns containing multiple
instructions, unknown sessions, expired validity and non-platform turns do not
receive an originator ticket.

A batch is recognised by a structured flag the queue sets when it folds several
queued instructions into one turn (`queuedMessage.batched`), not by the merged
prompt's wording. A turn's grant is keyed by the message's own session key (the
one in `CC_SESSION_KEY`), which is also the key the signing endpoint looks up, so
the two cannot disagree in workspace mode.

Example (choose an expiry appropriate for the operation):

```sh
bothouse originator sign --action gpu.run --expires-at 2026-11-05T04:00:00Z > ticket.json
```

The signature is Ed25519 over the version 1 `OriginatorClaims` Go struct encoded
as JSON with HTML escaping **off** (field order as declared; no trailing
newline). This matters across languages: Go's default encoder escapes `&` `<`
`>` as `&`/`<`/`>` while Python's `json.dumps` emits them
literally, so a `user_id` such as `a&b` would sign as different bytes on each
side and fail verification. A verifier must build exactly these bytes — a
byte-for-byte check is in `TestOriginatorTicketPythonGatewayCompatibility`, which
runs the Python reference gateway against Go-issued tickets containing `& < >`.
Signature and key are base64 standard encoding; the nonce is base64 raw URL
encoding. An independent reference verifier is in `integrations/gpu-submit`.

## Reference GPU gate

`integrations/gpu-submit/gpu_submit.py` requires Python `cryptography`. It reads
a ticket, trusted-key map and policy, verifies validity, authorizes the exact
platform user + role + project + action, records the nonce, appends an owner-only
audit record, then invokes the configured adapter argument vector. The nonce is
written only after the signature and policy checks pass, so a forged ticket
leaves nothing behind; a second use of a verified nonce is refused before any
execution. No shell interpolation or model-provided execution account is
supported.

The adapter is intentionally deployment-specific: it must use a separate,
least-privilege service account and OS mechanism to execute as `execute_as`.
This reference does not implement `sudo`, SSH, GPU quota, sandboxing or remote
user provisioning; it must not be run as root with an unvalidated adapter.

Policy shape:

```json
{"principals":{"discord:123":{"role":"member","projects":{"kimi":{"execute_as":"alice-agent","actions":["gpu.run"],"command":["/srv/site/gpu-adapter"]}}}}}
```

Trusted keys shape:

```json
{"<sha256-of-raw-ed25519-public-key>":"<standard-base64-public-key>"}
```

Run tests in an isolated virtual environment:

```sh
python3 -m venv /tmp/gpu-submit-venv
/tmp/gpu-submit-venv/bin/pip install cryptography
/tmp/gpu-submit-venv/bin/python -I -m unittest discover -s integrations/gpu-submit -p 'test_*.py'
```

The Go side's cross-language check looks for an interpreter that can import
`cryptography` (`python3`, then `python`); point it at the virtual environment
above with `CC_TEST_ORIGINATOR_PYTHON=/tmp/gpu-submit-venv/bin/python`. With no
such interpreter the test skips and prints why — it does not pass.
