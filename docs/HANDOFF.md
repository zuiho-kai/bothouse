# Development handoff

## 2026-10-26: event-driven idle assignment wakeups

- Branch: `ws3/watch-idle-wake-1026`, based on `oss/develop` at `969710b1`.
- Foreground and unsolicited terminal events record unreturned workspace/d10 assignments before automatic task-card completion. One-shot callbacks wake idle roles after 15 seconds, twice, then escalate once to the source chat. Explicit reports/results and validated user questions suppress wakeups.
- `/team/watch` registers d10 assignments and supplies authoritative busy/returned state. Workspace handoffs and G6 task relay receipts keep ownership of deadline checks; d10 yields instead of sending a second deadline reminder. Relay terminal outcomes already return through their receipts.
- Deadline checks ask running workers for progress; stopped workers are woken without parking their handoff. The existing running-worker renewal/parking policy remains.
- Validation: `cd bridge && PATH="$HOME/sdk/go/bin:$PATH" go build ./...`. No tests or independent review were requested for this change. Browser assets used for compilation were copied from the existing local develop build; no frontend sources changed.
- Deployment and a real assigned task that stops mid-work remain for the release operator. This branch does not restart the bridge or change cc-connect configuration. Pending idle callbacks are process-local; a restart retains assignment state, while the existing deadline check can re-arm idle wakeups.
