package main

// Help text for `cc-connect setup`. Field meanings follow core.WizardRequest / core.WizardResult
// (bridge/core/setup_wizard.go); keep the two in step.

const setupUsage = `Usage:
  bothouse setup apply --json <file|-> [--config path] [--dry-run]
                         Configure bots in one go (same as the web setup wizard). JSON in, JSON out.
                         Run "bothouse setup apply -h" for every JSON field.
  bothouse setup clis       Local CLIs (claude, codex, gemini, …): path, version, logged in or not
  bothouse setup matrix     Third-party API providers × CLIs: native or converted
  bothouse setup hub        The self-hosted platform (cloud_web) on this machine: running or not, can it be started
  bothouse setup hub start  Start it on this machine (127.0.0.1; needs uv), same as the wizard's "Start on this machine"
  bothouse setup personas [--lang zh|en]
                         Example personas you can copy into "persona" (the maintainers' own characters;
                         optional — leave persona empty to use none)
  bothouse setup hooks on|off|status --work-dir <dir> [--cli claudecode|dsh|gemini|antigravity|codex]
                         [--only a,b] [--lang zh|en]
                         Tool hooks (bash-guard, dispatch-review-guard, …) for one role: switch them on or off in
                         <dir>/.claude/settings.json and keep the rules block in its persona in step.
                         New Claude Code roles from the wizard get all of them. Run "setup hooks -h" for more.
  bothouse setup tools on|off|status --work-dir <dir> [--agent claudecode|codex|acp|…] [--only a,b] [--lang zh|en]
                         Small tools for one role (peek: what the other bots are doing; watchvid: turn a video
                         link into frames + transcript; websearch: free web search and page text) and the lines
                         in its persona that tell it how to use them. New roles from the wizard get all of them.

No config yet? Just run "bothouse": it opens the same wizard in your browser.
Guide: docs/connect-discord-feishu.md in the conest repo.
`

const setupApplyFields = `
Request JSON (only the fields marked REQUIRED must be given; everything else has a default):
  platform           "discord" (default) | "feishu" | "lark" | "cloud_web" (self-hosted platform, e.g. the role-household hub)
  language           reply language of the bots: "zh" | "en" | "ja" (any language code works) — ask the user.
                     Not given: this machine's locale (LANG); the
                     result says which (roles[].reply_language / reply_language_from + a
                     reply_language_default note). Also the language of the messages. Same as --lang.
  discord.guild_id   REQUIRED (Discord): ID of the server the bots live in
  discord.channel_id default chat channel ID (optional). With several bots, listening without an @ is
                     limited to it (group_reply_all_channels); @mentions and DMs work everywhere
  roles[]            REQUIRED: one entry per bot; one bot = one role
    token            Discord bot token of a new bot (REQUIRED for Discord unless reuse_project; not used by cloud_web)
    reuse_project    use a bot already in config.toml, by project name, instead of a token
    name             display name (default: the bot's Discord username; cloud_web: the project name)
    project          project name in config.toml (default: from name)
    agent_type       claudecode | codex | gemini | opencode | … (default: first logged-in CLI; see "setup clis")
    work_dir         default: ~/.bothouse/roles/<project>
    persona          text of the persona file (CLAUDE.md / AGENTS.md / GEMINI.md in work_dir).
                     Empty = no persona, only the reply-language line. Examples: "setup personas".
    edit_persona     true = also overwrite the persona of a reused bot (otherwise its file is left as is)
    reply_language   this role's reply language (default: language). For a bot that is already set up it
                     changes only the reply-language line of its persona file
    provider         {"vendor", "api_key", "base_url", "model"}: a third-party API instead of the CLI's own
                     login (vendors and native/converted: "setup matrix")
  fallback_role      project that answers when no one is addressed (default: first role); cloud_web: the
                     role's display name works too
  fallback_bot_id    the same, by Discord bot ID
  allow_from         Discord user IDs (comma-separated) the bots take orders from; "*" = anyone in the server.
                     Default: the owner of each bot's Discord application (looked up with the token).
                     Owner not found and none given: the bots obey no one (blocking warning). Written
                     to new bots and to existing bots whose allow_from is empty.
  jev                optional {"base_url", "api_key", "model"}: a model that returns probabilities, used to pick
                     who answers. Omitted = keep the current one (or none). {"remove": true} = stop using it.
  feishu             {"app_id", "app_secret", "platform_type", "chat_id", "owner_open_id"} for feishu/lark (one role)
  cloud_web          {"url", "token"} for platform "cloud_web": the platform's address (http://host:port or
                     https://domain) and its bot token. Both may be left out when "bothouse setup hub start"
                     (or the web wizard) started the platform on this machine: they are filled in from it.
                     Several roles are fine; each joins as one member (?bot=<project>, shown as its name).
                     A reused Discord bot (reuse_project) keeps its Discord settings and also joins the platform.
                     Wrong address or token: nothing is written (error says how to fix). Platform down right
                     now: saved with the blocking warning cloud_web_unreachable.
  wiki               optional {"daily", "night", "split"}: models of the memory wiki (~/wiki or $WIKI_DIR with
                     bin/ingest.py). daily = every 30 minutes, new sessions into the wiki; night = nightly review,
                     reflection and the weekly lint; split = splitting pages/domains that are full. Values: haiku |
                     sonnet | opus | codex:high | agy. Omitted = keep (ingest.py's defaults: haiku, codex:high,
                     codex:high); written to the wiki's config.json. With a wiki, the three scheduled runs (every
                     30 min; 03:00 Mon-Sat; 03:00 Sun) are also added as muted cron jobs (step "wiki cron"), once.
  dry_run            true = same as --dry-run: check everything (token, server, intent), write nothing

Minimal Discord request:
  {"discord": {"guild_id": "<server ID>"}, "roles": [{"token": "<bot token>"}]}
Minimal self-hosted platform request (after "bothouse setup hub start"):
  {"platform": "cloud_web", "roles": [{"name": "<display name>"}]}

Output JSON:
  ok                 true = saved (or, with --dry-run, would save) and nothing is left for the user to do
  saved              the config was written
  needs_user_action  true = see warnings with blocking=true; the bot will not work until they are done
  warnings[]         {code, blocking, message, fix, url}; codes: cloud_web_unreachable, message_content_intent_off,
                     message_content_intent_unknown, bot_not_in_guild, allow_from_unknown (owner not found: the
                     bots obey no one until you give allow_from), allow_from_everyone (you gave "*"),
                     gate_not_running (no gate is fine:
                     @-mentioned roles and the fallback role answer), discord_token_invalid (blocking:
                     reset the token in the Developer Portal), agent_not_logged_in (blocking: the role's
                     CLI is not logged in, fix says how), agent_login_unknown, reply_language_default
  invite_urls        links that add bots to the server (bots not in it yet)
  allow_from         who the new bots take orders from
  cloud_web          platform "cloud_web": the connection test {ok, code, message, fix, page_url}
  next_steps         how to start or restart bothouse (in the background: bothouse daemon install;
                     never run bothouse in the foreground from an agent's shell — it does not exit)
  steps, roles, fallback_role, gate_running, gate_hint, jev_ok, jev_reason, jev_hint, config_backup, error
Exit code: 0 when ok, 1 otherwise (also when saved but needs_user_action).
`
