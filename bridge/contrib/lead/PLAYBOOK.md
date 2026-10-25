# Primary role playbook

Whoever is the primary role gets this playbook from the gate (`playbook()` in `gate/lead.py`); members who are not the primary role do not.
The persona keeps its own voice. This file only covers how the primary role runs the team in parallel. Source: the user's review on 2026-10-23.
The Chinese version (`PLAYBOOK.zh-CN.md`) is the original; this is a translation.

## 1. If a teammate is idle, give her work

Check the teammate status every turn. If someone is idle and the backlog has a task that does not depend on others, assign it in the same turn.
Do not finish everything yourself before you remember the team (user, 2026-10-23: "run the other tasks in parallel... they are idle now, give them other work").

## 2. One task, one owner

Once a task goes to a teammate, do not also give it to a sub-agent or another teammate. Check whether she is busy before you assign; if she is, pick someone else or wait.
(2026-10-23: two members each assigned the same task.)

## 3. Several people editing the same files: merge the shared interface first

Merge the change to the shared interface first, then have the others rebase onto it. Name the base branch when you assign.
(2026-10-23: five CLIs edited the same interface file and conflicted pairwise.)

## 4. Notifying a busy teammate: one @ per person, say "no need to stop"

Do not start a line with several names in a row; the gate treats that as an interrupt.
(2026-10-23: one line with three names interrupted a teammate's work.)

## 5. Hand big tasks to a "workspace"

When a task will likely take more than 10 minutes, or needs code changes, test runs or waiting on commands (builds, long live tests), hand it to the primary role in the "workspace" channel in the same turn you accept it; do not do it in the chat channel. This holds even when it is your only task.
Also hand whole tasks over when you judge you are losing track (missed items, duplicate assignments, forgotten timers). Reference: more than about 6 parallel threads, or more than half of your context used (2026-10-23 review: with 8 parallel threads, timers were left running 3 times and one task was assigned twice).

Write the handoff as a file with at least the sections "用户原话" (user's words), "进度" (progress) and "规矩" (rules; include known pitfalls), plus "参照实现" (reference implementation: `file:line`, or "无（新建）" for non-code work). When several people edit the same files, also add a line "底分支：<branch>" (base branch). Then:

- `ws-handoff <file> "<one-line task>"` tells the primary role in the workspace to start. Once it is handed off, end this turn: do not sleep or poll the board waiting for it; the workspace sends the result back here with [report], and you check it then.
- `ws-forward [--notes <file>] "<summary>"` forwards later results there. This channel stops managing that task. `--notes` picks the handoff (and so the workspace); without it the latest handoff is used.
- ws-handoff reuses a free workspace, or one of this channel's with fewer than 3 tasks in work, and creates a new one only when all are busy. It also adds a board entry (owner: the workspace's lead) bound to this handoff.
- A stalled task (waiting for the user or someone else, untouched this hour) is paused at the hourly wrap-up: `board pause <id>`. Its handoff is released; with nothing else in work there, the workspace goes back to the pool and its sessions are reset. Reassigning it (`board update <id> <status> - <who>`) does the same. To resume, hand it off again with `ws-handoff`.

The primary role in a workspace does not ask the user directly. The chat channel that handed the task over is the single outlet:

- Results and milestones: the first line of the turn's last reply is only `[report]`, the result follows from the second line, and the bridge copies it to the chat channel (messages earlier in the turn are not copied). After the last task there, run `bothouse session new --after-turn` in the same turn to free the workspace.
- `ws-up "<question + options + recommendation>" --ask` asks for a decision or missing information. The chat-channel primary role asks the user and sends the answer back with `ws-forward --notes <file> "<answer>"`. While waiting, do the parts the answer does not affect.
- If the workspace holds tasks from more than one chat channel, add `--notes <file>` to say which task; without it ws-up fails and lists the choices instead of guessing.
- Decisions that narrow or change the scope of the user's words, and settings you are unsure of, also go through `--ask`. Decide pure technical details yourself.

(User, 2026-10-23: "if you feel you can't manage any more, open a new channel called workspace and hand the whole task, at a coarse grain, to the lead there".)

## 6. Cut work at 10 minutes

Work that cannot finish in 10 minutes must be cut (user, 2026-10-23: "if it can't be done in 10 minutes, drop it").

- For background work, run `t10 <pid>` right after starting it: at 10 minutes it stops the process and its children.
- For work assigned to a teammate in the channel, run `d10 <teammate name or ID> "<label>"` in the same turn: if she has not handed back by then, the primary role sends "pause"; if she has, nothing is sent; if she has not but committed or posted in the last 10 minutes, it waits another 10 minutes, at most twice.
- Do not claim a watchdog is set unless you set it.

## 7. Always isolate tests

When you assign test work, give it its own HOME, data directory and port in the prompt. Check the live directories before and after.
If anything changed, report it as an incident. (2026-10-23: a test deleted a live socket and wrote into a live data directory.)

- Before testing, run `iso-check before` and note the `ISO_DIR` it prints. Put the test's HOME, data directory and ports under it.
- After testing, run `iso-check after <ISO_DIR>`. The directory is required. It only deletes directories registered by this session and refuses other sessions' directories.
- Rehearse on a copy of the real config, not on an allow-all empty config: `rehearse-copy <real config>`. It runs `cp -a` into an isolated directory, replaces secrets with REDACTED by default, and keeps permission fields unchanged. When done, run `iso-check after <REHEARSE_DIR>`.
- Change the live config only after the rehearsal passes. Use the setup wizard or `setup apply`: before writing, it keeps the old file as `config.toml.bak-<time>`.
- If something breaks after the change, run `rehearse-copy --restore <config.toml> --dry-run` to see which backup it will use, then run it without `--dry-run` to put back the pre-change file, and restart the bridge. Hand edits leave no backup; before a hand edit, run `cp -p config.toml config.toml.bak-$(date +%Y%m%d-%H%M%S)` yourself.

## 8. At most two review rounds

Review the same thing at most twice: the first round looks at the plan or the change itself, the second only at what changed and the previous round's comments, without rereading from the top.
If it still fails the second round, stop and rethink the approach instead of reviewing it piece by piece; reviews list only must-fix items, not nice-to-haves.

## 9. Scale review to risk

For a small change in one place, covered by tests, verify with tests, checks and the diff range only — no separate reviewer.
For an ordinary change, have one person review it once; for live flows, the bridge, anything that spends money, and multi-component work, review the plan before the code. Whoever writes the code does not review it.

## 10. Assigning long tasks

If the wait is under 5 minutes, use a normal sub-agent; if it is 5 to 60 minutes, use a long-task agent, run the command in the background and continue from the completion notice.
If it is over an hour, start it in the background, write the log and result paths, hand off and stop; start a new agent when the result is in. While waiting, do not poll and do not sit idle.

## 11. Status line and calling a teammate

A teammate's reply starts with one of four tags: 【接】 take it and start, 【问】 not enough information, list what is missing, 【退】 not mine, say who fits better, 【升】 irreversible action, spending or a direction call, escalate to the primary role.
To get a specific teammate to answer, @ her or start a line with her name followed by a comma; a name in the middle of a sentence will not reach her, so do not write it that way when you only mean to mention her.

## 12. Fixed budget for always-on rules: add one, remove one

Always-on rules (the team-mode rules, the rule section in a persona) have a total cap: before adding a rule, remove or merge one; a byte-size test in `core` guards the cap on the team-mode rules.
When the same kind of mistake happens a second time, turn it into a check (a script, hook or test) instead of adding more text; `contrib/hooks/lessons.py` reads the "N 次" (N times) count of each entry in the wiki lessons table (`rule-candidates-recurrence*.md`) and reminds the agent on the first turn and when the user corrects it — an entry that reaches 2 should become a check.
