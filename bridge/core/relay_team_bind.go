package core

// Wizard team relay bindings (#597 G2'). Roles the setup wizard put in one team
// (<data_dir>/conest-setup.json) may relay to each other in any chat of that team's
// platform without a manual /bind. Projects outside the team still need /bind.
//
//	conest-setup.json ──(mtime cache)──▶ wizardTeam(platform) ─┐
//	relay_bindings.json (manual /bind) ──────────────────────────┼─▶ effectiveBindingLocked
//	relay_team_denied.json (/bind -x, /bind remove) ────────────┘    (Send, ResolveTaskReporter,
//	                                                                  voiceTarget, GET /relay/binding)
//
// Teams are split by platform: SetupState.Team serves the platform recorded in
// state.Platform (Discord, or Feishu / Lark), CloudWebTeam serves cloud_web (DSH and the
// self-hosted web). Members match by SetupTeamEntry.Project, so two roles on the same model
// stay two members. Only teams of two or more roles count. A removal is an explicit veto:
// the team never adds that project back in that chat until it is /bind'ed again.

import (
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"time"
)

const relayDeniedAll = "*"

type relayTeamCache struct {
	mod   time.Time
	size  int64
	read  bool
	state SetupState
}

// setupState is conest-setup.json, re-read only when its mtime or size changes. It does
// not take rm.mu, so callers may hold it.
func (rm *RelayManager) setupState() SetupState {
	if rm.dataDir == "" {
		return SetupState{}
	}
	rm.teamMu.Lock()
	defer rm.teamMu.Unlock()
	fi, err := os.Stat(filepath.Join(rm.dataDir, setupStateFile))
	if err != nil {
		rm.team = relayTeamCache{}
		return SetupState{}
	}
	if !rm.team.read || !fi.ModTime().Equal(rm.team.mod) || fi.Size() != rm.team.size {
		rm.team = relayTeamCache{mod: fi.ModTime(), size: fi.Size(), read: true, state: LoadSetupState(rm.dataDir)}
	}
	return rm.team.state
}

// relayTeamProjects: the projects of a wizard team, nil unless it has two or more.
func relayTeamProjects(members []SetupTeamEntry) []string {
	var out []string
	for _, m := range members {
		if m.Project != "" {
			out = append(out, m.Project)
		}
	}
	if len(out) < 2 {
		return nil
	}
	return out
}

// wizardTeam returns the projects of the wizard team serving platform (nil when none or
// fewer than two): CloudWebTeam for cloud_web, Team for the platform state.Platform names.
func (rm *RelayManager) wizardTeam(platform string) []string {
	if platform == "" {
		return nil
	}
	s := rm.setupState()
	switch {
	case platform == "cloud_web":
		return relayTeamProjects(s.CloudWebTeam)
	case platform == "discord" && s.Platform == "discord",
		isFeishuPlatform(platform) && isFeishuPlatform(s.Platform):
		return relayTeamProjects(s.Team)
	}
	return nil
}

// inAnyWizardTeam: project is a member of a wizard team (of two or more) on any platform.
func (rm *RelayManager) inAnyWizardTeam(project string) bool {
	s := rm.setupState()
	for _, team := range [][]SetupTeamEntry{s.Team, s.CloudWebTeam} {
		for _, p := range relayTeamProjects(team) {
			if p == project {
				return true
			}
		}
	}
	return false
}

// effectiveBindingLocked is the chat's manual binding plus the wizard team of platform,
// minus vetoed projects. Callers hold rm.mu. The result is a copy when the team adds to it.
func (rm *RelayManager) effectiveBindingLocked(platform, chatID string) *RelayBinding {
	b := rm.bindings[chatID]
	denied := rm.denied[chatID]
	if denied[relayDeniedAll] || (b != nil && b.Platform != platform) {
		return b
	}
	team := rm.wizardTeam(platform)
	if len(team) == 0 {
		return b
	}
	out := &RelayBinding{Platform: platform, ChatID: chatID, Bots: make(map[string]string)}
	if b != nil {
		for k, v := range b.Bots {
			out.Bots[k] = v
		}
	}
	added := false
	for _, p := range team {
		if _, ok := out.Bots[p]; !ok && !denied[p] {
			out.Bots[p] = p
			added = true
		}
	}
	if !added {
		return b
	}
	return out
}

// EffectiveBinding is the binding relay uses in chatID on platform (manual /bind plus the
// wizard team), or nil.
func (rm *RelayManager) EffectiveBinding(platform, chatID string) *RelayBinding {
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	return rm.effectiveBindingLocked(platform, chatID)
}

// denyLocked records an explicit removal; allowLocked lifts it. Callers hold rm.mu (write).
func (rm *RelayManager) denyLocked(chatID, project string) {
	if rm.denied[chatID] == nil {
		rm.denied[chatID] = make(map[string]bool)
	}
	rm.denied[chatID][project] = true
	rm.saveDeniedLocked()
}

func (rm *RelayManager) allowLocked(chatID, project string) {
	if !rm.denied[chatID][project] {
		return
	}
	delete(rm.denied[chatID], project)
	if len(rm.denied[chatID]) == 0 {
		delete(rm.denied, chatID)
	}
	rm.saveDeniedLocked()
}

func (rm *RelayManager) saveDeniedLocked() {
	if rm.deniedPath == "" {
		return
	}
	data, err := json.MarshalIndent(rm.denied, "", "  ")
	if err != nil {
		return
	}
	if err := os.MkdirAll(filepath.Dir(rm.deniedPath), 0o755); err != nil {
		slog.Error("relay: failed to create dir", "error", err)
		return
	}
	if err := AtomicWriteFile(rm.deniedPath, data, 0o644); err != nil {
		slog.Error("relay: failed to write team vetoes", "path", rm.deniedPath, "error", err)
	}
}

func (rm *RelayManager) loadDenied() {
	if rm.deniedPath == "" {
		return
	}
	data, err := os.ReadFile(rm.deniedPath)
	if err != nil {
		if !os.IsNotExist(err) {
			slog.Error("relay: failed to read team vetoes", "path", rm.deniedPath, "error", err)
		}
		return
	}
	var denied map[string]map[string]bool
	if err := json.Unmarshal(data, &denied); err != nil {
		slog.Error("relay: failed to unmarshal team vetoes", "path", rm.deniedPath, "error", err)
		return
	}
	if denied != nil {
		rm.denied = denied
	}
}
