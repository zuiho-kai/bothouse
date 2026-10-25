# Channel member scope, workspace directories and shutdown cleanup

Draft only. Not pushed, not opened as a PR, not independently accepted, not deployed.
Base: origin/main e10bfb73. Branch: feat/channels-multichannel.

Previously all members and bridge bots shared a global roster and new member sessions used the instance directory. A late WebSocket disconnect could query a finalized SQLite statement during teardown. This branch stores optional member channel scopes, uses them for routing and the native channel UI, gives newly created native/CLI sessions the configured channel directory, and makes late draft cleanup safe after shutdown.

## Behavior

- Member rooms are persisted. Omitting rooms on edit retains the stored scope. Legacy UI rows with NULL scope are pinned once to existing chat channels. Explicit global/config members remain global.
- Workspace rooms use their current parent channel for member scope and directory selection. A released workspace reclaimed by another channel creates a native session in that channel's directory.
- Bridge connections may declare room=1 or room=room-1. Same names are allowed in disjoint channel scopes. Bot IDs remain instance-wide. Disconnect removes the bot from the in-memory roster; historical messages remain.
- The native channel UI filters its roster, mention candidates and lead choices; newly added members receive the current parent chat channel scope.
- Store.close is repeatable. drafts returns an empty list after database close, allowing late dropDrafts cleanup. Ordinary database queries still fail after close.

## Verification

Author-run checks before the final cleanup:

- cd dsh/collab && node --test *.test.mjs: 203 passed, 0 failed.
- cd dsh && pnpm test: 10 files, 139 tests passed.
- git diff --check: passed.

New executable developer check: node dsh/collab/verify-multichannel.mjs. Uses a temporary CONEST_COLLAB_DATA. Exit 1 indicates test failure; exit 2 indicates suites passed but acceptance remains incomplete. It does not certify all nine acceptance criteria. Independent reviewer must execute checks themselves.

Frontend dependencies were installed from the existing manifest without a lockfile because the test directory has no lockfile. Existing dependency sourcemap/KaTeX warnings occurred. No dependency manifest changes are intended.

## Risks and unfinished acceptance

- Migration implements the user request “新建频道……不要有任何的 agent……需要加东西，就重新加”. Confirmation time was not separately recorded. Explicit global/config members are an exception and remain visible in future channels. Migration is isolated in 70cbc1e4.
- Native session directory creation errors now include channel name and path and retain the original cause. CLI-specific directory diagnostics and startup existence validation remain to review.
- Existing native Sessions retain their original directory. Restart after configuration changes and use /new in that channel to create a new session. External bridge bot directories remain separately configured.
- Automated fake-runtime tests do not prove real desktop shutdown, live QQ connectivity, real model file writes, or a rebuilt GUI deployment.
- The service still has global-roster consumers requiring a further review before declaring complete isolation (including some bridge frame/display handling; legacy /collab roster filtering is now included). Current scope is channel routing and native UI behavior, not an authorization boundary.

## Rollback

Before deploying, back up collab.sqlite3 and configuration while the application is stopped. Roll back these feature commits or deploy the previous reviewed main build. Added nullable columns can remain unused by the older build (schema version is unchanged). Stop the application before restoring any backup; restoring a database backup loses messages written after that backup. No production data has been modified by this work.

## Review handoff

f3765d75 shutdown cleanup; 0304d570 per-channel directories; f78ce750 directory reuse coverage and CLI cache correction; d4f78c2a member scope foundation; 16fc7d98 routing and native UI integration; 70cbc1e4 one-time legacy member snapshot migration.
