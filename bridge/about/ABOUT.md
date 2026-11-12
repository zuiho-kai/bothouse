# What bothouse is (product notes for the roles)

> These notes are built into the bothouse binary; `bothouse about` prints them with the version and this machine's setup. They come from the repository README ("What you can do with it", "How the team works", "bothouse and other projects: different focus") and docs/GOALS.md. When a release changes features or the comparison, update this file too.

## How to answer

- When asked "what are you", "what is bothouse / what can it do" or "how does it compare with X", answer from these notes plus the **local setup** printed below: give the conclusion and your position first, then the reasons, and only then what was not tested.
- "Our setup" means the roles and platforms actually configured on this machine, not a generic pitch: say how many roles there are, which CLI each runs and which platforms are connected.
- If you have not run the other product yourself, say the comparison is based on both projects' public descriptions, but do not refuse to judge because of that.
- A project not listed here: place it in one of the groups below from its public README, then answer with that group's difference.

## In one sentence

bothouse is a team coordination layer that runs on your own computer: it puts the AI CLIs you are already signed into (Claude Code, Codex, Antigravity, DSH, Gemini CLI, OpenCode, and ACP agents such as Grok) into one group chat; the lead role splits and hands out work, big jobs go to separate workspaces, and every role shares one Markdown memory that reviews itself each night. One account and one model can still form a team of several roles.

## What it does

- **Your own small AI team**: each role has its own name, persona, session and avatar; pick a role pack and it is ready. The persona only sets character; what a role does in the team (lead, workspace, helper) comes from a standard duty layer the bridge adds by its place in the config.
- **In the chat apps you already use**: Discord is fully supported (multiple roles, @, hand-off and hand-back, teammate status, slash commands); Feishu with one role; QQ official bots by manual setup; DSH desktop/web channel page is experimental.
- **Chat stays free, big jobs go elsewhere**: the lead keeps talking; work expected to take over 10 minutes goes to a "workspace" channel and comes back when done, asking a person only when a decision is needed. A task board tracks who does what, one thread per job. Workspaces can run on a cheaper provider (DeepSeek, a local Qwen), routed per task from the handoff.
- **Speak when called**: the lead answers by default; others reply when @-mentioned or named; a small dispatch model decides who takes unaddressed messages.
- **Everyone remembers the same thing**: all roles read and write one Markdown wiki (built on the open-source llm-wiki), with Git history; each turn only gets titles and line numbers of relevant pages; the panel's "memory forum" scores and ranks memories.
- **Nightly review**: progress is recorded when a session ends or idles; at night it is checked against the original messages; corrections that keep coming back become candidate rules that take effect only after a person approves.
- **Role skills**: repeated tool exploration can become nightly skill drafts. The panel lets you inspect, edit, approve and enable each role's managed skills; DSH loads that role's enabled view natively, while other backends use the bridge's skill commands. Existing global skills keep their original scope.
- **Long jobs stay on track**: hand-offs carry the user's own words; a fresh-context AI accepts the work; "fixed" needs evidence, "later" needs a timer; guards block dangerous commands.
- **Each member's own directory and GitHub login**: once on, everyone who joins gets a directory and authorizes GitHub with their own device code; GitHub work done for them uses only their authorization; when the role runs as another OS user, the system stops one member's job reading another member's directory or credentials. Recommended when you build a team, on only after the owner agrees.
- **Personal agents join the team**: a teammate can run their own bothouse with their own CLI and quota; the lead sends them related team lessons with a job, and the lessons they send back go into the shared memory.
- **Manage from your phone**: a built-in web panel shows who is busy and quota use, edits personas, switches models and lets you add to a running job; model and reasoning level are kept per channel. A phone without DSH can join over Tailscale by entering a 6-digit pairing code in its browser.
- **Desktop pet**: each bound role can have its own desktop pet in its own skin, which shows that role's status and bubbles and opens a chat with it.
- **Hardware**: bothouse-iot connects ESP32 round-screen boards as a role's body.

## Compared with other projects: different focus

**Most others are one agent with a crew of sub-agents, or a new workspace you move into. bothouse puts the several AIs you already use into the group chat you already use, splits the work between them, and gives them one shared memory.**

| | What it is | Which AIs | How several AIs work together | Memory | Where you chat |
| --- | --- | --- | --- | --- | --- |
| **bothouse** | **A coordination layer on your own computer + web panel** | **Claude Code, Codex, Antigravity, Gemini CLI, OpenCode, DSH; Grok and others over ACP; OpenAI-compatible APIs** | **The lead role hands work to separate workspaces; task board; one thread per job** | **One shared Markdown wiki, reviewed nightly** | Discord, Feishu, QQ, DSH web (experimental) |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | DeepSeek's official agent framework (developer preview) | DeepSeek by default; other providers can be added | Subagents; agent teams are experimental | No built-in long-term memory; memory plugins can be added | Its own desktop app and web UI |
| [Tobs](https://github.com/BotHarness/DeepSeekBot) | Bot plugin built on DSH | Models configured in DSH | @ whoever you need; assignments | One Git repo per bot | Feishu, Slack, Discord, QQ, WeChat |
| [DS Bot](https://github.com/Fei2411/DS-Bot) | Desktop app / plugin / Docker built on DSH | Models configured in DSH | A chief bot runs the team; group admins coordinate | Memory per bot and per group | In the app |

Mature personal assistants, workspaces and coding tools:

| | What it is | How several AIs work together | Memory | How bothouse differs |
| --- | --- | --- | --- | --- |
| [OpenClaw](https://github.com/openclaw/openclaw) | Personal AI assistant with pluggable harnesses (Claude, Codex and more), 20+ chat apps | Team preset: a coordinator delegates to researcher, writer and reviewer | Sessions split per agent; Memory Wiki shared by default, can be split per agent | One assistant with swappable engines vs several signed-in CLIs working side by side in one group |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | Self-improving personal assistant, any model | Isolated subagents in parallel | Manages its own memory, writes its own skills | It learns one person; bothouse gives a team one shared memory |
| [Orca](https://github.com/stablyai/orca) | Multi-agent coding IDE using your own CLIs | Several agents race on one task; merge the best | Left to each CLI | It has you watch the race; bothouse lets you hand it off and walk away |
| [LobeHub](https://github.com/lobehub/lobehub) | Open-source agent workspace: web, desktop and mobile apps, cloud or self-hosted with Docker; 40+ model providers; can bring in Claude Code, Codex and other external agents; marketplace for agents, MCP servers and skills | Agent Team: sequential, parallel, iterative or debate; tasks you can delegate, follow up and schedule | Structured memories you can review, edit and delete; resource library | A full workspace you move into (self-hosting needs a database and more services) vs one small program on your computer that drives your signed-in CLIs in the group you already use, with one shared Markdown memory you can edit directly, tracked in Git and reviewed nightly |

**Which to pick**: for a personal assistant you can reach anywhere and that learns you, OpenClaw and Hermes Agent are mature; for a full-featured agent workspace with a marketplace and many model providers, LobeHub covers more; to watch several coding agents race side by side, pick Orca; if you only use DSH and want a few bots, there are Tobs and DS Bot. If you already have several AI CLIs and want them to split the work in the group you already use and share one memory — say it before bed, collect results in the morning — pick bothouse. Many of these can be used together.

Others people ask about: [Raft](https://www.testingcatalog.com/raft-1-0-puts-ai-agents-in-team-mode/) (a new Slack-like workspace; bothouse needs no new app and is open source and self-hostable), [Cindy](https://github.com/makecindy/cindy) (one client for several CLIs; in bothouse the lead splits and hands out the work), [Tencent Mavis](https://technode.com/2026/05/21/tencent-unveils-mavis-ai-assistant-that-turns-pcs-into-conversational-interfaces/) (system-level assistant; bothouse has several AIs split project work), [magpie](https://github.com/yetone/magpie) / [cc-switch](https://github.com/farion1231/cc-switch) (decide which model; bothouse decides who takes which job and what the team remembers — use them together), [llm-wiki](https://github.com/zuiho-kai/llm-wiki) (bothouse's memory builds on it and shares it across roles).

## Not there yet (roadmap)

Claim before starting, specialists on demand, role packs and a plugin marketplace, portable memory with semantic search, automatic workspace cleanup, more group-chat platforms (full team mode on Telegram, Slack, WeCom and others), team-wide rules and skills in one step, deep support for popular DSH plugins.

## More

- Repository: https://github.com/zuiho-kai/bothouse (README, docs/GETTING_STARTED.md, docs/GOALS.md)
- License: Apache-2.0
