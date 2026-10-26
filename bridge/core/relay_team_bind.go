package core

// Team relay bindings (#597 G2', #462). Roles explicitly configured as one team may
// relay to each other in any chat of that team's platform without a manual /bind.
// Projects outside the team still need /bind.
//
// A team has two explicit durable sources:
//   - conest-setup.json (the setup wizard; mtime cache). Its entries also cover members
//     that are not engines in this process (for example DSH members on cloud_web).
//   - config.toml: projects sharing the same non-empty team_status_dir on the same
//     platform. This is the layout of teams created before conest-setup.json existed,
//     and WizardTeamDefaults uses the same field for wizard teams.
//
//	conest-setup.json ──(mtime cache)──▶ wizardTeam(platform) ─┐
//	config.toml team_status_dir ────────▶ configuredTeam        ├─▶ teamProjects
//	relay_bindings.json (manual /bind) ─────────────────────────┼─▶ effectiveBindingForLocked
//	relay_team_denied.json (/bind -x, /bind remove) ────────────┘    (Send, ResolveTaskReporter,
//	                                                                  voiceTarget, GET /relay/binding)
//
// Teams are split by platform. SetupState.Team serves the platform recorded in
// state.Platform (Discord, or Feishu / Lark), CloudWebTeam serves cloud_web (DSH and the
// self-hosted web); configured teams are split by the platforms each engine serves.
// Members match by project name, so two roles on the same model stay two members. Only
// teams of two or more roles count. A project with no team_status_dir and no wizard entry
// stays manual (#462: all projects in one config are not silently made a team).
// A removal is an explicit veto: the team never adds that project back in that chat until
// it is /bind'ed again.

import (
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
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

// teamStatusDir is the shared team directory this engine was configured with
// (team_status_dir, or the wizard default). "" means this project is not in a team.
func (e *Engine) teamStatusDir() string {
	if e == nil || e.team == nil {
		return ""
	}
	return filepath.Clean(e.team.dir)
}

// servesPlatform reports whether this engine has a platform with that name. It is the
// "already connected on this platform" half of #462's requirement: a team member on
// another platform is not made available here; /bind cannot cross platforms either.
func (e *Engine) servesPlatform(name string) bool {
	if e == nil || name == "" {
		return false
	}
	for _, p := range e.platforms {
		if p != nil && p.Name() == name {
			return true
		}
	}
	return false
}

func mergeProjects(a, b []string) []string {
	out := make([]string, 0, len(a)+len(b))
	seen := make(map[string]bool, len(a)+len(b))
	for _, list := range [][]string{a, b} {
		for _, p := range list {
			if p == "" || seen[p] {
				continue
			}
			seen[p] = true
			out = append(out, p)
		}
	}
	sort.Strings(out)
	return out
}

// configuredTeam returns the projects sharing a non-empty team_status_dir with from on
// platform (nil when fewer than two). It is the config.toml source: an old team that
// never ran the wizard still has the same team_status_dir on every member. With no from
// (a display lookup) it only answers when exactly one team dir is configured on the
// platform, so two separate teams are never merged into one.
func (rm *RelayManager) configuredTeam(platform, from string) []string {
	if platform == "" {
		return nil
	}
	dir := ""
	if from != "" {
		if e := rm.engines[from]; e != nil {
			dir = e.teamStatusDir()
		}
	} else {
		dirs := map[string]struct{}{}
		for _, e := range rm.engines {
			if e == nil || !e.servesPlatform(platform) {
				continue
			}
			if d := e.teamStatusDir(); d != "" {
				dirs[d] = struct{}{}
			}
		}
		if len(dirs) == 1 {
			for d := range dirs {
				dir = d
			}
		}
	}
	if dir == "" {
		return nil
	}
	var out []string
	for name, e := range rm.engines {
		if e == nil || e.teamStatusDir() != dir || !e.servesPlatform(platform) {
			continue
		}
		out = append(out, name)
	}
	if len(out) < 2 {
		return nil
	}
	sort.Strings(out)
	return out
}

// inAnyTeam: project is a member of an explicit team (wizard or shared team_status_dir)
// of two or more roles on any platform.
func (rm *RelayManager) inAnyTeam(project string) bool {
	if rm.inAnyWizardTeam(project) {
		return true
	}
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	e := rm.engines[project]
	if e == nil {
		return false
	}
	dir := e.teamStatusDir()
	if dir == "" {
		return false
	}
	for name, other := range rm.engines {
		if name != project && other != nil && other.teamStatusDir() == dir {
			return true
		}
	}
	return false
}

// teamProjects is the team serving this chat for the sender from: the wizard team of the
// platform when from belongs to it, plus the configured team sharing from's team_status_dir.
// A chat gets one team only; projects outside it still need /bind.
func (rm *RelayManager) teamProjects(platform, from string) []string {
	wizard := rm.wizardTeam(platform)
	configured := rm.configuredTeam(platform, from)
	if len(configured) >= 2 {
		if len(wizard) == 0 {
			return configured
		}
		return mergeProjects(configured, wizard)
	}
	if len(wizard) >= 2 {
		return wizard
	}
	return nil
}

// effectiveBindingForLocked is the chat's manual binding plus the team serving platform for
// from, minus vetoed projects. Callers hold rm.mu. The result is a copy when the team adds
// to it. from is the sending project: teams are per project, so two different teams on the
// same platform stay isolated.
func (rm *RelayManager) effectiveBindingForLocked(platform, chatID, from string) *RelayBinding {
	b := rm.bindings[chatID]
	denied := rm.denied[chatID]
	if denied[relayDeniedAll] || (b != nil && b.Platform != platform) {
		return b
	}
	team := rm.teamProjects(platform, from)
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

// effectiveBindingLocked is effectiveBindingForLocked without a sender, for displays that
// show the chat's effective binding (the bare /bind command, GET /relay/binding).
func (rm *RelayManager) effectiveBindingLocked(platform, chatID string) *RelayBinding {
	return rm.effectiveBindingForLocked(platform, chatID, "")
}

// EffectiveBinding is the binding relay uses in chatID on platform without a sender
// (manual /bind plus the single configured team of the platform), or nil.
func (rm *RelayManager) EffectiveBinding(platform, chatID string) *RelayBinding {
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	return rm.effectiveBindingLocked(platform, chatID)
}

// EffectiveBindingFor is the binding relay uses in chatID on platform for project project:
// manual /bind plus project's own team. Use this for /bind displays; EffectiveBinding
// stays for callers that have no project context.
func (rm *RelayManager) EffectiveBindingFor(platform, chatID, project string) *RelayBinding {
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	return rm.effectiveBindingForLocked(platform, chatID, project)
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
