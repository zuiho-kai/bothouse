# Redundancy audit of develop

Baseline: `e01256d1aa86a7d1e1c58469bcad4d9682e632f1` (2026-11-12).

## Scope and method

Inventoried all 4,106 tracked paths and scanned 3,185 source files (Go, Python,
JavaScript/TypeScript, shell/PowerShell and Makefiles), including tests. Reviewed
bridge CLI/core/config/daemon, every registered agent and platform, web, gate/hooks/wiki,
DSH, companion, role-household, plugins, integrations and build/release entry points.
This is a static audit, not proof that every runtime path is free of redundancy.

Go call-graph analysis used the existing `golang.org/x/tools/cmd/deadcode` tool:

- macOS/arm64, CGO enabled, default tags (including web): 106 unreachable functions.
- Linux/arm64, CGO disabled, `no_web`: 118 unreachable functions.
- Windows/arm64, CGO disabled, `no_web`: 107 unreachable functions.
- Intersection: 100 functions. Linux-only tray findings were excluded; macOS
  initially failed with CGO disabled and was rerun with CGO enabled.

The whole-tree reference scan includes tests and all build-tagged source files.
Candidates below are retained unless they have neither source/test callers nor an
interface/exported API requirement. Reflection does not invoke unexported methods;
no go:linkname entry was found in the affected directories. RTA alone is not a
removal criterion. Generated code, embedded mirrors, historical compatibility,
external APIs and test helpers are retained. No test is deleted in this change.

## Confirmed removals

Line numbers refer to the baseline, before deletion.

| Location | Symbol | Evidence |
| --- | --- | --- |
| `bridge/agent/codex/session.go:748` | `loadCodexRuntimeConfig` | Declaration is the sole identifier reference across tracked source including tests; unreachable in all three Go configurations. |
| `bridge/agent/iflow/session.go:803` | `readExecutionInfoSessionID` | Declaration is the sole identifier reference across tracked source including tests; unreachable in all three Go configurations. |
| `bridge/agent/iflow/session.go:817` | `extractSessionIDFromExecutionInfo` | Declaration is the sole identifier reference across tracked source including tests; unreachable in all three Go configurations. |
| `bridge/cmd/cc-connect/update.go:420` | `binaryAssetName` | Declaration is the sole identifier reference across tracked source including tests; unreachable in all three Go configurations. |
| `bridge/core/engine.go:1363` | `persistReasoningEffort` | Declaration is the sole identifier reference across tracked source including tests; unreachable in all three Go configurations. |
| `bridge/core/engine.go:10854` | `appendFinalMetadataToSegment` | Declaration is the sole identifier reference across tracked source including tests; unreachable in all three Go configurations. |
| `bridge/core/engine.go:14990` | `sendForWorkspace` | Declaration is the sole identifier reference across tracked source including tests; unreachable in all three Go configurations. |
| `bridge/core/engine.go:19802` | `stringSliceContains` | Declaration is the sole identifier reference across tracked source including tests; unreachable in all three Go configurations. |
| `bridge/core/public_progress.go:1275` | `progressInstructions` | Declaration is the sole identifier reference across tracked source including tests; unreachable in all three Go configurations. |
| `bridge/core/team_task_review.go:628` | `taskPausedSince` | Declaration is the sole identifier reference across tracked source including tests; unreachable in all three Go configurations. |
| `bridge/core/public_progress.go:1257` | `PublicProgress.journalOnly` | Only caller is the removed `progressInstructions`; also unreachable in all three configurations. |
| `bridge/core/public_progress.go:1275` | `Engine.progressInstructions` | Superseded by `currentTaskLine` plus `ProgressHelp`; unreachable in all three configurations. |
| `bridge/core/public_progress.go:1271` | `voiceProgressPrompt` | Unreferenced constant; voice uses `currentTaskLine`. Shared CLI help constants remain. |
| `bridge/agent/iflow/session.go:26` | `sessionIDRe` | Referenced only by removed `extractSessionIDFromExecutionInfo`. |
| `bridge/Makefile:46` | First `ALL_AGENTS` assignment | Immediately overwritten at line 48, before any use; keep final assignment unchanged. |
| `bridge/Makefile:47` | First `ALL_PLATFORMS` assignment | Immediately overwritten at line 49, before any use; keep final assignment unchanged. |

Replacement history strengthens the source evidence:

- `40e3082b8`: moved per-turn progress instructions to `ProgressHelp`; live
  injection uses `currentTaskLine`, leaving the old formatter, journal selector
  and voice-specific prompt behind.
- `f7a722175` (#1367): Codex runtime config caller moved to
  `loadCodexRuntimeConfigAs`, preserving spawn identity.
- `1660a12f4` (#840): model/effort switching became channel-local, leaving
  `persistReasoningEffort` uncalled. Public setter/config compatibility is retained.
- `05f30fa44`: release downloads use `core.DownloadReleaseAsset`; the old
  `binaryAssetName` no longer participates in updates.
- `b81f16a57`: paused tasks no longer get hourly reminders; `taskPausedSince`
  lost its caller. Current pause/queue logic remains.

## Duplicate implementations retained

The AST scan found 14 groups of identical Go bodies of at least 10 lines. Exact
body equality ignores signatures: it does not prove types, receivers or contracts
are interchangeable. Locations and decisions follow.

- `bridge/agent/antigravity/antigravity.go:346` (`CommandDirs`); `bridge/agent/gemini/gemini.go:295` (`CommandDirs`). Candidate: different packages or receivers; extraction changes live adapter/package boundaries, so no deletion based on text equality.
- `bridge/agent/antigravity/antigravity.go:358` (`SkillDirs`); `bridge/agent/gemini/gemini.go:309` (`SkillDirs`). Candidate: different packages or receivers; extraction changes live adapter/package boundaries, so no deletion based on text equality.
- `bridge/agent/claudecode/claudecode.go:1121` (`uniqueSkillDirs`); `bridge/agent/codex/codex.go:779` (`uniqueCodexSkillDirs`). Candidate: different packages or receivers; extraction changes live adapter/package boundaries, so no deletion based on text equality.
- `bridge/agent/claudecode/session.go:1405` (`extFromMime`); `bridge/agent/codex/session.go:324` (`codexImageExt`). Candidate: different packages or receivers; extraction changes live adapter/package boundaries, so no deletion based on text equality.
- `bridge/agent/codex/context_usage.go:50` (`contextUsageFromCamel`); `bridge/agent/codex/context_usage.go:62` (`contextUsageFromSnake`). Keep: different input struct types and JSON schemas.
- `bridge/agent/codex/proc_windows.go:26` (`forceKillCmd`); `bridge/agent/copilot/proc_windows.go:33` (`forceKillCmd`). Candidate: different packages or receivers; extraction changes live adapter/package boundaries, so no deletion based on text equality.
- `bridge/core/engine.go:12683` (`sanitizeTelegramMenuCommand`); `bridge/core/engine.go:18099` (`sanitizeTelegramDisplayCommand`). Candidate: same-package pure sanitizers; possible shared helper, retained pending caller/test review.
- `bridge/core/reference_render.go:289` (`isValidAbsoluteReferenceBoundary`); `bridge/core/reference_render.go:304` (`isValidRelativeReferenceBoundary`). Candidate: distinct semantic contracts, currently equal bodies; consolidation would change live callers and is deferred.
- `bridge/platform/cloud-web/gateway.go:212` (`dispatchBatchPayload`); `bridge/platform/cloud-web/poll.go:184` (`dispatchBatchPayload`). Candidate: different packages or receivers; extraction changes live adapter/package boundaries, so no deletion based on text equality.
- `bridge/platform/cloud-web/gateway.go:240` (`dispatchOne`); `bridge/platform/cloud-web/poll.go:212` (`dispatchOne`). Candidate: different packages or receivers; extraction changes live adapter/package boundaries, so no deletion based on text equality.
- `bridge/platform/cloud-web/public_progress.go:179` (`taskCardState`); `bridge/platform/feishu/public_progress.go:279` (`feishuTaskCardState`). Candidate: different packages or receivers; extraction changes live adapter/package boundaries, so no deletion based on text equality.
- `bridge/platform/feishu/feishu.go:4437` (`buildProgressPanel`); `bridge/platform/feishu/feishu.go:6560` (`buildRichPanel`). Candidate: equal rendering bodies; retain named entry points until their callers and panel contract are reviewed.
- `bridge/platform/matrix/matrix.go:850` (`notifyUnavailable`); `bridge/platform/telegram/telegram.go:764` (`notifyUnavailable`). Candidate: different packages or receivers; extraction changes live adapter/package boundaries, so no deletion based on text equality.
- `bridge/platform/qq/watermark.go:15` (`watermarkPathSegment`); `bridge/platform/weixin/weixin.go:109` (`sanitizePathSegment`). Candidate: different packages or receivers; extraction changes live adapter/package boundaries, so no deletion based on text equality.

Whole-file hashing found 58 duplicate groups: 56 are DSH source/embedded bundle
pairs; two are the standalone plugin client helper and its tests in the template,
journal, notify and webhook packages. The DSH mirrors are consumed by Go embed and
checked by `TestDSHBundleCollabMatchesSource`; plugin packages ship independently.
Keep these packaging copies, rather than deleting an installed entry point.

Python AST found one identical non-test function group:
`bridge/contrib/gate/filelock.py:7` and
`bridge/contrib/wiki/llmwiki/filelock.py:6` (`lock`). The gate file explicitly
explains its standalone installation (`embed_gate.go`); keep both copies.

## Remaining call-graph candidates

Each row is unreachable in all three configurations, but remains because it is
exported, used by tests, or part of a larger implementation requiring separate
caller/contract review. These are **not** 89 confirmed deletions. Source positions
are precise; the call-graph intersection is reproducible with the commands above.

| Location | Symbol | Decision |
| --- | --- | --- |
| `bridge/agent/acp/mapping.go:320` | `truncateRunes` | Retain; no removal based solely on main-program reachability. |
| `bridge/agent/antigravity/turn_status.go:237` | `nativeTrajectory.confirmsHistoricalError` | Retain; no removal based solely on main-program reachability. |
| `bridge/agent/codex/appserver_session.go:261` | `newAppServerSession` | Retain; no removal based solely on main-program reachability. |
| `bridge/agent/opencode/opencode.go:228` | `Agent.configuredModels` | Retain; no removal based solely on main-program reachability. |
| `bridge/agent/opencode/opencode.go:295` | `Agent.activeProviderKey` | Retain; no removal based solely on main-program reachability. |
| `bridge/agent/opencode/opencode.go:341` | `Agent.persistentModels` | Retain; no removal based solely on main-program reachability. |
| `bridge/cmd/cc-connect/send.go:436` | `decodeSendPayload` | Retain; no removal based solely on main-program reachability. |
| `bridge/cmd/cc-connect/update.go:123` | `verifyDownloaded` | Retain; no removal based solely on main-program reachability. |
| `bridge/cmd/cc-connect/update.go:440` | `extractBinaryFromArchive` | Retain; no removal based solely on main-program reachability. |
| `bridge/cmd/cc-connect/update.go:447` | `extractFromTarGz` | Retain; no removal based solely on main-program reachability. |
| `bridge/cmd/cc-connect/update.go:489` | `extractFromZip` | Retain; no removal based solely on main-program reachability. |
| `bridge/cmd/cc-connect/update.go:522` | `downloadToTemp` | Retain; no removal based solely on main-program reachability. |
| `bridge/config/wizard.go:45` | `UpsertWizardProject` | Retain; no removal based solely on main-program reachability. |
| `bridge/config/wizard.go:428` | `ListPlatformProjects` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/api.go:182` | `APIServer.SocketPath` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/api.go:200` | `APIServer.RelayManager` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/capacity_retry.go:570` | `Engine.quotaCoolingUntil` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/card.go:142` | `CardBuilder.Markdownf` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/dsh_web_owner.go:100` | `dshWebOwnDataDir` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/engine.go:1173` | `estimateTokens` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/engine.go:4086` | `Engine.queueMessageForBusySession` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/engine.go:14976` | `Engine.sendWithErrorForWorkspace` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/engine.go:18888` | `splitMessage` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/engine.go:18922` | `Engine.sendTTSReply` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/gate.go:712` | `gateState.buffer` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/gate.go:1044` | `Engine.withTurnBlocks` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/gate_proc.go:85` | `gateIsOurs` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/imagegen.go:186` | `ImageGenerator.OutDirError` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/management_skills.go:33` | `ManagementServer.SetDownloadSkillPreset` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/management_update.go:59` | `resetUpdateCheckCache` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/member_workspace.go:389` | `Engine.memberOp` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/model_command.go:69` | `listModels` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/progress_compact.go:83` | `BuildProgressCardPayload` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/protoconv.go:109` | `NewProtoConvHandler` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/public_progress_lifecycle.go:42` | `PublicProgress.runStart` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/python_env.go:98` | `ProductPythonBinDir` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/quota_cooling.go:129` | `Engine.recordQuota` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/quota_cooling.go:133` | `Engine.observeQuotaEvent` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/quota_cooling.go:193` | `Engine.observeQuotaUsage` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/quota_scope.go:285` | `Engine.recordQuotaFor` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/quota_scope.go:430` | `Engine.waitQuotaUpdates` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/read_frequency_claudecode.go:21` | `ClaudeCodeReadSource.Name` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/read_frequency_events.go:19` | `EventsReadSource.Name` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/relay_voice_pool.go:160` | `voiceSessionPool.count` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/relay_voice_stream.go:110` | `voiceSentenceSplitter.rest` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/setup_dsh_configure.go:485` | `OpenDSHWeb` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/setup_dsh_configure.go:636` | `scanDSHWebURL` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/setup_dsh_module.go:334` | `SetDSHModuleDisabled` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/skill_presets.go:69` | `SetSkillPresetsURL` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/streaming.go:703` | `streamPreview.needsDoneReaction` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/task_thread_progress.go:62` | `Engine.taskThreadProgress` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/team_board.go:464` | `teamEntryIsDM` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/team_board.go:542` | `renderTeamBoard` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/team_board.go:554` | `boardMember` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/team_board.go:575` | `teamTaskMember.live` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/team_board.go:579` | `renderTeamBoardMembers` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/team_board.go:586` | `teamBoardMembers` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/team_board.go:672` | `boardTask` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/team_exit.go:177` | `Engine.forwardWorkspaceExit` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/team_exit.go:499` | `Engine.postExitOriginal` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/team_mode.go:183` | `TeamModeWorkspaceInstructions` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/team_report_delivery.go:150` | `Engine.reportSeenRecently` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/team_report_delivery.go:165` | `Engine.rememberReport` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/team_task_board.go:191` | `teamTaskBoardWaitHours` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/team_task_board.go:827` | `renderTeamTaskBoard` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/team_task_board.go:1230` | `renderTeamTaskBoardFit` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/team_task_board.go:1296` | `teamChatRef` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/team_task_index.go:119` | `renderTeamBoardWithTasks` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/team_task_index.go:126` | `teamBoardWithTasks` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/team_task_review.go:299` | `taskReviewTierModel` | Retain; no removal based solely on main-program reachability. |
| `bridge/core/usage_ledger.go:150` | `UsageLedger.Record` | Retain; no removal based solely on main-program reachability. |
| `bridge/daemon/env_extension.go:32` | `RegisterEnvDiscoverer` | Retain; no removal based solely on main-program reachability. |
| `bridge/daemon/env_extension.go:42` | `ResetEnvDiscoverers` | Retain; no removal based solely on main-program reachability. |
| `bridge/platform/discord/progress.go:19` | `buildDiscordPreviewMessage` | Retain; no removal based solely on main-program reachability. |
| `bridge/platform/discord/progress.go:44` | `buildDiscordPreviewEdit` | Retain; no removal based solely on main-program reachability. |
| `bridge/platform/discord/progress.go:51` | `buildDiscordPreviewEditView` | Retain; no removal based solely on main-program reachability. |
| `bridge/platform/discord/progress.go:79` | `buildDiscordProgressEmbed` | Retain; no removal based solely on main-program reachability. |
| `bridge/platform/discord/progress.go:238` | `buildDiscordProgressDescription` | Retain; no removal based solely on main-program reachability. |
| `bridge/platform/discord/progress.go:311` | `buildDiscordProgressList` | Retain; no removal based solely on main-program reachability. |
| `bridge/platform/discord/subtasks.go:44` | `buildDiscordSubTaskEmbed` | Retain; no removal based solely on main-program reachability. |
| `bridge/platform/discord/task_card.go:12` | `RenderTaskCardEmbed` | Retain; no removal based solely on main-program reachability. |
| `bridge/platform/discord/task_card.go:140` | `renderTaskMembers` | Retain; no removal based solely on main-program reachability. |
| `bridge/platform/feishu/feishu.go:283` | `New` | Retain; no removal based solely on main-program reachability. |
| `bridge/platform/feishu/feishu.go:2340` | `extractPostPlainText` | Retain; no removal based solely on main-program reachability. |
| `bridge/platform/feishu/feishu.go:3161` | `hasComplexMarkdown` | Retain; no removal based solely on main-program reachability. |
| `bridge/platform/feishu/feishu.go:3244` | `buildPostJSON` | Retain; no removal based solely on main-program reachability. |
| `bridge/platform/feishu/feishu.go:3356` | `parseInlineMarkdown` | Retain; no removal based solely on main-program reachability. |
| `bridge/platform/feishu/feishu.go:3472` | `findSingleAsterisk` | Retain; no removal based solely on main-program reachability. |
| `bridge/platform/tuitui/tuitui.go:469` | `Platform.isAllowed` | Retain; no removal based solely on main-program reachability. |

## Coverage and limitations

- All registered CLI/platform adapters were included through the normal command
  entry point. Public interfaces, optional registrations and OS-specific paths
  remain intact; no claim of live acceptance on every external CLI/platform.
- Python/JS/TS coverage is inventory, exact duplicate detection, source references
  and entry-point review, not a sound whole-program reachability proof. Dynamic
  imports, plugin loaders, hooks and scripts remain candidates, never auto-deleted.
- `bh` and `bh-linux-arm64` are tracked binary artifacts. Their age and consumers
  require release-policy review; no binary artifact is deleted here.
- Compatibility branches such as Kimi's two transcript schemas, QQ watermark
  migration, Discord legacy workspace categories and deprecated config aliases
  have live callers and are retained.
- `docs/GOALS.md` still describes the project as a plugin, conflicting with current
  README/product terminology. Documentation candidate only; no product rename.
- No issue bug fix, deployment, release, restart, runtime configuration or user
  data change belongs to this cleanup.

## Validation

`go build -tags no_web ./...` passed in an isolated HOME. Targeted tests for
`core`, `agent/codex`, `agent/iflow` and `cmd/cc-connect` are running in the
same isolation; CI is pending. No merge or deployment claimed.
