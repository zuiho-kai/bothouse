<p align="center"><img src="docs/assets/bothouse-lockup.svg" alt="bothouse" width="320"></p>

# bothouse

English | [中文](README.zh-CN.md)

**Tell it before bed. Collect the result when you wake up.**
bothouse puts a crew of AIs on the night shift: several jobs moving at once, all night long, and none of them drifting off script.

> While everyone else is making wishes at a chat box, you're running a team that never clocks out.

**All night, many jobs at once, still on script.**
Every handoff carries your own words down the line, so whoever picks the job up, at whatever stage, works from what you actually said. The people who do the work don't sign it off — a fresh AI checks it instead. When a sub-agent runs out of context it writes a handoff first; a session that has sat idle too long gets a handoff and a fresh start too. No slow slide into confusion. And the team shares one memory, so what was settled today still counts tomorrow.

**You sleep. It works.**
Scheduled jobs and long jobs sit in the background and keep moving overnight. In the morning the channel has your report: what got done, how it was checked, what's still stuck.

**Several jobs in parallel, still under control.**
The lead role breaks the job up and spreads it across workspaces, one owner per job. Who's on what, how far along, where it's stuck — all on the same task card, readable at a glance.

**Expensive models, only where the work is hard.**
Chat and small chores go to a cheap model; the hard jobs get the expensive one. Which channel uses which model is fixed in config, so the money goes where it counts.

**Control it from anywhere.**
Discord gets the full team, Feishu starts with a single role, and the self-hosted web channel runs on your own machine. Add a line from your phone and Claude Code or Codex picks it up mid-task, as do ACP roles like DSH that support it; other CLIs such as codex exec take it next turn.

## What it looks like

<img src="docs/assets/demo-team.en.gif" alt="Real channel footage: the chat channel hands work to workspaces, tasks are dispatched, accepted and handed back there, the task board groups them, and chat carries on" width="760">

Real channel footage: chat hands work to a workspace, the workspace dispatches it, the task board shows it all at a glance, and chat carries on.

## How you use it

**One, you say it once.**
In the channel you tell the lead role: build me a dashboard — I want to see what each role spent today.

**Two, it splits the work and hands it out.**
The lead breaks the job into pieces — a stats page, a menu-bar icon, a roles panel, and an interface for plugging in desktop pets later — and gives them to several AIs at once. Who took what, which piece they're on, where they're stuck — all on one task card, in the channel. You don't go window to window asking "how's it going".

**Three, you come back for the result.**
Each piece goes back to the lead when it's done. The lead checks it, then sends you one reply: what changed, how it was verified, what didn't get done.

You can cut in at any point. On Claude Code and Codex (app-server), what you add while an AI is working lands in the task it's already holding; ACP agents such as DSH do the same when they report support at handshake. Other CLIs, such as codex exec, queue it instead: the AI picks it up after the current turn ends.

## Why not just another chat window

In a one-to-one chat, you are the one holding the context: how far this got, why it was changed last time, what's still untouched. Close the window and it's gone.

bothouse gives that to the lead: every task has an owner, a source, and a result; the AIs share one memory, so what was decided today is still there tomorrow; the task card shows who's busy with what.

The AIs are the ones you already have. Your local Claude Code, Codex and Gemini become roles as they are — same account, same subscription.

## Quick start

### Core install

Download the `.dmg` (macOS) or `.exe` (Windows) from [Releases](https://github.com/zuiho-kai/bothouse/releases), or use the commands below. Section 1 of [Getting started](docs/GETTING_STARTED.md) (Chinese) covers fixed versions and checksums.

```sh
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/zuiho-kai/bothouse/main/install.sh | sh && bothouse
```

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/zuiho-kai/bothouse/main/install.ps1 | iex; bothouse
```

Installs the newest release, pre-releases included. The installer verifies SHA256SUMS; set CONEST_VERSION=<tag> to pin a version.

The command is `bothouse`. No Go or Node required.

Release downloads: `bothouse-mac.dmg` (universal Bothouse.app for Apple Silicon and Intel; drag it to Applications, then double-click), `bothouse-windows.exe` (x64, also runs on ARM64 Windows; double-click), and `bothouse-linux-x64` / `bothouse-linux-arm64` (`chmod +x`, then run). On macOS the app is unsigned: right-click → Open the first time. First launch opens the browser setup wizard. Verify downloads with `SHA256SUMS`.

**You'll need:** a Discord server (or a Feishu workspace) and at least one AI CLI you're already logged into (Claude Code, Codex or Gemini CLI). The wizard walks you through creating the bot.

1. **Install**: download and open the app, or run the one-liner above.
2. **Configure**: run `bothouse`. The wizard opens in your browser: pick a platform → connect the bots → pick a local CLI per role → persona → save (new roles default to YOLO / auto-approve permission mode, adjustable in project settings).
   Or tell your Claude Code / Codex "set up bothouse and connect it to Discord"; it asks for everything once.
3. **Use**: after saving, click "Restart to apply", then @ a role in your channel.

To let an AI decide who should answer (a small component we call the gate, think of it as a dispatcher), or to add the team memory, install two more pieces: see [the dispatcher and the team memory](docs/ccm-and-wiki.md) (Chinese).
The full walkthrough is in [Getting started](docs/GETTING_STARTED.md) (Chinese). English docs are on the way.

### DSH channel (experimental)

DSH setup: choose **DSH** in the first wizard step, then detect dsh → install plugins → run the returned command to open DSH web. Bots, CLIs, personas and models are configured in DSH afterwards. The wizard passes Chinese or English to the installer. The installer already bundles the DSH files it needs, so it works after install; use `BOTHOUSE_DSH_DIR` when developing or to override them. CLI equivalent: `bothouse setup dsh install --lang zh`.

You need an existing DSH (`>= 0.2.1-rc.2`) and `pnpm`; without `pnpm` on PATH the plugin command fails with exit 127. The plugin package requires Node `>= 22.12.0`.

The channel plugin can also be installed straight from GitHub:

```sh
dsh plugin --profile web add 'github:zuiho-kai/bothouse#dsh-plugin&path:dsh/plugin-pkg'
```

## Platform support

| Platform | Status | What works today |
| --- | --- | --- |
| Discord | Full | The full team: call by name, handoffs, teammate status, log channel |
| Self-hosted channel | Team mode | A Discord-like web channel you can start on your own machine; several roles, call by name, handoffs |
| Feishu (Lark) | Single role | One role chatting, for now |
| DSH web | Experimental | A Channels page inside DSH web, see [DSH channels](dsh/collab/README.md) |

Connect to Discord or Feishu and you get phone, desktop and browser for free. No extra app to install.
Plug into DSH and our guardrails and tools install through DSH's own plugin system. We don't rebuild it.

On the AI side: Claude Code, Codex, Gemini CLI, OpenCode and other CLIs you're already logged into work directly; agents like DSH connect over a standard protocol (ACP).
You can also point a CLI at a third-party API (SiliconFlow, OpenRouter, DeepSeek, MiniMax, a local model, any OpenAI-compatible endpoint); see the [matrix](docs/connect-discord-feishu.md#4-第三方-api--本机-cli) (Chinese).

## Anywhere access (Tailscale)

bothouse runs on your own machine, and its control panel is a web page. Install Tailscale and your phone, tablet
or another laptop opens that same page: see how the team is doing, what each role spent today, and drop a line
or hand over a new job right in the chat page. No extra app, no moving the machine into someone else's cloud.

### 1. Install Tailscale

Install and sign in on the machine running bothouse, then install the same client and sign in with the same
account on your phone or the other computer. Once both ends are in the same tailnet they can reach each other.

```sh
# macOS
brew install --cask tailscale
# Linux
curl -fsSL https://tailscale.com/install.sh | sh
```

Then get this machine's Tailscale address — note the `100.x.y.z` it prints:

```sh
tailscale ip -4
```

### 2. Point the panel at the Tailscale address

The easy way is to let bothouse do it: send `/web setup` to the bot in a channel, or run `bothouse web` on the
machine running bothouse. Either one turns on both the panel and the channel the chat page talks over, generates
a token, and asks you to restart once.

To write the config yourself, edit `config.toml`. The default file is `~/.bothouse/config.toml`; if there is a
`config.toml` in the current directory, that one wins.

```toml
[management]
enabled = true
host = "100.x.y.z"        # the output of tailscale ip -4 above
port = 9820               # panel port, 9820 by default
token = "replace-with-a-long-random-secret"

[bridge]
enabled = true            # the chat page needs this; without it you can look but not talk
```

With `host` set to this machine's Tailscale address, the panel waits for you on that address only. Leave `host`
empty and a normally running bothouse listens on every interface; only setup mode, before any platform is
configured, defaults to loopback `127.0.0.1`. So set `host` explicitly for remote access — don't count on the
default.

The chat page also needs `[bridge]` on: the panel alone does not carry its live connection, and only with
`[bridge] enabled = true` does it connect. With it on, that channel is reachable both through the panel port and
separately on port 9810 across every interface, outside the `host` setting above — so if you want only your tailnet
to reach it, cover 9810 in your firewall or Tailscale access rules too.

Tailscale has to be up before bothouse starts, including after a reboot. Save the config and restart bothouse.

### 3. Where the panel token comes from

Signing in takes a token: the `token` in `[management]`. Three ways to get it:

- **Ask in the channel.** Send `/web setup` to the bot; it replies with the panel URL and the token, generating
  one if the panel was never enabled.
- **Read it in the terminal.** On the machine running bothouse, run `bothouse web --no-browser`: it prints the URL
  and the token without opening a browser. If the panel was never enabled, that command turns it on first and asks
  you to restart once.
- **Open the config.** The `token` line under `[management]` in `config.toml`.

With the token in hand, open `http://100.x.y.z:9820/` on your phone. The first field is the token; the second,
"server URL", is optional and already points at the address you opened the page from. Fill it in once and the
browser remembers it.

### 4. What you can do from a phone

Everything is in the sidebar once you are signed in:

- **Dashboard and usage**: version, uptime, which platforms are connected, how many projects; tokens spent today
  and this month, split by role and by model, plus a heatmap by day and hour.
- **Roles, projects, skills, providers, devices**: add a role, edit a persona, switch a model from the phone, then
  restart on the system page.
- **Chat**: pick a project, read the whole conversation, and keep talking. What you type goes in as a message to the
  role in the middle of its job, exactly like speaking to it in Discord.
- **Cron, library, system**: see scheduled jobs, browse the library, change global settings.

The page ships a mobile viewport, so a phone browser works as-is. On a narrow screen, tap the arrow at the bottom of
the sidebar to collapse it to icons only and give the content the full width.

Hand over a job between meetings, or check how far the night shift got on the way home — it is all in your pocket.

### 5. Same thing from another computer

No reinstall on the other laptop: install Tailscale, join the same tailnet, open the same URL, and you can chat,
hand over work and read usage there too. One always-on machine is the brain; laptops and phones are windows onto
the same team.

## Features

### Chat channel + workspaces: the chat never gets blocked

- Ask for something big in the chat channel and the lead hands the whole job to Workspace 1, then comes back to keep chatting with you. When Workspace 1 is busy, Workspace 2 opens on its own.
- Inside a workspace the lead splits the job and @s teammates; they reply 【接】 (taking it) and 【交回】 (handing it back). Anything that needs your decision comes back to the chat channel, so you only watch one place.
- The task board groups work by chat channel → workspace → role: who is on what, and how much is done. Before handing off, the lead checks whether that teammate is busy in another workspace.
- Dispatch mode is per channel: single model with several processes, full team, or mixed (default).
- In the DSH channel page, type "/" to see every capability and how to use it.

### A team, not a pile of chatbots

- **Speaks only when called.** One lead answers by default. The others hear every message but speak only when @-ed or named. Several AIs in one group don't all answer at once.
- **Hand off, report back.** The lead @s a teammate with a task. The teammate's final answer @s the lead automatically, and the lead wraps up.
- Teammate status is an optional switch: turn it on and the lead starts every turn knowing who's busy in which channel.
- Add a message while an AI is working and it picks it up mid-task, no waiting.
- To swap the lead, just say "Whale, you lead now" or "Back to opus"; the default responder changes on the spot.
- One session per channel, and it continues after a restart. Messages posted while a role was offline are handed to it before it answers.

### jev, the dispatcher: a small model decides who answers

With several AIs in one group, who should answer a message? bothouse brings in a small model as the dispatcher. We call it jev.
It answers one multiple-choice question: should opus answer this, or Whale, or nobody? A message that names someone goes to them; everything else goes to jev.

- **A free SiliconFlow model is enough.** No thinking mode needed. Fill in three boxes: base URL, key, model name.
- **Or run a small model locally**, such as Qwen 0.6B, and dispatch without going online.
- Set it up right in the install wizard. It tests the model as soon as you fill it in.

### One team memory that grows

Memory is a directory of markdown files you can open and edit. The team shares one main memory; each role keeps its own.

- Each page holds current state, key facts, decisions and pitfalls, open items. The git log is literally "what the AI remembered today"; if it got something wrong, edit the file.
- **Pages come to the role; it doesn't have to go looking.** Every incoming message is first searched against the wiki, and the matching pages are placed in front of it.
  Whatever the group is talking about, the role has the right page in hand, mid-session too.
- **Model-agnostic.** opus on Claude, Whale on DSH, Writer on Codex: all three read the same memory.

The memory layer is the open [llm-wiki](https://github.com/zuiho-kai/llm-wiki). It remembers one person and one assistant. bothouse shares it across several roles, records what Claude, Codex and DSH each did, hands the relevant pages to a role with every message, and reviews it nightly.

### Guardrails and small tools included

- **Guardrails:** dangerous commands are stopped first. If an AI says "fixed" with no proof, it gets sent back. If it promises to "check back later" without setting a timer, same thing. Claude Code and DSH share one set.
- **Small tools:** see what each teammate is doing right now, turn a video into text and frames, free web search.
- Don't want one? Tell the bot in the chat: "turn the checks off."

### A review every night

- **Day, a cheap fast model.** When a session ends, sits idle for 30 minutes, or hits a problem mid-session, the new content is distilled into the wiki.
- **Night, a free, slow model that reads carefully.** It checks every batch written during the day against the original transcript: fixes errors, fills gaps, removes duplicates. On Sundays it reads the whole wiki for a check-up.
- The last step each night is the dream: it reads only what you said during the day, turns the things you kept correcting into rule candidates, and writes a short "today's reflection".
- Every quote in a candidate is checked word for word against what you actually said, so nothing made up gets in. A candidate becomes a rule only when you say yes; it never changes your rules behind your back.
- After the dream, the lead gets a turn in the channel, so the next morning you can see what the team learned yesterday.

## How it compares

| You may be looking at | What it solves | How bothouse differs |
| --- | --- | --- |
| Orca and other multi-agent IDEs | One person watching several coding tasks at once | It's a workbench; we're a team. Agents there are opened per task and closed after. Here they're resident colleagues who live in your group chat and remember yesterday: you can assign work from your phone in a chat, instead of babysitting an IDE |
| ai-memory, agentmemory, TencentDB Agent Memory | Giving an agent a memory store | They're databases; we're a wiki. You can read and edit it; matching pages reach the role before every message; it's reviewed every night |
| llm-wiki | Memory for one person and one assistant | It's our memory layer. bothouse shares it across several roles, records what Claude, Codex and DSH each did, hands pages to a role with every message, and reviews it nightly |
| Claude Code agent teams, CrewAI, MetaGPT | Spinning up a crew for one task | They spin up a fresh crew per project, and every crew re-reads the background, so you pay for the same understanding again and again. Ours stay: one generalist reads the knowledge base and takes any project, and spins off temporary sub-agents when needed, with long-lived specialists on the roadmap. By design, you don't pay for the same background on every project (we haven't measured how much it saves yet) |

```
traditional agent team                       bothouse
project A ─ temp PM ─ temp coder ─ temp QA    you ─@─ opus   (resident, own session and wiki)
project B ─ temp PM ─ temp coder ─ temp QA           ├─ @Whale  (resident, DSH) ─ spawns sub-agents when needed
(disbands after the task, context rebuilt)           └─ @Writer (resident, Codex)
                                              projects A/B/C all flow through the same few people
```

## Roadmap

What works today is step one: one group, several AIs, one shared memory. What we want next:

- **No double-grabbing.** The lead already checks whether a teammate is busy in another workspace before handing off; next, a role claims a task before touching it, so two roles never collide.
- **Roles that grow roles.** Say "we need to ship to the App Store", and the lead spins up a release specialist who reads your past decisions, does the job, and retires. You don't create them one by one.
- Hiring a role should work like hiring a person: role packs bundle persona, memory template and tools, one click into the group.
- The library should grow plugins and a market: packs that carry code plugins, plus an online market to browse and install personas and avatars others made.
- A memory you can take with you: new machine, new model, same team, same memory.
- Resident roles shouldn't re-read the project for every task, which saves the repeated background. We'll publish numbers when we have a real comparison.
- Team features should reach more platforms: DSH web channels first, then Telegram, Slack, QQ, WeCom (single-role connections already ship with bothouse).
- DSH channel: send images and quote replies.
- A workspace that closes its last task clears its own context, so the next job starts fresh.
- Memory should get smarter: semantic search next to keyword search, so a different wording still finds the page.

None of this is built yet. Watch the repo to follow along.

## How it works

```
Discord / Feishu / self-hosted web channel
        │
  platform adapter ──► engine (channel sessions, queue, handoffs) ──► agent adapter ──► local CLI or ACP agent
        ▲                      │          ▲
        │                      ▼          │
        │        dispatcher / gate (who answers) ◄──┤
        │                      │          │
        └──── replies ◄────────┘   shared wiki (searched per message, reviewed at night)
```

Modules and data flow: [Architecture](docs/ARCHITECTURE.md) (Chinese).

## Docs

| Doc | What's in it |
| --- | --- |
| [Getting started](docs/GETTING_STARTED.md) | Install, wizard, check it's online (Chinese) |
| [Connect Discord or Feishu](docs/connect-discord-feishu.md) | Every wizard step, let an AI configure it, third-party APIs (Chinese) |
| [The dispatcher and the team memory](docs/ccm-and-wiki.md) | The gate (who answers) and the shared wiki memory (Chinese) |
| [Persona library and packs](docs/persona-packs.md) | Pick personas and avatars, make your own, install packs (Chinese) |
| [Per-role wiki and nightly review](bridge/contrib/wiki/README.md) | One wiki per role, scheduled distilling, the review (Chinese) |
| [Guardrails and tools](bridge/contrib/hooks/README.md) | Hook rules, how to switch them off, [small tools](bridge/contrib/tools/README.md) |
| [Self-hosted channel protocol](bridge/docs/cloud-web.md) | The interface between the channel and the plugin |
| [Architecture](docs/ARCHITECTURE.md) | Modules and data flow (Chinese) |

Contributors: start with [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md).

Source builds with the web management dashboard must build the frontend before
Go compilation and omit `no_web`. See [dashboard builds and private remote
access](docs/dashboard-source-build.md).

### Collaboration helper scripts

Install the packaged task board, timer, handoff and lead helpers for a role with
`bothouse setup lead install --work-dir /path/to/role --agent codex`.
See [configuration and requirements](bridge/contrib/lead/README.md).

## License

bothouse is licensed under [Apache-2.0](LICENSE). See [LICENSING.md](LICENSING.md) (Chinese) for details.

The bundled upstream bridge retains its MIT notice in [bridge/LICENSE-MIT-upstream](bridge/LICENSE-MIT-upstream). Thanks to its authors and contributors. See [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md) for dependency licenses.

### Local token usage

The management API exposes daily, hourly, role, and model usage totals, with optional configured price estimates. Accounting starts from installation; backends without complete billing usage remain explicitly unknown. See [usage API and pricing](docs/api/usage.md).
