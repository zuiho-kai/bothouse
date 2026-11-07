# DSH panel read APIs

All endpoints use the management API authentication and return the usual `{ "ok": true, "data": ... }` envelope.

`GET /api/v1/dsh/summary` retains `running`, `members`, and `channels`. `status` is `running` after a successful DSH state read, `stopped` when no running host is discovered, and `error` when the host state or DSH state cannot be read. `running` is true only after a successful state read. On error, `error` is a safe display message. Successful empty arrays mean the read succeeded with no entries. Members include entries with a non-empty ID whose kind is not `human`, including `bot` entries such as bridge bots. The frontend deduplicates bridge agents when combining or counting these entries. A model object is displayed by its model field; null is an empty string.

Each channel remains in `channels` when its latest-message read fails, with an optional safe `error` string. A successful empty message list has no error and a null `last_message`.

`GET /api/v1/roles` retains `roles` and adds `dsh: { status, error? }` with the same state semantics. Bridge roles remain present if DSH cannot be read.

## Member management

The Roles page uses `GET /api/v1/dsh/members` to associate each DSH row with its stable member ID and server-provided `source`, `can_edit` and `can_delete`. Only UI roster members with the corresponding permission expose edit or delete; config and external members remain read-only. Daily add, edit and delete use `POST /api/v1/dsh/members`, `PATCH /api/v1/dsh/members/{id}` and `DELETE /api/v1/dsh/members/{id}`. The ID is URL-encoded. An installed DSH takes the add-role entry directly to this flow; initial installation remains in the setup wizard.

Native DSH members select `model: {provider, model}` from `GET /api/v1/dsh/model-routes`, or leave it null to use the DSH default. Codex members use the separate `cliConfig` model and `reasoningEffort`: `POST /api/v1/dsh/cli-options` probes advertised options without prompting, and selecting a model probes again for the matching effort choices. A saved configuration is desired state, not proof that it has taken effect. The target configuration is applied before the member's next turn. The member view reports `apply.timing: next_turn` and `apply.status` as `pending` for managed CLI configuration or `not_configured` otherwise; it does not report an application result. Other CLI members use local CLI authentication and configuration.

Bridge provider settings affect bridge projects that reference them. DSH routes are managed in the DSH shell under Settings → Models. The panel links to the shell home because there is no confirmed stable deep link. The dashboard and role page refresh on the global refresh command, when returning to a visible page, and periodically while visible; an older response cannot replace a newer one.
