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

func copyOpts(opts map[string]any) map[string]any {
	out := make(map[string]any, len(opts))
	for k, v := range opts {
		out[k] = v
	}
	return out
}

// ReloadOptions applies team_lead_bot from a reloaded config.toml while running: adding a role in
// the setup wizard names the lead on the roles already running (core/setup_wizard.go
// cloudWebTeamWrites). It returns every other option that differs from what the bot started with
// (keys injected by cc-connect, "cc_*", are skipped); those take effect after a restart.
func (p *Platform) ReloadOptions(opts map[string]any) []string {
	lead, _ := opts["team_lead_bot"].(string)
	p.liveMu.Lock()
	p.teamLead = strings.TrimSpace(lead)
	p.liveMu.Unlock()

	var restart []string
	seen := map[string]bool{}
	for _, m := range []map[string]any{p.startOpts, opts} {
		for k := range m {
			if seen[k] || k == "team_lead_bot" || strings.HasPrefix(k, "cc_") {
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
