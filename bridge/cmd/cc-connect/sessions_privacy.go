package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	"github.com/chenhg5/cc-connect/config"
	"github.com/chenhg5/cc-connect/core"
)

// Private chats stay with their own role (#1068). A role reading `bothouse sessions`
// (CC_PROJECT set by the bridge) sees every public channel, its own private chats, and no
// other role's private chats. The primary role (lead.json, else the configured lead) is the
// team's administrator and still sees everything. A person at the terminal (no CC_PROJECT)
// owns the data directory and sees everything too.

// sessionsViewer is the role asking, or "" for a person at the terminal.
func sessionsViewer() string {
	return strings.TrimSpace(os.Getenv("CC_PROJECT"))
}

// visibleSessions drops other roles' private chats for viewer. Order is kept, so the #N
// indexes of `list` and `show` agree for the same viewer.
func visibleSessions(dataDir string, records []sessionRecord) []sessionRecord {
	viewer := sessionsViewer()
	if viewer == "" || viewer == sessionsLeadProject(dataDir) {
		return records
	}
	private := privateChats(records)
	out := make([]sessionRecord, 0, len(records))
	for _, r := range records {
		if matchesProject(r.Project+".json", viewer) || !private[recordChatKey(r)] {
			out = append(out, r)
		}
	}
	return out
}

// recordChatKey is the channel a session belongs to: "platform:chat". A relay session
// ("relay:<from>:<platform>:<chat>[:...]") belongs to the channel it relays in.
func recordChatKey(r sessionRecord) string {
	key := r.Platform
	if r.GroupUser != "" {
		key += ":" + r.GroupUser
	}
	if strings.HasPrefix(key, "relay:") {
		if parts := strings.SplitN(key, ":", 3); len(parts) == 3 {
			key = parts[2]
		}
	}
	parts := strings.SplitN(key, ":", 3)
	if len(parts) >= 2 {
		return parts[0] + ":" + parts[1]
	}
	return key
}

// privateChats marks channels that are private chats. A channel is public when any role
// has recorded a real name for it: a private chat has none, so the platform stores an empty
// name or falls back to the channel id (Discord ResolveChannelName; same rule as
// core.teamEntryIsDM). A channel any role saw a direct message in is private regardless.
// Unknown counts as private, so a channel with no name anywhere is hidden from other roles.
func privateChats(records []sessionRecord) map[string]bool {
	named := map[string]bool{}
	direct := map[string]bool{}
	for _, r := range records {
		chat := recordChatKey(r)
		if r.Direct {
			direct[chat] = true
		}
		if strings.HasPrefix(r.Platform, "relay") {
			continue // relay sessions carry no channel name of their own
		}
		name := strings.TrimSpace(r.ChatName)
		_, id, _ := strings.Cut(chat, ":")
		if name != "" && name != id {
			named[chat] = true
		}
	}
	out := map[string]bool{}
	for _, r := range records {
		chat := recordChatKey(r)
		if direct[chat] || !named[chat] {
			out[chat] = true
		}
	}
	return out
}

// sessionsLeadProject is the team's primary role: lead.json when it names a configured
// role (by project or team name), else the configured lead. "" when there is none.
func sessionsLeadProject(dataDir string) string {
	var projs []config.ProjectConfig
	if cfg, err := config.Load(resolveConfigPath("")); err == nil {
		projs = cfg.Projects
	}
	if b, err := os.ReadFile(filepath.Join(dataDir, "lead.json")); err == nil {
		var sel struct {
			Lead string `json:"lead"`
			Name string `json:"name"`
		}
		if json.Unmarshal(b, &sel) == nil {
			lead, name := strings.TrimSpace(sel.Lead), strings.TrimSpace(sel.Name)
			if len(projs) == 0 && lead != "" {
				return lead // no config to check against: trust the selection, as the engine does
			}
			for _, c := range configuredLeadCandidates(dataDir, projs) {
				if lead != "" && c.Project == lead {
					return c.Project
				}
			}
			for _, c := range configuredLeadCandidates(dataDir, projs) {
				if name != "" && c.Name == name {
					return c.Project
				}
			}
		}
	}
	var lead core.LeadCandidate
	found := 0
	for _, c := range configuredLeadCandidates(dataDir, projs) {
		if c.Lead {
			lead = c
			found++
		}
	}
	if found == 1 {
		return lead.Project
	}
	return ""
}
