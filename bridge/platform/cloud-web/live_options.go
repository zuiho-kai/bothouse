package cloudweb

import (
	"fmt"
	"sort"
	"strings"
)

// lead returns team_lead_bot; ReloadOptions may change it while running.
func (p *Platform) lead() string {
	p.liveMu.RLock()
	defer p.liveMu.RUnlock()
	return p.teamLead
}

// replyAll returns group_reply_all; ReloadOptions may change it while running. The 闸门设置页
// (#217) flips this one flag for 智能判断 / 只在被叫到时回, so it must be read under the lock.
func (p *Platform) replyAll() bool {
	p.liveMu.RLock()
	defer p.liveMu.RUnlock()
	return p.groupReplyAll
}

func copyOpts(opts map[string]any) map[string]any {
	out := make(map[string]any, len(opts))
	for k, v := range opts {
		out[k] = v
	}
	return out
}

// ReloadOptions applies the options from config.toml that a running cloud_web bot takes without
// reconnecting: team_lead_bot (adding a role in the setup wizard names the lead on the roles
// already running, core/setup_wizard.go cloudWebTeamWrites) and group_reply_all (the gate page's
// 智能判断 / 只在被叫到时回 — without it a mode change would sit in config.toml until a restart).
// It returns every other option that differs from what the bot started with (keys injected by
// cc-connect, "cc_*", are skipped); those take effect after a restart.
func (p *Platform) ReloadOptions(opts map[string]any) []string {
	lead, _ := opts["team_lead_bot"].(string)
	all, _ := opts["group_reply_all"].(bool)
	p.liveMu.Lock()
	p.teamLead = strings.TrimSpace(lead)
	p.groupReplyAll = all
	p.liveMu.Unlock()

	var restart []string
	seen := map[string]bool{}
	for _, m := range []map[string]any{p.startOpts, opts} {
		for k := range m {
			if seen[k] || k == "team_lead_bot" || k == "group_reply_all" || strings.HasPrefix(k, "cc_") {
				continue
			}
			seen[k] = true
			a, inStart := p.startOpts[k]
			b, inNew := opts[k]
			if inStart != inNew || fmt.Sprint(a) != fmt.Sprint(b) {
				restart = append(restart, k)
			}
		}
	}
	sort.Strings(restart)
	return restart
}
