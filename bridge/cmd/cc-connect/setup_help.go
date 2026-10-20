package main

// Help text for `cc-connect setup`. Field meanings follow core.WizardRequest / core.WizardResult
// (bridge/core/setup_wizard.go); keep the two in step.

const setupUsage = `Usage:
  cc-connect setup apply --json <file|-> [--config path] [--dry-run]
                         Configure bots in one go (same as the web setup wizard). JSON in, JSON out.
                         Run "cc-connect setup apply -h" for every JSON field.
  cc-connect setup clis       Local CLIs (claude, codex, gemini, …): path, version, logged in or not
  cc-connect setup matrix     Third-party API providers × CLIs: native or converted
  cc-connect setup personas [--lang zh|en]
                         Example personas you can copy into "persona" (the maintainers' own characters;
                         optional — leave persona empty to use none)

No config yet? Just run "cc-connect": it opens the same wizard in your browser.
Guide: docs/connect-discord-feishu.md in the conest repo.
`

const setupApplyFields = `
Request JSON (only the fields marked REQUIRED must be given; everything else has a default):
  platform           "discord" (default) | "feishu" | "lark"
  language           "zh" | "en" | … language of messages, and the default reply language (default: system locale)
  discord.guild_id   REQUIRED (Discord): ID of the server the bots live in
  discord.channel_id default chat channel ID (optional). With several bots, listening without an @ is
                     limited to it (group_reply_all_channels); @mentions and DMs work everywhere
  roles[]            REQUIRED: one entry per bot; one bot = one role
    token            Discord bot token of a new bot (REQUIRED unless reuse_project)
    reuse_project    use a bot already in config.toml, by project name, instead of a token
    name             display name (default: the bot's Discord username)
    project          project name in config.toml (default: from name)
    agent_type       claudecode | codex | gemini | opencode | … (default: first logged-in CLI; see "setup clis")
    work_dir         default: ~/.cc-connect/roles/<project>
    persona          text of the persona file (CLAUDE.md / AGENTS.md / GEMINI.md in work_dir).
                     Empty = no persona, only the reply-language line. Examples: "setup personas".
    edit_persona     true = also overwrite the persona of a reused bot (otherwise its file is left as is)
    reply_language   default: language
    provider         {"vendor", "api_key", "base_url", "model"}: a third-party API instead of the CLI's own
                     login (vendors and native/converted: "setup matrix")
  fallback_role      project that answers when no one is addressed (default: first role)
  fallback_bot_id    the same, by Discord bot ID
  allow_from         Discord user IDs (comma-separated) the bots take orders from; "*" = anyone in the server.
                     Default: the owner of each bot's Discord application (looked up with the token).
                     Owner not found and none given: the bots obey no one (blocking warning). Written
                     to new bots and to existing bots whose allow_from is empty.
  jev                optional {"base_url", "api_key", "model"}: a model that returns probabilities, used to pick
                     who answers. Omitted = keep the current one (or none). {"remove": true} = stop using it.
  feishu             {"app_id", "app_secret", "platform_type", "chat_id", "owner_open_id"} for feishu/lark (one role)
  dry_run            true = same as --dry-run: check everything (token, server, intent), write nothing

Minimal Discord request:
  {"discord": {"guild_id": "<server ID>"}, "roles": [{"token": "<bot token>"}]}

Output JSON:
  ok                 true = saved (or, with --dry-run, would save) and nothing is left for the user to do
  saved              the config was written
  needs_user_action  true = see warnings with blocking=true; the bot will not work until they are done
  warnings[]         {code, blocking, message, fix, url}; codes: message_content_intent_off,
                     message_content_intent_unknown, bot_not_in_guild, allow_from_unknown (owner not found: the
                     bots obey no one until you give allow_from), allow_from_everyone (you gave "*"),
                     gate_not_running (no gate is fine:
                     @-mentioned roles and the fallback role answer)
  invite_urls        links that add bots to the server (bots not in it yet)
  allow_from         who the new bots take orders from
  next_steps         how to start or restart cc-connect (in the background: cc-connect daemon install;
                     never run cc-connect in the foreground from an agent's shell — it does not exit)
  steps, roles, fallback_role, gate_running, gate_hint, jev_ok, jev_reason, jev_hint, config_backup, error
Exit code: 0 when ok, 1 otherwise (also when saved but needs_user_action).
`
