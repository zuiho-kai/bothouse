package feishu

import (
	"fmt"
	"sort"

	"github.com/chenhg5/cc-connect/core"
)

// maomao fork: options a running Feishu bot takes from a reloaded config.toml, as on Discord
// (platform/discord/live_options.go): allow_bots and team_lead_bot, the two the setup wizard
// rewrites on the roles already running when a role is added. They apply from the next message.

var _ core.OptionsReloader = (*Platform)(nil)

// lead returns the configured team_lead_bot; ReloadOptions may change it while running.
func (p *Platform) lead() string {
	p.liveMu.RLock()
	defer p.liveMu.RUnlock()
	return p.teamLead
}

func (p *Platform) allowBotsCSV() string {
	p.liveMu.RLock()
	defer p.liveMu.RUnlock()
	return p.allowBots
}

// ReloadOptions implements core.OptionsReloader. It returns every other key whose value differs
// from what this bot was started with: those still need a restart.
func (p *Platform) ReloadOptions(opts map[string]any) []string {
	allow, _ := opts["allow_bots"].(string)
	lead, _ := opts["team_lead_bot"].(string)
	p.liveMu.Lock()
	defer p.liveMu.Unlock()
	p.allowBots, p.teamLead = allow, lead
	var restart []string
	seen := map[string]bool{"allow_bots": true, "team_lead_bot": true}
	for _, m := range []map[string]any{p.startOpts, opts} {
		for k := range m {
			if seen[k] {
				continue
			}
			seen[k] = true
			if fmt.Sprint(p.startOpts[k]) != fmt.Sprint(opts[k]) {
				restart = append(restart, k)
			}
		}
	}
	sort.Strings(restart)
	return restart
}
