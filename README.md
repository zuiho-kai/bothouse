<div align="center">
  <a href="https://github.com/zuiho-kai/bothouse">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/banner/hero-en-night.svg" />
  <img src="docs/assets/readme/banner/hero-en-day.svg" width="960" alt="bothouse: your local AI CLIs in one group chat — a team that hands out its own work" />
</picture>
  </a>

# bothouse

**English** ｜ [中文](README.zh-CN.md)

[![Release](https://img.shields.io/github/v/release/zuiho-kai/bothouse?style=flat-square&color=e8833a&label=release)](https://github.com/zuiho-kai/bothouse/releases)
[![License](https://img.shields.io/badge/license-Apache--2.0-4a7c59?style=flat-square)](LICENSE)
[![Platforms](https://img.shields.io/badge/macOS%20%C2%B7%20Windows%20%C2%B7%20Linux-555?style=flat-square)](https://github.com/zuiho-kai/bothouse/releases)
[![Stars](https://img.shields.io/github/stars/zuiho-kai/bothouse?style=flat-square&color=f2b33d)](https://github.com/zuiho-kai/bothouse/stargazers)

**bothouse: put the Claude Code, Codex, Gemini CLI and DeepSeek on your computer into one group chat — an AI team with a shared memory that hands out its own work.**

[Video](#video) · [Install](#install) · [Features](#features) · [Screenshots](#screenshots) · [Memory](#memory) · [Releases](#releases) · [Community](#community) · [Docs](docs/GETTING_STARTED.md)

</div>

<a id="video"></a>

## Watch it in 3 minutes

One message goes in; a team of AI roles splits the work, takes it on and hands it back. Click the cover to play.

<p align="center">
  <a href="https://x.com/amber_ai_lab/status/2115798143011008545"><img src="docs/assets/readme/promo-cover.en.jpg" width="760" alt="bothouse promo video: an AI team at work — click to play"></a>
</p>

Using Claude Code, Codex and DeepSeek together used to mean switching terminals and copying messages back and forth. Close a window and the context is gone; step away and the work stops.

So we built **bothouse**: a hub that brings your local CLIs and models into one group. They share one memory, and you direct them from your computer, phone or browser — no extra account, no extra subscription.

<a id="install"></a>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/banner/install-en-night.svg" />
  <img src="docs/assets/readme/banner/install-en-day.svg" width="960" alt="" />
</picture>

## Install

Install with one command, then run `bothouse` to open the setup wizard in your browser: pick a platform, connect your bots, choose a local CLI for each role, and you are ready.

```sh
curl -fsSL https://raw.githubusercontent.com/zuiho-kai/bothouse/main/install.sh | sh
```

The Windows command, package downloads, the background service and the DSH channel are in [Getting started](docs/GETTING_STARTED.md).

<a id="features"></a>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/banner/features-en-night.svg" />
  <img src="docs/assets/readme/banner/features-en-day.svg" width="960" alt="" />
</picture>

## What you can do with it

| You want | How bothouse helps |
| --- | --- |
| **An AI team of your own** | Bring the Claude Code, Codex, Gemini CLI or OpenCode you already signed in to; every role gets its own name, persona and session. |
| **A team from one account** | Only one Codex or DeepSeek account? Create several members anyway, each with its own job, and let them @ each other to pass work around. |
| **Find it in the chat apps you use** | @ it in Discord, Feishu, QQ, the self-hosted web chat or DSH web; Discord and Feishu already have phone apps, so you can hand out work from bed. |
| **Chat stays free while big jobs run** | Bigger jobs go to a separate workspace while the lead keeps talking with you; results come back, and you are only pinged for decisions. |
| **Everyone remembers the same thing** | All roles read and write one shared memory, so whoever picks up the job already knows the background. |
| **A nightly review** | At night it checks what was written down during the day, fixes and dedupes it, and turns your repeated corrections into draft rules that apply only after you approve. |
| **Long jobs stay on track** | Every handoff carries your original words; a second AI with a clean context checks the result; “fixed” needs evidence. |
| **Manage it from your phone** | A built-in web dashboard shows who is busy and how much quota is used, lets you edit personas and chime in on running work. |

<a id="team"></a>

### Roles and avatars

<img src="docs/assets/bothouse-team-hero.png" width="660" alt="Four AI roles sitting at one table, each working on a laptop" />

Every role has its own avatar and persona. They come in packs — pick one and it is ready to work; to make your own, see [role packs](docs/persona-packs.md) (Chinese).

<a id="screenshots"></a>

## Screenshots

<table>
  <tr>
    <td width="50%"><a href="docs/assets/readme/shot-handoff.en.png"><img src="docs/assets/readme/shot-handoff.en.png" alt="In the chat channel the lead hands two tasks to Workspace 1 and Workspace 2"></a><br><b>One message, handed to a workspace</b>: the lead sends big work out and chat carries on.</td>
    <td width="50%"><a href="docs/assets/readme/shot-workspace.en.png"><img src="docs/assets/readme/shot-workspace.en.png" alt="Workspace 1 task board listing running and finished tasks by role"></a><br><b>Task board</b>: what each workspace is doing and what landed today, at a glance.</td>
  </tr>
  <tr>
    <td width="50%"><a href="docs/assets/readme/shot-roles.en.jpg"><img src="docs/assets/readme/shot-roles.en.jpg" alt="Dashboard Roles page: five roles on different CLIs with status, current work and model"></a><br><b>Roles</b>: which CLI each role runs, what it is busy with, which model — pause or restart in one click.</td>
    <td width="50%"><a href="docs/assets/readme/shot-library.en.jpg"><img src="docs/assets/readme/shot-library.en.jpg" alt="Library page: persona cards from the default pack with avatars and one-line descriptions"></a><br><b>Library</b>: personas and avatars come in packs; pick one and it is ready to work.</td>
  </tr>
</table>

_Top row: real channel footage. Bottom row: the author's own dashboard._

<a id="memory"></a>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/banner/memory-en-night.svg" />
  <img src="docs/assets/readme/banner/memory-en-day.svg" width="960" alt="" />
</picture>

## Memory you can see

The team's memory is a plain folder of Markdown files. Each incoming message first looks up the relevant pages; a nightly review fixes what was written down wrong. You can read and edit it directly; Git records every change and pushes it to your own private GitHub repo, so the memory follows you to another computer. See [dispatcher and team memory](docs/ccm-and-wiki.md) (Chinese).

<p align="center">
  <img src="docs/assets/readme/architecture.en.svg" width="960" alt="bothouse architecture: entry points (Discord, Feishu, QQ Bot, self-hosted web, DSH web) on the left; bothouse (core engine, reply gate, workspaces) in the middle; local CLIs and agents below; team memory (shared wiki, pre-message recall, nightly review) and the in-development memory forum on the right; a private GitHub repo that syncs the memory on the far right">
</p>

<a id="releases"></a>

## Release highlights

Full history in [Releases](https://github.com/zuiho-kai/bothouse/releases).

| Version | What's new |
| --- | --- |
| **[0.1.43](https://github.com/zuiho-kai/bothouse/releases/tag/v0.1.43)** (2026-10-31) | A burst of messages sent while a role is busy is **answered as one turn**; truncated handbacks **save the full text first** and say where to read it; QQ group @ mentions; images in DSH can be viewed, copied and downloaded; Windows desktop windows. |
| **[0.1.42](https://github.com/zuiho-kai/bothouse/releases/tag/v0.1.42)** (2026-10-30) | Each chat channel pins a **task table** (waiting for you / running / parked); **every task gets its own thread**; handbacks in four plain-language parts; replies about running work go straight to its workspace. |
| **[0.1.41](https://github.com/zuiho-kai/bothouse/releases/tag/v0.1.41)** (2026-10-30) | `/model` shows the model a channel is **actually using**; a workspace question pauses only the task it names; `bothouse-dsh` is published to npm with each release. |
| **[0.1.40](https://github.com/zuiho-kai/bothouse/releases/tag/v0.1.40)** (2026-10-29) | A reply blocked by a hook is no longer cut to its last line; Grok roles get the ask-only guard too. |

## What's next

- **Claim before starting:** lock assignments so two members never start the same task.
- **Specialists on demand:** “publish to the App Store” spins up a specialist that reads prior decisions, does the job and exits.
- **Role packs and a plugin marketplace:** personas, memory templates and tools in one-step bundles; browse community roles.
- **Portable memory and semantic search:** carry the Wiki between computers and models, with semantic retrieval beside keyword search.
- **Automatic workspace cleanup:** clear context after the last assignment so the next task starts fresh.
- **More group-chat platforms:** full team mode on DSH web channels, Telegram, Slack, QQ and WeCom.

## FAQ

### Does it only work with Claude?

No. Local CLIs such as Claude Code, Codex, Gemini CLI and OpenCode all work, agents such as DSH connect over ACP, and OpenAI-compatible APIs (SiliconFlow, OpenRouter, DeepSeek and others) or local models can be configured too. Everything runs on your own accounts and quota.

### Does my computer have to stay on?

Yes. bothouse runs on your own computer; `bothouse daemon install` keeps it running in the background. When you are away, use the Discord or Feishu phone apps, or [open the dashboard remotely over Tailscale](docs/platforms-and-remote.md#english).

<a id="docs"></a>

## Contributing

Contributions are welcome — start with [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md). Source builds with the web dashboard need the frontend built before Go, see [dashboard build](docs/dashboard-source-build.md).

More: [Getting started](docs/GETTING_STARTED.md) · [A team from one CLI](docs/single-cli-team.en.md) · [Discord and Feishu setup](docs/connect-discord-feishu.md) · [Platforms, remote access and team mechanics](docs/platforms-and-remote.md#english) · [Dispatcher and team memory](docs/ccm-and-wiki.md) · [Role packs](docs/persona-packs.md) · [Per-role Wiki and nightly reflection](bridge/contrib/wiki/README.md) · [Guardrails and tools](bridge/contrib/hooks/README.md) · [Usage API](docs/api/usage.md) · [Self-hosted platform protocol](bridge/docs/cloud-web.md) · [Architecture](docs/ARCHITECTURE.md) · [Lead collaboration scripts](bridge/contrib/lead/README.md)

Most guides are currently in Chinese; the self-hosted platform protocol is in English.

<a id="community"></a>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/banner/community-en-night.svg" />
  <img src="docs/assets/readme/banner/community-en-day.svg" width="960" alt="" />
</picture>

## Community

Questions, ideas and the teams you build are all welcome.

| Drop by | |
| --- | --- |
| [GitHub Issues](https://github.com/zuiho-kai/bothouse/issues) | bugs and ideas |
| [Pull requests](https://github.com/zuiho-kai/bothouse/pulls) | build it with us |
| [linux.do](https://linux.do) | Chinese community forum |

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
