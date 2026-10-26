# Review notes — bothouse PR #430 (fix/relay-drain-kill)

- PR head: `0ddd12dabf44c60ebaafa14a26ecd212ebcc7349`
- Merge base with `origin/main`: `6374f04ee37d384986627f037630ad0208bb462a`
- Worktree: `/Users/zhaixinyang/agents-demo/.work/bothouse-430-review` (local branch `review/fy-430-review`)
- Reviewer: fyreview (肥鱼); author branch is untouched.

## Checks run

- `go test ./core/ -run 'Test(RelayWatch|TaskRelayDrain|PlainRelayDrain|Watch)' -count=1` — PASS (9.276s)
- same selection plus `TestDSHBundleCollabMatchesSource` with `-race` — PASS (5.900s)
- `node --test dsh/collab/*.test.mjs` — PASS 231/231
- `dsh/collab/tasks.mjs` vs `bridge/core/dsh_bundle/collab/tasks.mjs` — identical; `collab.test.mjs`, `team-mode-rules.md` identical too.

## Findings (draft, to refine before posting)

1. **HIGH — busy session renews a workspace watch forever.** `team_watch.go` `workspaceProgress` returns true whenever any session of the workspace is `Busy`; `watchCanRenew(0)` is always true; `check` renews and resets `Since` on every progress. With `watchMaxRenew=0`, a hung turn that keeps `Session.busy=true` holds the workspace forever, with no nudge and no park. `TestWatchBusySessionIsNotStopped` now forces `withWatchMaxRenew(t, 2)`, so the default has no coverage. Need a separate busy grace/absolute wall-clock backstop; add a default-cap busy test.

2. **MEDIUM — no watch means no timeout.** `sendTask` calls `ensureRelayWatch(source.ctx)`; it returns without starting when `source.ctx` is nil/stale. `drainRelaySession` sets `timeout=nil` whenever `stop != nil`. A task relay then has neither watch nor safety timer. Concrete: `HotRemove` stops the source engine while the target engine keeps running; the watch dies, the target drain stays alive. Same for a target `Send` that hangs after `EventResult` (sendDone never closes) once the watch is gone. Suggest `ensureRelayWatch` return an error and let `sendTask` fall back to `relayDrainSafety`, or tie the drain to the source watcher lifecycle.

3. **MEDIUM — restart interruption reports but never wakes the lead.** `relayWatchRun`'s `d == nil` branch (`relay_watch.go:170-173`) sets `WatchDone` and appends `relayWatchInterrupted`, but `wakeRelayLead` is only called from `drainRelaySession`'s completion (`relay_task.go:83`). After a bridge restart there is no drain; a lead that is idle never learns the run was interrupted. Add a wake from the `d == nil` path (receipt has TaskID/RequestID/Target; Task has SessionKey).

4. **MEDIUM/LOW — d10-fire and its docs still cap at 2.** `bridge/contrib/lead/d10-fire:31` `MAX_RENEW = 2`; README:21 and PLAYBOOK.zh-CN.md:52 say "最多续 2 次", while the injected team rule and `tasks.mjs` comment now say unlimited. The tasks.mjs comment "same rule as contrib/lead/d10-fire MAX_RENEW" is stale. Either update d10-fire/docs or state that the unlimited rule is only for bridge/DSH watch.

5. **LOW — wake can still be silently lost.** `wakeRelayLead` only logs when `timerScheduler == nil` or `AddJob` errors. AddJob only stores/schedules; execution errors (queue full, platform not ready beyond retries) are asynchronous and mark the job fired. Also source-engine hot removal unregisters the engine from the timer scheduler, so the wake job can be marked "project not found". Consider a durable pending-wake on the target or a direct delivery path.

6. **NOTE — G35 test change.** The new wall-clock base keeps the test passing under no cap; the `awaitingUser` assertion still has teeth. But it couples the test to real time and means the stale `[ask]` is only in the first window. Low risk; prefer injected clock/explicit timestamps in a follow-up.

## Verified non-issues

- Task relay drain yields to the watch normally; watch-stop after wait wakes exactly one timer job (test asserts one).
- `completion` is called once per drain; normal pre-timeout return does not call it, so no double wake there.
- DSH/bridge bundle copies are byte-identical.
- Plain relay keeps its 10-minute safety limit.

## Checkpoint update

- PR #430 was merged during this review at `d7fced88a39d65ed9b424482176f8c055387f646` (02:45:53Z); code tree matches reviewed head `0ddd12da` (only `docs/astrbot-bridge.md` differs because main advanced).
- Throwaway probes (not committed) confirmed: (a) six busy checks renew 1..6 and never park; (b) source engine ctx canceled => `relay watch: not started` and task relay session still open 10x safety period after wait ends.
- Final posted body: `review-body.md`.
