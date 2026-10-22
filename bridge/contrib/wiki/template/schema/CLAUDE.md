# Wiki schema

This is a personal LLM wiki (Karpathy pattern). Raw sources are Claude Code session transcripts
(`~/.claude/projects`); this directory is the distilled, LLM-maintained layer. Read this file before changing
anything here.

## Layers — read top-down, only as deep as needed

| Layer | File | Holds | Budget (enforced by `bin/lint.py`) |
|---|---|---|---|
| L0 index | `MEMORY.md` | one line per **domain**, no facts | ≤ 8 domains (+ misc), ≤ 80 chars/line |
| L1 domain | `<domain>/README.md` | one line per **topic**: what it covers | ≤ 15 topics, ≤ 120 chars/line |
| L2 topic | `<domain>/<topic>.md` | current state + key facts | ≤ 60 lines, ≤ 4000 chars |
| L3 log | `log.md` | dated history, session links | append-only, never loaded by default |

Answering "how do I reach my server": MEMORY.md → `infra/README.md` → `infra/server.md`. Answering "how did we
do X last time": grep `log.md` for the topic, then open the listed sessions (e.g. with a session-resume tool).

## Topic page format

```
---
name: <topic>
description: <one line: the most-needed facts>
metadata:
  scope: <what belongs on this page — and what does not>
---
# <Title>
## Current state         rewrite, don't append
## Key facts             hosts, IPs, paths, commands, configs, versions
## Decisions & pitfalls  decisions, what failed, the user's preferences and rejections
## Open items            open items
```
Only these four `##` sections (a date suffix like `## Current state (2026-10-11)` is fine); omit empty ones.
The section names are fixed: `bin/lint.py` checks them for the `language` set in `config.json` (this schema is
for `"en"`; `"zh"` uses 现状 / 关键事实 / 决策与踩坑 / 待办, see `schema/CLAUDE.zh-CN.md`).
One bullet = one fact, ≤ 300 chars per line — group with nested bullets, not long sentences.
Claude Code's memory system adds `node_type`/`originSessionId`/`modified` under
`metadata` when it writes here — that's expected; keep `scope` under `metadata` too. Write in the user's language.

## Rules

- **Current, not chronological.** A topic page says what is true now. Superseded facts are deleted
  (git and log.md keep history). No session lists on topic pages — those go to log.md.
- **Keep overturned decisions.** When a decision or belief is reversed, Decisions & pitfalls keeps one line:
  `Was X → changed to Z because Y (YYYY-MM-DD)`, so it isn't re-proposed. Plain fact changes need no such line.
- **Date volatile facts.** Facts that can go stale (running services, versions, external status, pending
  items) carry an absolute date `(YYYY-MM-DD)`. Stable facts (paths, preferences) don't need one.
- **Index matches body.** A README line and a page's `description:` must agree with the page body;
  whoever changes a page updates both.
- **Placement.** Pick the domain, then the topic whose `scope:` fits. If none fits, create a topic.
  Never stretch a page's scope to absorb unrelated content.
- **New categories.** New topics: create freely (and list them in the domain README).
  One-off topics with no fitting domain go to `misc/`. A new domain only when ≥ 2 related topics
  justify it (usually by promoting from misc/), within the 8-domain cap; merge thin domains.
  Record every create/merge/rename/split in log.md.
- **One home per fact.** Every fact lives on exactly one page — the one whose `scope:` owns it (say so in
  scope, e.g. "the X status is owned by this page"). Other pages link `[[name]]` instead of restating it. Before
  writing a fact, grep the wiki for it; if another page owns it, update that page and link.
- **Index covers the domain.** A MEMORY.md line names every topic family in that domain. Adding a topic
  the line doesn't cover → update the line in the same pass. Never park a topic in a domain whose
  MEMORY.md line wouldn't lead a reader there; move or create a domain instead.
- **Renames propagate.** When something is renamed (a host, path, project), grep the whole wiki for
  the old name and update every hit; keep the old name once only as `formerly X`.
- **Conclusions, not process.** Experiment/debug pages keep the result, why, and the 2–3 numbers that
  justify it. Step-by-step timing breakdowns and trial logs go to log.md or stay in the transcript.
- **No bookkeeping on pages.** Pages state facts, not how the writer judged them. Never write things like
  "not confirmed by the user", "not claiming…", "(per the user)". An unconfirmed proposal is one Open items line
  (`Whether X: proposed, no answer yet`); an unsupported claim is removed. `bin/lint.py` rejects these phrases.
- **Near budget (≥ 80%) → the weekly LINT pass splits early** (`bin/lint.py --warn` lists them).
- **Over budget → split or compress**, never just trim useful facts: split a topic into subtopics,
  split a crowded domain, move history to log.md.
- **Secrets never.** No passwords, tokens, private keys. Record where they live instead
  (e.g. `~/notes/secrets.md`). `[REDACTED]` in input was a secret.
- **log.md entry format** (append at the end):
  ```
  ## [YYYY-MM-DD] ingest | <sid8> <session title>
  - <domain>/<topic>: <what changed>
  ```
  Use `review` (nightly), `lint`, `dream` or `restructure` instead of `ingest` for other passes.

## Reading notes (papers / external projects)

- After a deep read of a paper or an external project (a whole paper, or several files / more than ~10 minutes),
  write it into `refs/` right away, don't wait for ingest. Other terminals running in parallel first
  `grep -r <arXiv id|owner/name>` the wiki. For your own repositories write no code walkthroughs; record only the
  why and the pitfalls, as usual.
- `refs/` is a fixed domain, exempt from the "new domain needs ≥ 2 topics" rule. One page per project or subject,
  `refs/<topic>.md` (e.g. `diffusion-refs`), 6–10 lines per paper/repository; pages that use it only link `[[...]]`.
- Every entry starts with the verbatim arXiv id or repository `owner/name`, so it can be grepped; external
  repositories also note the commit/version and the date read.
- Where things go: source, problem, 3–5 method bullets, key numbers, factual limitations → `Key facts`; what it
  means for us, conclusions, reasons not to use it → `Decisions & pitfalls`, conclusions dated (papers don't change,
  conclusions do).
- Notes are for judging and locating: before changing code or citing a specific number or detail, re-read the
  relevant passage of the original; when upstream moves, read only the diff.

## Tooling

- `bin/ingest.py` — distills sessions into this wiki in tiers (engines and models are set in `config.json`):
  - Day: SessionEnd hook + `--pending` every 30 min: a fast model (default Haiku) ingests closed/idle sessions,
    no checking pass; a stronger one (default Sonnet) redoes a failed batch; a batch the quota refuses waits for
    the night. A session closing while a run holds the lock is queued (`.ingest.queue`) for that run.
  - Night, Mon–Sat 03:00 `--nightly`: the night engine ingests leftovers, then reviews every span the day engine
    ingested since the last review against its transcript (the script passes the day's ingest diffs; review only
    corrects those lines) — fix, complete, dedupe (`SOP_REVIEW`). Codex passes resume the same session on capacity
    errors across `codex_models`, then fall back to `after_codex`.
  - Week, Sunday 03:00 `--lint`: the lint engine lints the whole wiki.
  - Dream, every night after the nightly or the weekly lint: a model reads what the user said since the last dream
    and keeps `misc/rule-candidates.md` (recurring corrections/preferences → rule candidates for the user to
    decide; never edits CLAUDE.md). Quotes are script-checked against the session they cite.
  Every engine gets the same SOP prompts, in the configured `language` (`SOP_*`: requirements / rules / SOP / acceptance criteria); the script
  checks acceptance itself (lint ok, a new `ingest|review | <sid8>` log entry per session, only wiki pages
  touched, log.md append-only, no mass deletion). Models edit a git worktree `.ingest-work`, never this working
  tree; an accepted commit is cherry-picked here and, if `remote` is set, pushed.
- `bin/lint.py` — structural checks (budgets, frontmatter, orphans, allowed sections, line length,
  bookkeeping phrases). Exit 1 on violations. `--warn`: near-budget pages/domains, `[[links]]` without a page.
