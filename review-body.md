## 独立审核（合并后补发）— PR #430 / head `0ddd12da`

我开始审核时 PR 还是 OPEN/draft；审核过程中它于 2026-10-26T02:45:53Z 被合并为 `d7fced88`。我只审了 PR，没有改作者分支，也没有 approve/合并。合并树与 `0ddd12da` 的代码差异只有 main 上新增的 `docs/astrbot-bridge.md`，下面的代码结论对合并后的代码同样成立。

### 结论

方向是对的：普通 relay 的 10 分钟安全期保留；任务派工改由十分钟看门的 `stop` 结束；结束后向派活会话投递一次回执唤醒。相关测试和 DSH 231 个测试都通过。

但 `watchMaxRenew = 0` 把工作区看门里“会话在忙”这个信号从有限续期变成无限续期（高严重度，见第 3 节），另有“看门没启动时既无看门也无安全计时”和“重启中断后不唤醒”两个缺口。建议先修高严重度项或开 follow-up，再部署 #429；否则线上可能再次出现“没人接手”的变体。

---

### 1. 协程/会话泄漏路径（重点 1）

**正常路径**：任务派工在等待超时后进入 `drainRelaySession`；结果到达、`sendDone` 关闭、看门 `stop`、目标 engine `e.ctx.Done()` 都会退出。普通 relay 仍走 10 分钟 `relayDrainSafety`，`TestPlainRelayDrainKeepsSafetyLimit` 通过。桥接整体停止时目标 engine 的 `e.ctx.Done()` 也会关会话，这条没问题。

**中（P2）— 看门没启动时，drain 没有任何兜底。**  
`sendTask` 在 `relay_task.go:71` 调用 `source.publicProgress.ensureRelayWatch(source.ctx)`；`ensureRelayWatch` 在 `source.ctx == nil || ctx.Err() != nil` 时只打一条日志并返回（`relay_watch.go:39-47`），不会启动看门。与此同时 `drainRelaySession` 只要 `stop != nil` 就把安全计时置空（`engine.go:17676-17678`），而 `stop` 只由看门关闭。于是任务派工既没有看门也没有 10 分钟安全期。

我写了一个临时探针（未提交）复现：取消 source engine 的 ctx 后再发任务派工，等待结束后日志出现

```text
relay watch: not started, engine is stopping; this dispatch has no ten-minute watch
```

把 `relayDrainSafety` 缩到 20ms，等 10 倍期限（200ms）后 `s.closed` 仍未关闭。这不是纯理论路径：`HotRemove` 只停止被移除的那个 project（`bridge/cmd/cc-connect/project_runtime.go:263-281`），目标 engine 还在跑；source 的看门随 ctx 结束，目标 side 的 drain 就永久留着。另一个同类路径是 `EventResult` 已到但 `sendDone` 仍阻塞，且看门已不在。

建议：让 `ensureRelayWatch` 返回是否启动成功/错误；未启动时让 `sendTask` 传 `stop = nil` 给 drain（保留 10 分钟安全期），或至少给任务 relay 一个远大于看门窗口的最终保险；也可以让 drain 一并监听 source ctx。并补一个“watch not started”的回归测试。

### 2. `wakeRelayLead` 的重复、丢失、错会话（重点 2）

**重复：没有发现重复路径。** `completion` 只在 `drainRelaySession` 的 defer 里调用一次（`engine.go:17663-17668`），每个 `sendTask` 只有一个 completion；等待未超时的正常返回不会走 drain，也不会额外调用。新增测试最后断言 timer store 只有 1 个 job，符合。

**中（P2）— 桥重启后的中断不会唤醒主 bot。**  
`relay_watch.go:170-172` 的 `d == nil` 分支只把 `WatchDone` 置 true、追加 `relayWatchInterrupted` 事件，没有调用 `wakeRelayLead`。重启后没有旧的 drain，`wakeRelayLead` 的唯一调用点 `relay_task.go:83` 也不会执行；如果主 bot 已空闲，它不会知道“这次派活已中断，请重派”，只能靠人去看卡片。建议在这个分支用 `r.record.Task.SessionKey`、receipt 的 `TaskID`/`RequestID` 构造一次唤醒；或者在 Issue 里明确重启中断不在本 PR 的唤醒范围。

**低（P3）— 唤醒仍可能被静默丢弃。** `wakeRelayLead` 在 `timerScheduler == nil` 或 `AddJob` 返回错误时只打日志（`relay_task.go:327-330`、`355-357`）；`AddJob` 只负责持久化和调度，真正执行失败（队列满、`project not found` 等）是在 `timer.go:413-457` 异步发生并直接 `MarkFired`。配合 source project 的 `HotRemove`（timer scheduler 会先 `UnregisterEngine`），这条唤醒可能正好落进“project not found”而丢失。要么在目标 engine 上落一个可重试的 pending wake，要么让 `wakeRelayLead` 的失败可观测/可补投。

**错会话：正常路径是对的，但有一个会话键复用的残余风险。** `beginTaskRelay` 在派工时校验 `r.record.Task.SessionKey == req.SessionKey`（`relay_task.go:149-150`），wake 使用同一个 source session key 和 source engine，正常情况下不会串会话。但 `TimerJob` 最终走 `GetOrCreateActive(sessionKey)`；如果任务运行期间该 session 被 `/new`、被工作区回收/重新分配而同一个 key 被另一个对话复用，唤醒可能进入新对话。建议在 wake prompt 里带 task id 并由主 bot 核对，或记录 expected agent session id 再决定是否投递；至少加一个“session 已被替换”的测试。

**覆盖缺口（低）**：新增 `TestTaskRelayDrainOutlivesSafetyLimitAndWakesLead` 只覆盖“看门停止后唤醒”，没有覆盖“等待结束后 worker 正常交回结果”的唤醒，也没有覆盖 stop 与 EventResult 同时到达时只唤醒一次。PR 描述把“交回结果”列为主要场景之一，建议补上。

### 3. `watchMaxRenew = 0` 与“会话在忙”无限续期（重点 3）

**高（P1）— 工作区看门会无限续期一个卡死的 busy 回合。**  
`team_watch.go:381-386` 的 `workspaceProgress` 先检查 `workspaceBusy`；`workspaceBusy` 只要工作区里任一 session 处于 `Session.Busy` 就返回 true（`team_watch.go:431-437`）。`check` 在 `team_watch.go:260` 用 `watchCanRenew(h.Renewed)` 判断，而 `watchCanRenew` 在 `watchMaxRenew = 0` 时永远为 true（`51`、`54`）；随后 `290-301` 续期并清空 `Since`。结果：一个卡死但一直占着 session 的回合每 10 分钟都被当作“有进展”，永远不催办、不 park，工作区池槽位被永久占住。原来最多续两次的兜底没有了，作者在 PR 描述里也自认了这一点。

我另跑了一个临时探针（未提交）：锁定工作区 session 后连续调用 6 次 `w.tick`，输出是 `renewed=1..6, parked=false`，第 6 次的 `next` 已经在两小时后；探针最后报 `BUG: six busy checks renewed=6 and never parked`。现有 `TestWatchBusySessionIsNotStopped` 在 `team_watch_test.go:654` 用 `withWatchMaxRenew(t, 2)` 显式设了上限，恰好把默认值的这个问题绕过去了；默认无上限下没有对应测试。

建议：不要用“busy = 无限进展”。把 busy 单独做成有预算的信号，例如 `busyRenew` 最多 2 次（30 分钟）后按无进展处理，或给每个 handoff 一个绝对的 wall-clock 上限（比如数小时）作为保险；文字进展仍可无限续。补一个默认 cap、busy 超过旧上限后必须 nudge/park 的测试。DSH 的 `MAX_RENEWALS = 0` 没有这个 busy 信号（它的 progress 是 owner 的消息），不是同一条 bug；但 Go 工作区看门是实际会碰到的。

### 4. DSH 副本与 G35（重点 4）

- `dsh/collab/tasks.mjs`、`bridge/core/dsh_bundle/collab/tasks.mjs`、两份 `collab.test.mjs`、两份 `team-mode-rules.md` 我逐字 diff，全部一致；`TestDSHBundleCollabMatchesSource` 和 `TestWatchConstantsMatchDSH` 通过。`workflow.test.mjs` 只在 `dsh/collab` 下（它是测试文件，不会进 bundle），可以接受。
- G35 改动的核心断言没有被削弱：如果 `awaitingUser` 错误地返回 true，看门会每个窗口都续期且 `paused_at` 一直为空，测试会失败；231 个 DSH 测试也通过。  
  但 `collab.test.mjs:4674-4682` 的注释不准确：`base = ceil(Date.now()/1000)+5`，而 `say()` 走 `store.append` 的默认 `Date.now()/1000`，这些 report/rework 行落在 `base+1` 之前，并不是“落在第一个窗口”；它们在任何窗口都不算 progress。测试仍然能覆盖 stale `[ask]` 不持有看门，但这个用例本来就没有真正覆盖“owner 后续消息作为 progress”的路径。建议用显式时间戳/注入时钟，别依赖墙钟；这是低优先级测试质量问题，不阻塞。

### 5. 其他一致性问题

**中低（P2/P3）— d10-fire 还是“最多续 2 次”。**  
本 PR 把 `team-mode-rules.md` 的团队规则改成“有就一直续”，但 `bridge/contrib/lead/d10-fire:31` 仍是 `MAX_RENEW = 2`；`bridge/contrib/lead/README.md:21` 和 `PLAYBOOK.zh-CN.md:52` 也还写“最多续 2 次”。`dsh/collab/tasks.mjs:29` 的注释仍说“same rule as contrib/lead/d10-fire MAX_RENEW”，现在已不成立。如果主角色还在用 d10-fire，就会同时存在“桥/DSH 无限续”和“lead 脚本两次就停”两套行为。请更新脚本/文档，或明确本 PR 的无限续只适用于 bridge/DSH 看门。

另外：Issue #429 写“续期上限另行决定，本 Issue 不改默认值”，PR 却把默认值改为 0。PR 描述称用户 2026-10-26 已同意；合并/部署记录里应保留这个同意的链接或原话，否则这部分应拆回独立 Issue。

### 我实际跑过的验证

- `go test ./core/ -run 'Test(RelayWatch|TaskRelayDrain|PlainRelayDrain|Watch)' -count=1` — PASS（9.276s）
- 同一组加 `TestDSHBundleCollabMatchesSource`、`-race` — PASS（5.900s）
- `go test ./core/ -run TestCUJ -count=1` — PASS（28.553s）
- `go vet ./core/` — PASS
- `node --test dsh/collab/*.test.mjs` — PASS 231/231（2.1s）
- 没有跑全量 `go test ./core/`（作者报告 706s；本次按任务要求聚焦相关测试与 DSH）。上面两个临时探针测试只为验证问题，未提交到任何分支。
