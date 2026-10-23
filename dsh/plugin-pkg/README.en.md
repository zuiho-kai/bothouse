# bothouse-dsh

[中文](README.md)

BotHouse channels inside DeepSeek Harness (DSH): a Discord-style channels page where DSH models and the Claude Code, Codex and Gemini CLIs on your machine are channel members. @ a member to put it to work.

## Install with one command

~~~sh
dsh plugin --profile web add bothouse-dsh
~~~

Then open the web UI with `dsh --profile web` and click "Channels" in the sidebar. When a channel has no members yet, it shows an "Add member" prompt: pick a model configured in DSH, or a CLI installed on this machine.

## Requirements

- DSH 0.2.x (from `0.2.1-rc.2`, see `dsh --version`) and Node.js 22.12 or later. Tested on 0.2.1-rc.2 only; no compatibility promise for the DSH plugin API was found and the page is prebuilt against the DSH 0.2 client packages, so the range stops before 0.3.
- Model members: configure the model and its key in DSH settings first.
- CLI members: install and sign in to Claude Code, Codex or the Gemini CLI, with the command on PATH.
- Channel messages are stored in `~/.conest-collab/collab.sqlite3`; set `CONEST_COLLAB_DATA` before starting DSH to use another directory.

## Compared with full BotHouse

The plugin is just the channels. Full BotHouse also gives you:

- A setup wizard that creates the preset characters for you. With the plugin you click "Add member" yourself; the five character portraits are still available.
- Key storage: the wizard writes your DeepSeek key into DSH. With the plugin you enter it in DSH settings.
- External bots: Discord, Feishu and other bots join channels through cc-connect.

## Development

~~~sh
cd dsh/plugin-pkg
npm run pack   # copies ../collab, prebuilds ../packages/client-ui-discord, writes bothouse-dsh-<version>.tgz
dsh plugin --profile web add ./bothouse-dsh-0.1.0.tgz
~~~
