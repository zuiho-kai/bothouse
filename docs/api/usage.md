# Local usage accounting

The bridge records terminal reply events from installation onward. It does not
reconstruct historical token consumption from chat history or context-window
snapshots. All roles in one bridge process share a ledger under
`<data_dir>/usage/YYYY-MM-DD.json`. Each private (0600) file contains turn records
and buckets keyed by date, hour, role/project name, and model. Writes use a synced
temporary file followed by replacement; corrupt files are reported and preserved.
Use one bridge process per shared data directory: the ledger's write mutex
coordinates roles within that instance, not separate bridge processes. The
existing instance lock is scoped to the config path, not the data directory.
No prompts, responses, session IDs, or credentials are stored in the ledger.

## Management endpoints

These GET endpoints use the existing management listener and its bearer token
(default configured port: 9820). They do not create another listener.

| Endpoint | Grouping |
| --- | --- |
| `/api/v1/usage/daily` | Daily totals, defaulting to the past year including today |
| `/api/v1/usage/hourly` | Hour of day (0–23), combined across the selected days |
| `/api/v1/usage/roles` | Role/project |
| `/api/v1/usage/models` | Model |

All accept `from=YYYY-MM-DD`, `to=YYYY-MM-DD`, `role`, and `model`. Dates are
inclusive local calendar dates; the maximum interval is one calendar year.
Missing days/hours are omitted, so charts should fill them with zero. Hours are
sorted numerically. Standard management responses wrap the result in
`{"ok":true,"data":...}`. `data` contains `from`, `to`, `timezone`, `group_by`,
and `items`.

Each item includes `input_tokens`, `output_tokens`, `cache_read_tokens`,
`cache_write_tokens`, `total_tokens`, `responses`, `unknown_usage_responses`,
and `unpriced_responses`, plus the relevant grouping field. `hour` is -1 outside
hourly/raw bucket grouping. Role and model filters can be combined with any
endpoint. The role identifier is the stable configured project name; a model
that the backend does not identify is stored as `unknown`.

Token categories do not overlap: input excludes cache reads/writes, and output
includes reasoning where the provider includes it. `total_tokens` is the sum of
the four categories. A terminal reply with no complete usage report still counts
as a response and increments `unknown_usage_responses`; any partial token fields
remain available. Unknown usage must not be displayed as a confirmed zero.
Synthetic/nonterminal compaction events do not count as completed replies.
Normal turns, unsolicited/background replies, and foreground/background relay
turns use the same ledger.

## Current backend coverage

- Claude Code: terminal `usage`, including cache reads and writes.
- Codex exec: terminal `turn.completed.usage`; cached input is removed from input.
- Codex app-server: cumulative thread usage deltas during the turn, excluding
  earlier history at the first observed notification and duplicate notifications.
- Other adapters currently have no complete billing usage wiring: ACP (including
  DSH), Antigravity, Antigravity hook, Copilot, Cursor, Devin, Gemini, iFlow, Kimi,
  OpenCode, Pi, Qoder, Reasonix, and tmux. They count responses with unknown usage;
  any token fields already emitted by an adapter are retained as partial data.

Nested provider subagent consumption is included only to the extent that the
backend's terminal usage includes it. There is no independent provider invoice
reconciliation. Failed/interrupted turns without a terminal result are not billed
by this ledger. Late/missing provider usage notifications cannot be reconstructed.

## Estimated cost

Prices are optional, keyed by the exact reported model ID in `config.toml`:

```toml
[usage_prices."example-model"]
input = 2.0
output = 4.0
cache_read = 0.2
cache_write = 2.5
```

These example numbers are arbitrary. All rates are per million tokens, in one
user-selected currency shared by every model. Values must be finite and
nonnegative. Restart after changing prices. Queries use the currently loaded
prices, including for previous days; these are estimates, not stored invoices.
`estimated_cost` is omitted when no complete, priced usage contributes. When a
bucket mixes priced and unpriced/unknown usage, the field estimates only the
priced portion and `unpriced_responses` identifies the incomplete coverage.

Clients must label the amount as estimated and surface incomplete coverage.
