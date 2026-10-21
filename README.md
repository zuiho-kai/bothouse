# bothouse

English | [中文](README.zh-CN.md)

**Soon everyone will work with several AIs at once. bothouse wants to be the first to turn them into one team: they split the work, hand it off, and remember.**

Install this plugin and your Claude Code / Codex / Gemini / DSH become a team with personalities, right inside Discord, Feishu, or your own self-hosted channel (DSH web coming soon). Install, click through the wizard, and you are done.

![bothouse in 15 seconds: a few clicks in the setup wizard, then call a teammate by name, the lead hands off work, the teammate reports back, and both share one memory](docs/launch/media/bothouse-15s.gif)

```sh
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/zuiho-kai/bothouse/main/install.sh | sh && cc-connect
```

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/zuiho-kai/bothouse/main/install.ps1 | iex; cc-connect
```

The first `cc-connect` run opens the setup wizard in your browser. No Go or Node needed.

**If bothouse is useful to you, a ⭐ helps others find it.**

## Why

Today every AI works alone. One window, one model. Open a new window and it forgets what you just said. Put a few AIs in one group chat and they all talk at once.

We think the missing piece is not a smarter model. It is what a team has: who answers, who does the work, who gets the result, and one memory they all share. That should not be locked inside one vendor's app. So bothouse is a plugin: it connects the AIs you already use to the chat platforms you already use.

We want to be the first to define what an "AI team" is, in the open. What works today is step one: one group, several AIs, one shared memory.

## Teamwork

- **Speaks only when called**: one lead answers by default. The other roles hear every message but speak only when you @ them or call them by name. Several AIs in one group do not all answer at once.
- **The lead hands off, the teammate reports back**: the lead @s a teammate with a task. The teammate's final answer @s the lead automatically, and the lead wraps up.
- **Bounded relays**: two teammates who @ each other for more than 3 rounds are handed to the lead. With no human in between, a channel stops after 20 bot-to-bot handoffs.
- **Teammate status** (optional): when it is on, the lead starts every turn knowing who is busy in which channel.
- **Interrupt while it works**: add a message while an AI is working and it joins the turn in progress. No need to wait.

## Memory

- **Shared wiki memory**: before every reply the plugin searches one shared wiki ([llm-wiki](https://github.com/zuiho-kai/llm-wiki)) for that message and hands the relevant pages to the role. When a session ends, it is distilled into the wiki. A role on a different model reads the same memory.
- **Sessions continue**: one session per channel, and it continues after a restart. Messages posted while a role was offline are handed to it before it answers.

## Where it plugs in

| Platform | What works today |
| --- | --- |
| Discord | The full team: call by name, handoffs, teammate status |
| Self-hosted channel | A Discord-like web channel you can start on your own machine; several roles, call by name, handoffs |
| Feishu (Lark) | One role chatting, for now |
| DSH web | Coming soon |

On the AI side: Claude Code, Codex, Gemini CLI, OpenCode and other CLIs you are already logged into work directly; agents that speak ACP, such as DSH, connect over ACP. You can also point a CLI at a third-party API (SiliconFlow, OpenRouter, DeepSeek, MiniMax, a local model, any OpenAI-compatible endpoint); see the [matrix](docs/connect-discord-feishu.md#4-第三方-api--本机-cli) (Chinese).

## Three steps

1. **Install**: run the one-liner above.
2. **Configure**: run `cc-connect`. In the wizard: pick a platform → connect the bots → pick a local CLI per role → persona → save. Or tell your Claude Code / Codex "set up cc-connect and connect it to Discord"; it asks for everything once and runs `cc-connect setup apply`.
3. **Use**: after saving, click "Restart to apply", then @ a role in your channel.

To let an AI decide who should answer, and to add the shared wiki memory, add the gate and the wiki: see [ccm and wiki](docs/ccm-and-wiki.md) (Chinese). The full walkthrough is in [Getting started](docs/GETTING_STARTED.md) (Chinese).

## Docs

| Doc | What is in it |
| --- | --- |
| [Getting started](docs/GETTING_STARTED.md) | Install, wizard, check it is online (Chinese) |
| [Connect Discord or Feishu](docs/connect-discord-feishu.md) | Every wizard step, let an AI configure it, third-party APIs (Chinese) |
| [ccm and wiki](docs/ccm-and-wiki.md) | The gate (who answers) and the shared wiki memory (Chinese) |
| [Teamwork details](bridge/MAOMAO.md) | Lead and subs, handoff rules, gate protocol |
| [Self-hosted channel protocol](bridge/docs/cloud-web.md) | The interface between the channel and the plugin |
| [Architecture](docs/ARCHITECTURE.md) | Modules and data flow (Chinese) |
| [Development history](docs/archive/README-2026-10-21.md) | Pre-launch progress tables and milestones, archived (Chinese) |

Contributors: start with [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md).

## License

bothouse is licensed under [MIT](LICENSE). See [LICENSING.md](LICENSING.md) (Chinese) for details.

bothouse is a plugin for platforms such as [cc-connect](https://github.com/chenhg5/cc-connect) and DSH. For a one-command install, `bridge/` ships a copy of cc-connect; its MIT notice is kept in [bridge/LICENSE-MIT-upstream](bridge/LICENSE-MIT-upstream). Thanks to the cc-connect authors and contributors. Third-party dependency licenses are in [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md).
