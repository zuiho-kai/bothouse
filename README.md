<div align="center">

<a href="https://github.com/zuiho-kai/bothouse"><img src="docs/assets/bothouse-lockup.svg" alt="bothouse" width="260" /></a>

**Put the Claude Code, Codex and Gemini on your computer into one group chat: say one sentence, and they split the work, review each other and hand it back done.**

No new accounts, no new subscriptions: it runs the AIs you are already signed in to.

<a href="#install"><img src="https://img.shields.io/badge/Install%20in%20one%20line-macOS%20%C2%B7%20Windows%20%C2%B7%20Linux-e8833a?style=for-the-badge" alt="Install in one line" /></a>

[![Stars](https://img.shields.io/github/stars/zuiho-kai/bothouse?style=flat&logo=github&label=Star&color=f2b33d)](https://github.com/zuiho-kai/bothouse/stargazers)
[![Release](https://img.shields.io/github/v/release/zuiho-kai/bothouse?style=flat&color=e8833a&label=release)](https://github.com/zuiho-kai/bothouse/releases)
[![License](https://img.shields.io/badge/license-Apache--2.0-4a7c59?style=flat)](LICENSE)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?style=flat&logo=discord&logoColor=white)](https://discord.gg/aJmcnrt5ZB)

**English** ｜ [中文](README.zh-CN.md)

<br/>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/architecture-en-night.svg" />
  <img src="docs/assets/readme/architecture-en-day.svg" width="760" alt="bothouse architecture: where you chat on the left (Discord, Feishu, QQ, the self-hosted web chat, DSH web); bothouse in the middle, running on your own computer and handling assignment, routing and the task board; the CLIs you already have below (Claude Code, Codex, Gemini CLI, DSH, OpenCode and more); shared memory (Markdown wiki, reviewed nightly) and the in-development memory forum on the right; a private GitHub repo that syncs the memory on the far right" />
</picture>

</div>

## Get things done with one sentence

<table>
<tr>
<td align="center" width="33%"><a href="docs/assets/readme/demo/board.jpg"><img src="docs/assets/readme/demo/board-wall.jpg" width="300" alt="Pinned task board listing today's finished work by workspace and role" /></a><h3>"What did everyone get done today?"</h3><sub>The pinned task board: who is on what, and what landed today</sub></td>
<td align="center" width="33%"><a href="docs/assets/readme/demo/reject.jpg"><img src="docs/assets/readme/demo/reject-wall.jpg" width="300" alt="Long hands in a PR; Ju reviews it and sends back two must-fix items" /></a><h3>"Fix this bug, and get it reviewed before merging"</h3><sub>Long (Codex) writes, Ju (Claude) reviews and sends it back with two must-fixes</sub></td>
<td align="center" width="33%"><a href="docs/assets/readme/demo/team-masked.jpg"><img src="docs/assets/readme/demo/team-wall.jpg" width="300" alt="Whale finishes the English promo cut, Ju checks the comparison sheet and signs off" /></a><h3>"Make an English cut of the promo video"</h3><sub>Whale cuts it, Ju checks every shot side by side and signs off only when it is all English</sub></td>
</tr>
</table>

<details>
<summary>More demos</summary>

<table>
<tr>
<td align="center" colspan="3"><img src="docs/assets/readme/hero-relay.en.gif" width="720" alt="Real channel screenshots: the coding AI hands in, the reviewing AI sends back two fixes, a third AI re-runs the tests, and the task card reports back after the merge" /><br/>Relay in the group: Codex writes, Claude reviews, Gemini verifies, then it reports back merged (three real screenshots from the author's own team, redacted)</td>
</tr>
<tr>
<td align="center" width="33%"><img src="docs/assets/readme/demo/progress.jpg" width="260" alt="Nyan's progress card at step 9, listing each file read and command run" /><br/>"Verify this PR again": a live progress card shows which step it is on</td>
<td align="center" width="33%"><img src="docs/assets/readme/demo/multi.jpg" width="260" alt="Task card naming the assignee and status; the report says the PR is merged and CI is green" /><br/>One card per task: who has it and how far along; it reports back merged with CI green</td>
<td align="center" width="33%"><img src="docs/assets/readme/demo/fresh.jpg" width="260" alt="First screen of the setup wizard: pick a chat app" /><br/>First run: the web wizard walks you through platform, bots and CLIs</td>
</tr>
<tr>
<td align="center"><img src="docs/assets/readme/shot-roles.en.jpg" width="260" alt="Dashboard Roles page: which CLI each role runs, what it is busy with, which model" /><br/>Roles: which CLI, what it is busy with, which model; pause or restart in one click</td>
<td align="center"><img src="docs/assets/readme/shot-library.en.jpg" width="260" alt="Library page: persona cards with avatars and one-line descriptions" /><br/>Library: personas and avatars come in packs; pick one and it is ready to work</td>
<td align="center"><a href="https://x.com/amber_ai_lab/status/2115798143011008545"><img src="docs/assets/readme/promo-cover.en.jpg" width="260" alt="bothouse promo video cover, click to play" /></a><br/>The 3-minute promo video</td>
</tr>
</table>

</details>

<sub>The demos come from the author's own Discord server, which runs in Chinese; Long, Ju, Whale and Nyan are the names the author gave the AIs. It works the same in Feishu, QQ and the self-hosted web chat, and your team can talk in English.</sub>

## Why bothouse

| | |
|---|---|
| 🤝 **A team from the AIs you already use** | Claude Code, Codex, Gemini CLI, Cursor, Kimi, OpenCode, Grok, DSH and more can each be a teammate; even one account can be split into several members |
| 💬 **Hand out work in a chat app** | @ it in Discord, Feishu, QQ or the self-hosted web chat; Discord and Feishu have phone apps, so you can hand out work from bed |
| 🧵 **Chat stays free while big jobs run** | Big jobs go to a separate workspace while the lead keeps talking with you; you are only pinged for decisions |
| 🧠 **Everyone remembers the same thing** | One shared Markdown memory, reviewed and corrected every night; whoever picks up a job already knows the background |
| ✅ **Nobody reviews their own work** | Every handoff carries your original words; a second AI with a clean context checks the result, and "fixed" needs evidence |
| 🔒 **Runs on your own computer** | Scheduling runs locally and memory syncs to your own private GitHub repo; open source under Apache-2.0 |

<a id="install"></a>

## Get started in three steps

1. **Install** with one command (Windows command and packages are in [Getting started](docs/GETTING_STARTED.md)):

   ```sh
   curl -fsSL https://raw.githubusercontent.com/zuiho-kai/bothouse/main/install.sh | sh
   ```

2. **Connect a chat app**: run `bothouse` and the wizard in your browser walks you through picking a platform and connecting bots ([Discord and Feishu](docs/connect-discord-feishu.md)).
3. **Pick teammates**: choose a local CLI for each role, make one the lead, and you are ready ([a team from one CLI](docs/single-cli-team.md)).

Then try saying in the group: "Rewrite this repo's README in Chinese and English, then have someone else review it."

> 💡 Rather not do it yourself? Send this to the Claude Code or Codex on your computer and it will set things up:<br/>
> `Follow https://github.com/zuiho-kai/bothouse/blob/main/docs/GETTING_STARTED.md to install bothouse on this computer and open the setup wizard.`

<a id="features"></a>

## What it can do

| | |
| --- | --- |
| **An AI team of your own** | Bring the CLIs you already signed in to; every role gets its own name, persona and session. |
| **A team from one account** | Only one Codex or DeepSeek account? Create several members anyway, each with its own job and session; they assign and hand back work by mentioning each other. |
| **Speaks when spoken to** | The lead answers by default; the others follow along and reply only when mentioned. The wizard offers **Only when addressed**, so no routing model is needed ([routing choices](docs/connect-discord-feishu.md#5-jev-和主角色)). |
| **Chat stays free while big jobs run** | Bigger jobs go to a separate workspace while the lead keeps talking with you; results come back, and you are only pinged for decisions. |
| **Task board and progress cards** | Each chat channel pins a task board (waiting for you / in progress / on hold), each task gets its own thread, and a progress card shows which step it is on. |
| **Everyone remembers the same thing** | All roles read and write one shared memory, so whoever picks up the job already knows the background. |
| **A nightly review** | At night it checks what was written down during the day, fixes and dedupes it, and turns your repeated corrections into draft rules that apply only after you approve. |
| **Long jobs stay on track** | Every handoff carries your original words; a second AI with a clean context checks the result; "fixed" needs evidence. |
| **Manage it from your phone** | A built-in web dashboard shows who is busy and how much quota is used, lets you edit personas, open a project and add a note to work that is already running. |

Every role has its own avatar and persona. They come in packs; to make your own, see [role packs](docs/persona-packs.md) (Chinese).

Model and reasoning selections are scoped to the current channel/session key.
Use `/model` and `/reasoning` in that channel, or let the agent use
`cc-connect model list --json` followed by `model set <exact-id> --effort <level>`.
CLI changes are queued until the next turn; the conversation is preserved.
Selections survive restarts and `/new`, while other channels retain their own
selections or project/directory defaults. CLI support and pinned model arguments
still determine which settings a backend can apply.

<a id="memory"></a>

## Memory you can see

The team's memory is a plain folder of Markdown files. Each incoming message first looks up the relevant pages; a nightly review fixes what was written down wrong. You can read and edit it directly; Git records every change and pushes it to your own private GitHub repo, so the memory follows you to another computer. See [dispatcher and team memory](docs/ccm-and-wiki.md) (Chinese).

<a id="how"></a>

## How the team works

Proactive follow-up has explicit `off`, `observe`, and `auto` policies. Observation records local decisions without starting a proactive worker or sending a proactive confirmation; ordinary chat and explicit requests retain their existing routing and permission checks. Automatic admission requires administrator-bound platform identities and matching rules. Routing and wiki context do not grant execution authority. See [proactive authorization](docs/PROACTIVE_AUTHORIZATION.md) for configuration, audit records, and revocation boundaries.

Task-bound result text can use the send command with task, revision and delivery ID to persist before sending. Each fragment has its own receipt; ambiguous sends remain visible as unknown instead of being blindly retried. See [task text delivery](docs/TASK_TEXT_DELIVERY.md) for usage and platform boundaries.

You say one thing from your phone, computer or browser → the **lead** in the chat channel (the AI you talk to by default) takes it → big work goes to a **workspace**: @coder and @writer in Workspace 1, @researcher in Workspace 2 → they hand it back.

Chat keeps going the whole time; members take the work on and hand it back, and only decisions that need you come back to chat.

- **Speak when called:** the lead answers by default; other roles follow along and reply when mentioned or named. Unaddressed messages go to jev, a lightweight dispatcher (a small model that only answers multiple-choice questions), which decides who picks them up. It can run on a free small model from SiliconFlow or a local Qwen 0.6B.
- **Shared memory:** we extended our open-source llm-wiki into a memory shared by every role. It lives in local Markdown you can read and edit, and Git history records what the team learned.
- **Nightly review:** when a session ends, idles for 30 minutes or errors, a fast model records progress in the Wiki. At night a slower, more thorough free model checks it against the original conversations to fix errors and fill gaps; on Sundays it reviews everything. Code checks every quoted instruction against your actual words and rejects invented quotes.
- **Guardrails and tools:** dangerous commands are blocked; “fixed” needs verification evidence and “I'll check later” needs a timer; turn any check off with one message in chat. Built-in tools: check teammate progress, extract video frames and transcripts, search the web, and see how long each child agent has run and what state it is in.
- **Manual lead handoff:** if the lead can no longer reply, `bothouse handoff switch --to <project>` moves the role; task cards, workspaces and pending questions keep their IDs. See [manual lead handoff](docs/LEAD_HANDOFF.md).

## Platforms

Discord and Feishu already have phone and desktop apps, so there is no extra wrapper to install.

| Platform | Status | Capabilities |
| --- | --- | --- |
| Discord | Full support | Multiple roles, mentions, task handoffs, teammate status and log channels; slash commands in servers and DMs |
| Self-hosted web | Team mode | A local, Discord-like web UI with multiple roles, mentions and task handoffs |
| Feishu (Lark) | Single role | Conversation with one connected role |
| QQ official bot | Manual setup | Group/private chat, group @user and @everyone; see [QQ Bot setup](bridge/docs/qqbot.md) |
| DSH web | Experimental | A Channels page inside DSH web; see [DSH channels](dsh/collab/README.md) |

QQ / NapCat users can configure the [OneBot adapter](bridge/docs/qq.md) manually.

The OneBot guide also covers optional paragraph splitting, original-image storage, labelled forwarded chats and a [judging model](bridge/contrib/qq-gate/README.md) using a self-hosted service or remote API. Personal prompts and model credentials are supplied by the operator.

<details>
<summary><b>Everyday actions in DSH Channels</b></summary>

- **Avatars:** add or edit a member and open **Optional → Avatar → Upload image** to pick a local PNG (up to 256KB). The browser automatically resizes it to 256×256 and keeps it in the local data directory; click **Restore default** to remove the uploaded avatar.
- **Task board:** the member sidebar shows task counts; **Task board** opens a dialog grouped by channel, workspace and owner. Completed tasks start collapsed, and Dispatch / Delivery links jump to the original messages.
- **Channel settings:** pick a primary role per channel and save an existing absolute **Working directory**; choose whether to recreate that channel's DSH sessions now (clearing context) or leave that for the next time sessions are created. Workspaces inherit their parent channel's settings.
- **Images:** image attachments have **Download** and **Copy image**; click to open a large preview and close it with Esc, the backdrop or the top-right button.

</details>

<details>
<summary><b>Remote access from your phone with Tailscale</b></summary>

bothouse runs on your home computer with a built-in web dashboard. Tailscale lets your phone reach it without renting a server or opening public ports.

1. **Connect devices:** install Tailscale on the computer and your phone with the same account (macOS `brew install --cask tailscale`; Linux `curl -fsSL https://tailscale.com/install.sh | sh`) and note the computer's `100.x.y.z` from `tailscale ip -4`.
2. **Enable the dashboard and live bridge:** send `/web setup` to the bot or run `bothouse web`, then restart once. Or edit `~/.bothouse/config.toml`:

   ```toml
   [management]
   enabled = true
   host = "100.x.y.z"        # your Tailscale address
   port = 9820
   token = "replace-with-a-long-random-password"

   [bridge]
   enabled = true            # required for sending messages, not just viewing
   token = "replace-with-a-different-random-token"
   ```

3. **Sign in:** open `http://100.x.y.z:9820/` on your phone and enter the token. See uptime and token usage by role and model with daily and hourly heatmaps; add roles, edit personas and change models; open a project to add instructions to running work.

Network notes: start Tailscale first, then bothouse. Without `host`, it listens on all interfaces, so set it explicitly for remote access. With the bridge enabled, port 9810 also listens on all interfaces. To keep it on the tailnet, block 9810 on LAN and public interfaces with the host firewall.

</details>

<a id="releases"></a>

## Release highlights

Full history in [Releases](https://github.com/zuiho-kai/bothouse/releases).

| Version | What's new |
| --- | --- |
| **[0.1.43](https://github.com/zuiho-kai/bothouse/releases/tag/v0.1.43)** (2026-10-31) | A burst of messages sent while a role is busy is **answered as one turn**; truncated handbacks **save the full text first** and say where to read it; QQ group @ mentions; images in DSH can be viewed, copied and downloaded; a real desktop window on Windows. |
| **[0.1.42](https://github.com/zuiho-kai/bothouse/releases/tag/v0.1.42)** (2026-10-30) | Each chat channel pins a **task board** (waiting for you / running / parked); **every task gets its own thread**; teammates always hand back results in four plain-language parts; replies about running work go straight to its workspace. |
| **[0.1.41](https://github.com/zuiho-kai/bothouse/releases/tag/v0.1.41)** (2026-10-30) | `/model` shows the model a channel is **actually using**; a workspace question pauses only the task it names; `bothouse-dsh` is published to npm with each release. |
| **[0.1.40](https://github.com/zuiho-kai/bothouse/releases/tag/v0.1.40)** (2026-10-29) | A reply blocked by a hook is no longer cut to its last line; Grok roles get the ask-only guard too. |

<a id="compare"></a>

## bothouse and other projects: different focus

People often ask: DeepSeek now ships its own agent, and there are Tobs, DS Bot, OpenClaw and more — how is bothouse different?

**Most of them are one agent with a crew of sub-agents. bothouse puts the several AIs you already use into one group chat, splits the work between them, and gives them one shared memory.**

- **DeepSeek Harness (DSH)** is DeepSeek's official open-source agent framework, still a developer preview: agent teams are experimental, and there's no built-in long-term memory unless you plug one in. bothouse's assignment, task board and shared memory are in daily use already — and DSH itself can join over ACP as one of the teammates.
- **Tobs and DS Bot** are community bot projects built on DSH; every bot in the team runs on DSH. bothouse isn't tied to one agent: Claude Code, Codex, Gemini CLI, OpenCode and DSH each take their own jobs in the same group.

| | What it is | Which AIs | How several AIs work together | Memory | Where you chat |
| --- | --- | --- | --- | --- | --- |
| **bothouse** | **A coordination layer on your own computer + web panel** | **Claude Code, Codex, Gemini CLI, OpenCode; DSH and others over ACP; OpenAI-compatible APIs** | **The lead role hands work to separate workspaces; task board; one thread per job** | **One shared Markdown wiki, reviewed nightly** | Discord, self-hosted web, Feishu, QQ, DSH web (experimental) |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | DeepSeek's official agent framework (developer preview) | DeepSeek by default; other providers can be added | Subagents; agent teams are experimental | No built-in long-term memory; memory plugins can be added | Its own desktop app and web UI |
| [Tobs](https://github.com/BotHarness/DeepSeekBot) | Bot plugin built on DSH | Models configured in DSH | @ whoever you need; assignments | One Git repo per bot | Feishu, Slack, Discord, QQ, WeChat |
| [DS Bot](https://github.com/Fei2411/DS-Bot) | Desktop app / plugin / Docker built on DSH | Models configured in DSH | A chief bot runs the team; group admins coordinate | Memory per bot and per group | In the app |

Mature personal assistants and coding tools get compared too:

| | What it is | How several AIs work together | Memory | How bothouse differs |
| --- | --- | --- | --- | --- |
| [OpenClaw](https://github.com/openclaw/openclaw) | Personal AI assistant with pluggable harnesses (Claude, Codex and more), 20+ chat apps | Team preset: a coordinator delegates to researcher, writer and reviewer | Sessions split per agent; Memory Wiki shared by default, can be split per agent | One assistant with swappable engines vs several signed-in CLIs working side by side in one group |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | Self-improving personal assistant, any model | Isolated subagents in parallel | Manages its own memory, writes its own skills | It learns one person; bothouse gives a team one shared memory |
| [Orca](https://github.com/stablyai/orca) | Multi-agent coding IDE using your own CLIs | Several agents race on one task; merge the best | Left to each CLI | It has you watch the race; bothouse lets you hand it off and walk away |

**Which to pick**: for a personal assistant you can reach anywhere and that learns you, OpenClaw and Hermes Agent are mature; to watch several coding agents race side by side, pick Orca; if you only use DSH and want a few bots, there are Tobs and DS Bot. If you already have several AI CLIs and want them to split the work in one group and share one memory — say it before bed, collect results in the morning — pick bothouse. Many of these can be used together.

<details>
<summary>Others people ask about</summary>

| | What it's good at | What bothouse adds |
| --- | --- | --- |
| [Raft](https://www.testingcatalog.com/raft-1-0-puts-ai-agents-in-team-mode/) | People and agents in one new Slack-like workspace | No new app: plugs into the Discord, Feishu or web you already use; open source and self-hostable |
| [Cindy](https://github.com/makecindy/cindy) | One client for Claude Code and Codex; switch models without losing context | The lead role splits the work and hands it out, so you don't have to |
| [Tencent Mavis](https://technode.com/2026/05/21/tencent-unveils-mavis-ai-assistant-that-turns-pcs-into-conversational-interfaces/) | System-level assistant: files, PC and phone apps | Several AIs split project work: code, research, review |
| [magpie](https://github.com/yetone/magpie) / [cc-switch](https://github.com/farion1231/cc-switch) | One place to manage model providers | Different layer: they decide which model, bothouse decides who takes which job and what the team remembers — use them together |
| [llm-wiki](https://github.com/zuiho-kai/llm-wiki) | Turns sessions into a layered wiki memory | bothouse's memory builds on it and shares it across roles |

</details>

## Roadmap

- **Claim before starting:** lock assignments so two members never start the same task.
- **Specialists on demand:** “publish to the App Store” spins up a specialist that reads prior decisions, does the job and exits.
- **Role packs and a plugin marketplace:** personas, memory templates and tools in one-step bundles; browse community roles.
- **Portable memory and semantic search:** carry the Wiki between computers and models, with semantic retrieval beside keyword search.
- **Automatic workspace cleanup:** clear context after the last assignment so the next task starts fresh.
- **More group-chat platforms:** full team mode on DSH web channels, Telegram, Slack, QQ and WeCom.

<a id="docs"></a>

## Contributing

Contributions are welcome — start with [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md). Source builds with the web dashboard need the frontend built before Go and must not pass `no_web`; see [dashboard build](docs/dashboard-source-build.md).

More: [Getting started](docs/GETTING_STARTED.md) · [A team from one CLI](docs/single-cli-team.en.md) · [Discord and Feishu setup](docs/connect-discord-feishu.md) · [Codex bot session isolation](docs/codex-session-isolation.md) · [Dispatcher and team memory](docs/ccm-and-wiki.md) · [Role packs](docs/persona-packs.md) · [Per-role Wiki and nightly reflection](bridge/contrib/wiki/README.md) · [Guardrails and tools](bridge/contrib/hooks/README.md) · [Memory read-frequency report](docs/READ_FREQUENCY.md) · [Cross-CLI workflow hooks](docs/workflow-hooks.md) · [Usage API](docs/api/usage.md) · [Self-hosted web protocol](bridge/docs/cloud-web.md) · [Architecture](docs/ARCHITECTURE.md) · [Lead collaboration scripts](bridge/contrib/lead/README.md)

Most guides are currently in Chinese; the self-hosted web protocol is in English.

<a id="community"></a>

## Community

Questions, ideas and the teams you build are all welcome.

| Drop by | |
| --- | --- |
| [Discord](https://discord.gg/aJmcnrt5ZB) | chat with users and contributors |
| [GitHub Issues](https://github.com/zuiho-kai/bothouse/issues) | bugs and ideas |
| [Pull requests](https://github.com/zuiho-kai/bothouse/pulls) | build it with us |
| [linux.do](https://linux.do) | Chinese community forum |

<a id="repository-status"></a>

## Repository status

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/zuiho-kai/bothouse/readme-status/stats-en-night.svg" />
  <img src="https://raw.githubusercontent.com/zuiho-kai/bothouse/readme-status/stats-en-day.svg" width="960" alt="GitHub repository status: stars, forks, open issues and PRs, PRs closed and commits in the last 30 days, latest release; text data at the links below." />
</picture>

**Last 30 days**: closed PRs include merged PRs; commits count all history reachable from the default branch, including merge and bot commits. Updated every six hours; the time on the card is the last successful update.

[Text data and definitions](https://github.com/zuiho-kai/bothouse/tree/readme-status#readme) · [JSON](https://raw.githubusercontent.com/zuiho-kai/bothouse/readme-status/stats.json) · [Update workflow](https://github.com/zuiho-kai/bothouse/actions/workflows/readme-status.yml)

<a href="https://github.com/zuiho-kai/bothouse">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/banner/star-en-night.svg" />
  <img src="docs/assets/readme/banner/star-en-day.svg" width="960" alt="Star bothouse and come back to see the team grow." />
</picture>
</a>

## License and thanks

- **License:** [Apache-2.0](LICENSE); see [LICENSING.md](LICENSING.md). Third-party dependencies are listed in [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md).
- **Thanks:** the bridge is built on [cc-connect](https://github.com/chenhg5/cc-connect) and keeps its full commit history, so the contributor list includes cc-connect's authors and contributors. Thanks to [@chenhg5](https://github.com/chenhg5) and every cc-connect contributor; the upstream MIT notice is kept in [bridge/LICENSE-MIT-upstream](bridge/LICENSE-MIT-upstream).
- **Community:** [linux.do](https://linux.do)

## Star History

<a href="https://www.star-history.com/#zuiho-kai/bothouse&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=zuiho-kai/bothouse&type=Date&theme=dark" />
    <img alt="Star history of zuiho-kai/bothouse" src="https://api.star-history.com/svg?repos=zuiho-kai/bothouse&type=Date" />
  </picture>
</a>

外部变化需要跟进已有任务时，可用结构化 cron/poll 或鉴权 webhook，并通过本地 task event-source、task events、task event-ack 管理来源与回执。配置、样例及各平台能力边界见 [外部任务事件](docs/implementation/750-external-task-events.md)。

Workspace final reports remain pending until the dispatcher verifies their artifacts. The board distinguishes pending review from paused work; overdue review reminders survive restarts. See [handback verification](docs/implementation/797-handback-verification.md).
模型额度冷却按账号及已知共享额度组保存：切到独立额度目标不会清空原目标的期限，切回仍受限制；共享额度的模型不能靠切换绕过限制。旧版本的角色级冷却只有在测得目标额度可用后才对该目标放行，无法查询时保留限制。模型切换仍须使用已有入口，由用户明确选择。
