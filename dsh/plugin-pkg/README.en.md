# bothouse-dsh

[中文](README.md)

BotHouse channels inside DeepSeek Harness (DSH): a Discord-style channels page where DSH models and the Claude Code, Codex and Gemini CLIs on your machine are channel members. @ a member to put it to work.

## Install (pick one)

1. **Easiest**: tell DSH "install the plugin bothouse-dsh".
2. **From the UI**: DSH sidebar "Plugins" → "Add plugin", enter `bothouse-dsh`.
3. **From a terminal**:

~~~sh
dsh plugin --profile web add bothouse-dsh
~~~

Restart DSH once and click "Channels" in the sidebar. #general already has four characters (Ju, Whale Girl, Dragon Girl, Rainbow Cat) running on the model you configured in DSH; nothing else to fill in. @ a member to get a reply; tell Ju "hand this to a workspace: …" and she opens a workspace, assigns the work and reports back. Ju is the primary role by default; change it in the channel settings.

If the terminal install says `pnpm was not found`, run `npm i -g pnpm` first.

## Requirements

- DSH 0.2.x (from `0.2.1-rc.2`, see `dsh --version`) and Node.js 22.12 or later. Tested on 0.2.1-rc.2 only; no compatibility promise for the DSH plugin API was found and the page is prebuilt against the DSH 0.2 client packages, so the range stops before 0.3.
- Model members: configure the model and its key in DSH settings first.
- CLI members: install and sign in to Claude Code, Codex or the Gemini CLI, with the command on PATH.
- Channel messages are stored in `~/.conest-collab/collab.sqlite3`; set `CONEST_COLLAB_DATA` before starting DSH to use another directory.

## Compared with full BotHouse

The plugin is just the channels. Full BotHouse also gives you:

- A setup wizard where you pick the characters and which local CLI each one runs. The plugin adds four default characters on first start; add others with "Add member".
- Key storage: the wizard writes your DeepSeek key into DSH. With the plugin you enter it in DSH settings.
- External bots: Discord, Feishu and other bots join channels through cc-connect.

## Development

~~~sh
cd dsh/plugin-pkg
npm run pack   # copies ../collab, prebuilds ../packages/client-ui-discord, writes bothouse-dsh-<version>.tgz
dsh plugin --profile web add ./bothouse-dsh-0.1.0.tgz
~~~
