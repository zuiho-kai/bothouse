# bothouse-dsh

[中文](README.md)

BotHouse channels inside DeepSeek Harness (DSH): a Discord-style channels page where DSH models and the Claude Code, Codex and Gemini CLIs on your machine are channel members. @ a member to put it to work.

## Install (pick one)

1. **Easiest**: tell DSH "install the plugin bothouse-dsh, pinned to the newest version on npm".
2. **From the UI**: DSH sidebar "Plugins" → "Add plugin", enter `bothouse-dsh@<newest version on npm>`, click "Install"; then switch bothouse on under "Installed plugins" — "Channels" appears in the sidebar right away, no restart.
3. **From a terminal**:

~~~sh
dsh plugin --profile web add "bothouse-dsh@$(npm view bothouse-dsh version)"
~~~

Pin the version: DSH installs plugins with pnpm, and pnpm's supply-chain policy skips very fresh releases, so plain `bothouse-dsh` or `bothouse-dsh@latest` can install a version from days ago. An exact version goes through at once (pnpm records it as an exclusion). Measured 2026-11-08 with pnpm 12.16.1: `bothouse-dsh` resolved to 0.1.57, then the newest release older than a day — 0.1.59 was 19 hours old and 0.1.60 about 30 minutes; `bothouse-dsh@0.1.60` resolved to 0.1.60.

Asked through DSH, "Channels" appears right after the install; installed from the command line while DSH is running, restart DSH once. Then click "Channels" in the sidebar. Team desk, bothouse panel and other computers start off; switch the one you want on under "Plugins → bothouse" and it appears in the sidebar right away. #general already has Whale Girl, running on the model you configured in DSH; nothing else to fill in. @ her to get a reply; tell her "hand this to a workspace: …" and she opens a workspace, does the work and reports back. For more characters or models, use "Add member".

If the terminal install says `pnpm was not found`, run `npm i -g pnpm` first.

## Requirements

- DSH 0.2.x (from `0.2.1-rc.2`, see `dsh --version`) and Node.js 22.12 or later. Tested on 0.2.1-rc.2 only; no compatibility promise for the DSH plugin API was found and the page is prebuilt against the DSH 0.2 client packages, so the range stops before 0.3.
- Model members: configure the model and its key in DSH settings first.
- CLI members: install and sign in to Claude Code, Codex or the Gemini CLI, with the command on PATH.
  For a Claude Code member, enter a model ID or alias in the member editor. Leave it blank to follow the CLI default; changes apply on the next turn.
  The Claude Code and Codex adapters are not installed with the plugin; they download the first time you add such a member (Claude Code about 125 MB).
- Channel messages are stored in `~/.conest-collab/collab.sqlite3`; set `CONEST_COLLAB_DATA` before starting DSH to use another directory.

## Compared with full BotHouse

The plugin is just the channels. Full BotHouse also gives you:

- A setup wizard where you pick the characters and which local CLI each one runs. The plugin adds one character (Whale Girl) on first start; add others with "Add member".
- Key storage: the wizard writes your DeepSeek key into DSH. With the plugin you enter it in DSH settings.
- External bots: Discord, Feishu and other bots join channels through cc-connect.

## Development

~~~sh
cd dsh/plugin-pkg
npm run pack   # copies ../collab, prebuilds ../packages/client-ui-discord, writes bothouse-dsh-<version>.tgz
dsh plugin --profile web add ./bothouse-dsh-0.1.0.tgz
~~~
