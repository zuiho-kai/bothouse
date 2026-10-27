# Development handoff

## 2026-10-27: direct acceptance wakeups

- A terminal reply beginning with `【接】` also registers unfinished work accepted directly in chat. Existing handoff/d10 watches retain ownership; a chat acceptance without one uses the same one-shot callbacks.
- An active task-board owner is also registered at turn completion without requiring an acceptance phrase; waiting-user statuses are excluded unless there is a fresh acceptance. Handback uses the d10 policy, including acceptances that already contain a full result. Handbacks never create new watches, and a board item accepted, closed, paused or removed before the callback cancels its pending wake.
- A fresh acceptance takes precedence over a stale waiting-user task-card or board status, including when a human has replied since the earlier acceptance. Explicit reports and validated questions still stop wakeups.
- Before sending a wakeup, inspect the role's native background tasks and live child tasks. Their completion events resume terminal-event handling.
- Coordinators also wait quietly while their tracked relay is running, or while a peer is actively executing their direct chat dispatch in the same workspace. Both the terminal event and the pending wake callback check this state.
- Validation for this follow-up is compilation only, as requested.

## 2026-10-26: event-driven idle assignment wakeups

- Branch: `ws3/watch-idle-wake-1026`, based on `oss/develop` at `969710b1`.
- Foreground and unsolicited terminal events record unreturned workspace/d10 assignments before automatic task-card completion. One-shot callbacks wake idle roles after 15 seconds, twice, then escalate once to the source chat. Explicit reports/results and validated user questions suppress wakeups.
- `/team/watch` registers d10 assignments and supplies authoritative busy/returned state. Workspace handoffs and G6 task relay receipts keep ownership of deadline checks; d10 yields instead of sending a second deadline reminder. Relay terminal outcomes already return through their receipts.
- Deadline checks ask running workers for progress; stopped workers are woken without parking their handoff. The existing running-worker renewal/parking policy remains.
- Validation: `cd bridge && PATH="$HOME/sdk/go/bin:$PATH" go build ./...`. No tests or independent review were requested for this change. Browser assets used for compilation were copied from the existing local develop build; no frontend sources changed.
- Deployment and a real assigned task that stops mid-work remain for the release operator. This branch does not restart the bridge or change cc-connect configuration. Pending idle callbacks are process-local; a restart retains assignment state, while the existing deadline check can re-arm idle wakeups.
