# qq-gate: QQ group gate with an optional judging model

A small `/decide` server for a QQ bot (standard-library Python, no install).
It speaks the cc-connect gate protocol (`core/gate.go`), so it plugs in through
the existing `gate_url` setting. Messages it answers `silent` stay in the
engine's buffer and are handed over with the next reply.

Without a gate, nothing changes. With the gate and the judge off (default), the
bot only answers private chats, @-mentions and messages that contain one of its
configured `names`.

## Rules

| Message | Action |
| --- | --- |
| `gate_url`'s `?bot=` differs from the config's `bot` | silent |
| private chat (`qq:{uid}`) | reply |
| @-mention, or a configured name in the text | reply (no model call) |
| addressed to another bot | silent |
| judge off or incomplete config | silent |
| judge says reply (and `cooldown_s` has passed) | reply |
| judge says no, unclear output, timeout, HTTP/connection error, missing API key | silent |

## Judge modes

`judge.mode` in the config file:

- `off` (default): no model.
- `openai`: any OpenAI-compatible `/chat/completions`.
  - Self-hosted (vLLM, llama.cpp, mlx_lm, Ollama's `/v1`, ...): set
    `base_url` and `model`, no key. `no_proxy: true` skips `HTTP(S)_PROXY`.
  - Remote API: also set `api_key_env` to the name of an environment variable
    holding the key. The key is never read from the config file, and with the
    variable unset the gate does not send the request.
  - `extra_body` is merged into the request, e.g.
    `{"chat_template_kwargs": {"enable_thinking": false}}` for Qwen3-style templates.
- `url`: a self-hosted custom endpoint. The gate POSTs
  `{"prompt", "text", "group", "recent", "last_reply_age_s"}` and accepts
  `{"reply": true|false}` or `{"action": "reply"|"silent"}`.

The model must answer `{"reply": true}` or `{"reply": false}` and nothing
else: the whole content is parsed with `json.loads`. Text around the JSON, code
fences, a repeated key (`{"reply": true, "reply": false}`), both `reply` and
`action`, or a non-boolean `reply` count as "unclear" and the bot stays quiet.
A custom endpoint's body follows the same rule (other keys such as `reason`
are allowed).

## Config

| Key | Default | Meaning |
| --- | --- | --- |
| `bot` | `""` (main bot) | the `?bot=` of this role's `gate_url`; other bots' requests get `silent` |
| `names` | `[]` | names that count as calling the bot |
| `context_messages` | 8 | recent messages of the same session sent to the judge (memory only), integer >= 1 |
| `context_chars` | 0 (no cut) | cut each remembered message to this many characters, integer >= 0 |
| `cooldown_s` | 0 | minimum seconds between judge-approved replies per session (0 = none), >= 0 |
| `host` / `port` | `127.0.0.1` / 13013 | listen address (`QQ_GATE_PORT` overrides) |
| `judge.prompt` | neutral built-in | system prompt; replace to fit your bot |
| `judge.timeout_s` | 2.5 | > 0; keep it below the engine's `gate_timeout_ms` (default 3000) |
| `judge.max_tokens` | 20 | answer length, integer >= 1 |

A number outside its range (negative, zero where not allowed, a string, a
boolean, NaN/inf) stops the gate at startup with `qq-gate: bad config: ...`.

One gate serves one role. Context and cooldown are kept per
(`bot`, `session_key`), so two bots or two sessions never share what the judge
sees. For several QQ bots, run one gate per bot on its own port with its own
`bot`, `names` and prompt.

Examples (no secrets): `gate.off.example.json`, `gate.selfhosted.example.json`,
`gate.api.example.json`, `gate.url.example.json`.

## Run

```sh
cp gate.selfhosted.example.json gate.json   # edit names / base_url / model
QQ_GATE_CONFIG=gate.json python3 gate.py
curl -s localhost:13013/healthz
```

In the QQ project's config:

```toml
gate_url = "http://127.0.0.1:13013/decide"
```

The gate keeps recent messages in memory only and never logs message text or keys.

## Tests

```sh
cd bridge/contrib/qq-gate && python3 -B -m unittest test_gate -v
```

The judge's HTTP opener is faked; no model is called.
