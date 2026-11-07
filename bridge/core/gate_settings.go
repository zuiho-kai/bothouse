package core

// The panel's 闸门 page (#217): the setup wizard's steps 4 (谁在什么时候接话) and 5 (jev) as a
// permanent settings page, so a bot's routing can be changed long after setup.
//
// It is a thin front over the wizard's own rules, not a second implementation: the mode writes
// reuse clearWizardGate / localGateURL / isWizardGateURL, the model API card uses the existing
// /setup/jev/test and /setup/jev/save (ApplyJev), and a save reloads the running roles exactly
// like a wizard run does (management.reloadRunning + reloadGateAfterWizard).

import (
	"fmt"
	"net/http"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	gateModeSmart     = "smart"
	gateModeAddressed = "addressed"
	gateModeOff       = "off"
)

// replyAllPlatforms: the platform types whose options decide whether a message that names nobody
// reaches a role at all. core/gate.go only sees what the platform let through, so a bot whose
// group_reply_all is false in fact answers only when called, whatever its gate_url says.
var replyAllPlatforms = map[string]bool{"discord": true, "cloud_web": true, "feishu": true, "lark": true}

// GateBot is one row of the page: what this role does with the gate right now.
type GateBot struct {
	Project      string   `json:"project"`
	Name         string   `json:"name"`
	Mode         string   `json:"mode"`    // smart | addressed | off
	Enabled      bool     `json:"enabled"` // the gate is consulted for this role at all
	GateURL      string   `json:"gate_url"`
	GateFallback string   `json:"gate_fallback"`
	Platforms    []string `json:"platforms"`
	Listens      bool     `json:"listens"` // hears messages that name no one (group_reply_all)
	CustomGate   bool     `json:"custom_gate"`
	Note         string   `json:"note,omitempty"`
}

// GateStatus is the page's gate-service line.
type GateStatus struct {
	Status  string `json:"status"` // running | starting | python_missing | python_too_old | off
	Running bool   `json:"running"`
	Managed bool   `json:"managed"` // this process has a supervisor for this data dir
	Wanted  bool   `json:"wanted"`  // some role or the DSH route uses a gate here
	Addr    string `json:"addr"`
	URL     string `json:"url"`
	Hint    string `json:"hint"`
}

// GateSettingsResp is GET /setup/gate.
type GateSettingsResp struct {
	Gate    GateStatus   `json:"gate"`
	Jev     *GateJevInfo `json:"jev,omitempty"`
	JevHint string       `json:"jev_hint"`
	Mode    string       `json:"mode"` // the three big buttons' current choice; "" = roles differ
	Bots    []GateBot    `json:"bots"`
	Lead    string       `json:"lead"`
	Lang    string       `json:"lang"`
}

// GateJevInfo is the model API in use; the key itself never leaves the server.
type GateJevInfo struct {
	URL    string `json:"url"`
	Model  string `json:"model"`
	HasKey bool   `json:"has_key"`
}

// GateSaveRequest is POST /setup/gate/save: the chosen mode for the roles named in Bots
// (project → 参与闸门). A role left out keeps what it has.
type GateSaveRequest struct {
	Mode     string          `json:"mode"`
	Bots     map[string]bool `json:"bots"`
	Lang     string          `json:"lang"`
	Fallback string          `json:"fallback_name"`
}

// platformTypesOf lists a role's platform types, sorted. An empty type name is not a platform.
func platformTypesOf(p WizardExistingProject) []string {
	out := make([]string, 0, len(p.Platforms))
	for t := range p.Platforms {
		if strings.TrimSpace(t) == "" {
			continue
		}
		out = append(out, t)
	}
	sort.Strings(out)
	return out
}

// botListens: a message that names nobody still reaches this role on some platform. A platform
// without the group_reply_all concept (qq, telegram …) lets everything through, so it counts.
func botListens(p WizardExistingProject) bool {
	for _, t := range platformTypesOf(p) {
		o := p.Platforms[t]
		if !replyAllPlatforms[t] {
			return true
		}
		if v, ok := o["group_reply_all"].(bool); ok && v {
			return true
		}
		if t == "feishu" || t == "lark" {
			if v, ok := o["require_mention"].(bool); ok && !v { // platform/feishu: false means the same as group_reply_all
				return true
			}
		}
		if t == "discord" {
			if g, _ := o["group_reply_all_guilds"].(string); strings.TrimSpace(g) != "" {
				return true
			}
		}
	}
	return false
}

// gateModeOf: what this role does now. No gate_url = off (nothing judges its messages). A gate_url
// plus an explicit choice in conest-setup.json wins; else what the platform boundary allows says it.
func gateModeOf(p WizardExistingProject, st SetupState) string {
	if strings.TrimSpace(p.GateURL) == "" {
		// a single role set up as 仅被点名 gets no gate_url (nothing to route), only the platform
		// boundary: that is addressed, not off.
		if !botListens(p) {
			for _, t := range platformTypesOf(p) {
				if st.GateModes[t] == gateModeAddressed {
					return gateModeAddressed
				}
			}
		}
		return gateModeOff
	}
	for _, t := range platformTypesOf(p) {
		if m := st.GateModes[t]; m == gateModeSmart || m == gateModeAddressed {
			return m
		}
		if t == "lark" && st.GateModes["feishu"] == gateModeAddressed {
			return gateModeAddressed
		}
	}
	if !botListens(p) {
		return gateModeAddressed
	}
	return gateModeSmart
}

// gateBots builds the page's rows from config.toml.
func gateBots(s WizardSnapshot, st SetupState) []GateBot {
	out := make([]GateBot, 0, len(s.Projects))
	for _, p := range s.Projects {
		if len(platformTypesOf(p)) == 0 { // a role with no chat platform yet (added, waiting for one)
			continue
		}
		name := p.DisplayName
		if name == "" {
			name = p.Name
		}
		url := strings.TrimSpace(p.GateURL)
		mode := gateModeOf(p, st)
		b := GateBot{Project: p.Name, Name: name, Mode: mode, Enabled: url != "" || mode == gateModeAddressed,
			GateURL: url, GateFallback: p.GateFallback, Platforms: platformTypesOf(p), Listens: botListens(p),
			CustomGate: url != "" && !isWizardGateURL(url)}
		if b.CustomGate {
			b.Note = "custom gate"
		}
		out = append(out, b)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Project < out[j].Project })
	return out
}

// gateModeSummary: the mode the three big buttons show; "" when the roles disagree.
func gateModeSummary(bots []GateBot) string {
	mode := ""
	for _, b := range bots {
		if !b.Enabled { // 关掉的角色不参与这项判断
			continue
		}
		if mode == "" {
			mode = b.Mode
			continue
		}
		if mode != b.Mode {
			return ""
		}
	}
	if mode == "" { // every role has the gate off
		return gateModeOff
	}
	return mode
}

// gateStatusNow: the service line. wanted = some role or the DSH route uses a gate on this machine.
func gateStatusNow(dataDir string, s WizardSnapshot, lang, fallbackName string) GateStatus {
	want := DSHRouteConfigured()
	for _, p := range s.Projects {
		if UsesLocalGate(p.GateURL) {
			want = true
		}
	}
	out := GateStatus{Addr: localGateAddr(), URL: localGateURL(), Wanted: want,
		Managed: activeGateFor(dataDir) != nil, Running: GateRunning()}
	out.Status = GateStatusOff
	if want {
		out.Status = gateStatusAfterWizard(dataDir)
	}
	out.Hint = GateHint(lang, out.Status, fallbackName)
	return out
}

// leadProjectOf: the role that answers when nobody is named (gate_url without ?bot= is the lead's).
func leadProjectOf(s WizardSnapshot, st SetupState) string {
	for _, name := range []string{st.FallbackRole, st.CloudWebFallback} {
		if name == "" {
			continue
		}
		if _, ok := s.project(name); ok {
			return name
		}
	}
	for _, p := range s.Projects {
		if isWizardGateURL(p.GateURL) && !strings.Contains(p.GateURL, "bot=") {
			return p.Name
		}
	}
	return ""
}

// gateWritesFor: what a mode change writes for one role.
//
//   - smart: make sure the role has the gate and a fallback (reply for the lead, context for the
//     others) and that the platform hands it messages that name nobody — a gate it never sees is
//     no gate. A hand-written gate_url / gate_fallback is kept.
//   - addressed: narrow the platform boundary (group_reply_all off) so only an @-mentioned message
//     arrives. The gate_url is kept: with it the role still gets the gate's per-turn context.
//   - off: drop the wizard's gate_url / gate_fallback; a hand-written gate is left alone.
func gateWritesFor(p WizardExistingProject, mode, lead string) (writes []WizardProjectWrite, note string) {
	isLead := p.Name == lead
	url, fb := strings.TrimSpace(p.GateURL), p.GateFallback
	switch mode {
	case gateModeOff:
		if url == "" {
			return nil, ""
		}
		if !isWizardGateURL(url) {
			return nil, "custom gate kept"
		}
		w := WizardProjectWrite{Name: p.Name, Options: map[string]any{}}
		clearWizardGate(&w, url, fb)
		return []WizardProjectWrite{w}, ""
	case gateModeAddressed:
		for _, t := range platformTypesOf(p) {
			if !replyAllPlatforms[t] {
				continue // qq / telegram / … hand every message over already
			}
			w := WizardProjectWrite{Name: p.Name, PlatformType: t, AllPlatformsOfType: true, Options: map[string]any{}}
			w.Options["group_reply_all"] = false
			if t == "feishu" || t == "lark" {
				w.Options["require_mention"] = true
			}
			if t == "discord" {
				w.Options["group_reply_all_guilds"] = "" // it overrides group_reply_all (platform/discord/live_options.go)
			}
			writes = append(writes, w)
		}
		if url != "" && !isWizardGateURL(url) {
			return writes, "custom gate kept"
		}
		return writes, ""
	}
	// smart
	w := WizardProjectWrite{Name: p.Name, Options: map[string]any{}}
	gate := url
	if gate == "" || isWizardGateURL(gate) {
		gate = localGateURL()
		if !isLead {
			gate += "?bot=" + p.Name
		}
		w.GateURL = &gate
	}
	if fb == "" || (isWizardGateURL(url) && (fb == "reply" || fb == "context")) {
		newFb := "context"
		if isLead {
			newFb = "reply"
		}
		w.GateFallback = &newFb
	}
	writes = append(writes, w)
	for _, t := range platformTypesOf(p) {
		if !replyAllPlatforms[t] {
			continue
		}
		w := WizardProjectWrite{Name: p.Name, PlatformType: t, AllPlatformsOfType: true,
			Options: map[string]any{"group_reply_all": true}}
		if t == "feishu" || t == "lark" {
			w.Options["require_mention"] = false
		}
		if t == "discord" {
			w.Options["group_reply_all_guilds"] = ""
		}
		writes = append(writes, w)
	}
	if url != "" && !isWizardGateURL(url) {
		note = "custom gate kept"
	}
	return writes, note
}

// handleSetupGateSettings (GET /setup/gate): everything the 闸门 page shows.
func (m *ManagementServer) handleSetupGateSettings(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		mgmtError(w, http.StatusMethodNotAllowed, "GET only")
		return
	}
	if m.wizardStore == nil {
		mgmtError(w, http.StatusServiceUnavailable, "wizard not configured")
		return
	}
	lang := r.URL.Query().Get("lang")
	if lang == "" {
		lang = SystemLanguage()
	}
	snap, err := m.wizardStore.Snapshot()
	if err != nil {
		mgmtError(w, http.StatusInternalServerError, err.Error())
		return
	}
	st := LoadSetupState(m.wizardDataDir)
	bots := gateBots(snap, st)
	lead, leadName := leadOf(snap, st, bots)
	out := GateSettingsResp{Gate: gateStatusNow(m.wizardDataDir, snap, lang, leadName), Bots: bots,
		Mode: gateModeSummary(bots), Lead: lead, Lang: lang}
	if j, ok := LoadJevConfig(m.wizardDataDir); ok {
		out.Jev = &GateJevInfo{URL: j.URL, Model: j.Model, HasKey: j.APIKey != ""}
	}
	_, usable := activeJev(m.wizardDataDir)
	out.JevHint = JevHint(lang, usable, HardwarePresent(), leadName)
	mgmtJSON(w, http.StatusOK, out)
}

// leadOf: the lead's project name and the name the user gave it.
func leadOf(s WizardSnapshot, st SetupState, bots []GateBot) (project, shown string) {
	project = leadProjectOf(s, st)
	shown = project
	for _, b := range bots {
		if b.Project == project {
			shown = b.Name
		}
	}
	return project, shown
}

// handleSetupGateSave (POST /setup/gate/save): write the mode and make it take effect now.
func (m *ManagementServer) handleSetupGateSave(w http.ResponseWriter, r *http.Request) {
	var req GateSaveRequest
	if !decodeBody(w, r, &req) {
		return
	}
	mode := strings.ToLower(strings.TrimSpace(req.Mode))
	if mode != gateModeSmart && mode != gateModeAddressed && mode != gateModeOff {
		mgmtError(w, http.StatusBadRequest, "mode must be smart, addressed or off")
		return
	}
	if len(req.Bots) == 0 {
		mgmtError(w, http.StatusBadRequest, "no roles given")
		return
	}
	if m.wizardStore == nil {
		mgmtError(w, http.StatusServiceUnavailable, "wizard not configured")
		return
	}
	st := LoadSetupState(m.wizardDataDir)
	names := sortedBoolKeys(req.Bots)
	modeOf := func(name string) string {
		if req.Bots[name] {
			return mode
		}
		return gateModeOff // 这个角色不参与：等同于关掉它的闸门
	}
	var notes []string
	backup, err := m.wizardStore.ApplyProjects(func(s WizardSnapshot) ([]WizardProjectWrite, error) {
		lead := leadProjectOf(s, st)
		var writes []WizardProjectWrite
		for _, name := range names {
			ex, ok := s.project(name)
			if !ok {
				return nil, fmt.Errorf("no such role: %s", name)
			}
			ws, note := gateWritesFor(ex, modeOf(name), lead)
			if note != "" {
				notes = append(notes, ex.Name+": "+note)
			}
			writes = append(writes, ws...)
		}
		return writes, nil
	})
	if err != nil {
		mgmtError(w, http.StatusBadRequest, err.Error())
		return
	}
	// conest-setup.json: the wizard's own record of each platform's choice, kept in step so a later
	// wizard run starts from what the page set.
	after, err := m.wizardStore.Snapshot()
	if err != nil {
		mgmtError(w, http.StatusInternalServerError, err.Error())
		return
	}
	st.GateModes = setupGateModes(after)
	// GateOff is the wizard's "nobody takes part" flag, read when gate_modes says nothing: set it
	// only when every role really is off, so a later wizard run cannot inherit a stale 关.
	allOff := true
	for _, p := range after.Projects {
		if len(platformTypesOf(p)) > 0 && gateModeOf(p, SetupState{}) != gateModeOff {
			allOff = false
		}
	}
	st.GateOff = allOff
	st.UpdatedAt = time.Now().Format(time.RFC3339)
	if err := writeJSONFile(filepath.Join(m.wizardDataDir, setupStateFile), st, 0o644); err != nil {
		mgmtError(w, http.StatusInternalServerError, err.Error())
		return
	}
	// make it live: the engines re-read gate_url / gate_fallback and their platform options, the
	// supervisor restarts the gate when the set of roles using it changed.
	pending, reloadErr := m.reloadRunning()
	reloadGateAfterWizard(m.wizardDataDir, after)
	bots := gateBots(after, st)
	lead, leadName := leadOf(after, st, bots)
	out := map[string]any{"saved": true, "backup": backup, "mode": mode, "notes": notes,
		"mode_current": gateModeSummary(bots), "bots": bots, "lead": lead,
		"gate": gateStatusNow(m.wizardDataDir, after, req.Lang, leadName)}
	// Only the keys this save wrote can be blamed on it: a reload also reports options that drifted
	// since the process started (a hand-edited base_url, the second platform of one type), and
	// listing those under "restart to take effect" would misattribute them to these three buttons.
	if keys := gateRestartKeys(pending); len(keys) > 0 {
		out["restart_keys"] = keys
	}
	if reloadErr != nil {
		out["reload_error"] = reloadErr.Error()
	}
	mgmtJSON(w, http.StatusOK, out)
}

// gateRestartKeys keeps the "<project>: <platform>.<option>" entries for options this page writes.
// Everything else a reload reports (base_url, ws_url, a role's model …) is unrelated to a mode change.
func gateRestartKeys(pending []string) []string {
	var out []string
	for _, k := range pending {
		for _, opt := range []string{"group_reply_all", "require_mention", "group_reply_all_guilds"} {
			if strings.HasSuffix(k, "."+opt) {
				out = append(out, k)
				break
			}
		}
	}
	return out
}

// setupGateModes rebuilds conest-setup.json's gate_modes from what config.toml now says. A mode is
// a per-platform knob (the wizard's own keying: GateModes[platform]), and this page can turn one
// role off while another on the same platform stays on — so the record is written only when every
// role of that type agrees, and dropped (智能判断 = the default) when they do not. Recording a
// single 关 for the whole platform would make the next wizard run silently keep the others off.
func setupGateModes(s WizardSnapshot) map[string]string {
	byType := map[string][]string{}
	for _, p := range s.Projects {
		// read the mode from what config.toml says now, not from the record being rebuilt
		m := gateModeOf(p, SetupState{})
		for _, t := range platformTypesOf(p) {
			key := t
			if t == "lark" {
				key = "feishu" // the wizard keys lark under feishu (setup_wizard.go planWizard)
			}
			byType[key] = append(byType[key], m)
		}
	}
	out := map[string]string{}
	for key, modes := range byType {
		same := modes[0]
		for _, m := range modes[1:] {
			if m != same {
				same = ""
				break
			}
		}
		if same == gateModeAddressed || same == gateModeOff {
			out[key] = same
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
func sortedBoolKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// handleSetupGateStart (POST /setup/gate/start): 一键启动 for the page's status line. It never
// starts a second gate: an answering one is reported as such, and a missing prerequisite comes
// back as its reason (python_missing / python_too_old) instead of a vague failure.
func (m *ManagementServer) handleSetupGateStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		mgmtError(w, http.StatusMethodNotAllowed, "POST only")
		return
	}
	out := map[string]any{"running": GateRunning()}
	if out["running"].(bool) {
		out["started"], out["reason"] = true, ""
		mgmtJSON(w, http.StatusOK, out)
		return
	}
	if _, reason := GatePrereq(m.wizardDataDir); reason != "" {
		out["started"], out["reason"] = false, reason
		mgmtJSON(w, http.StatusOK, out)
		return
	}
	g := activeGateFor(m.wizardDataDir)
	if g == nil {
		// no supervisor in this process (a CLI run, or a service that did not start one)
		out["started"], out["reason"] = false, "not_managed"
		mgmtJSON(w, http.StatusOK, out)
		return
	}
	g.Want()
	deadline := time.Now().Add(gateStartWait)
	for time.Now().Before(deadline) { // 起来要读 gate-team.json、导入 scorer
		if GateRunning() {
			out["running"], out["started"] = true, true
			mgmtJSON(w, http.StatusOK, out)
			return
		}
		time.Sleep(gateStartPoll)
	}
	out["started"], out["reason"] = false, GateStatusStarting
	mgmtJSON(w, http.StatusOK, out)
}

// How long 一键启动 waits for the gate to answer before saying "starting" (it keeps trying in the
// background). 来源：gatePythonCheck + gate.py 导入 scorer 在本机实测不到 1s，留 4 倍余量。
var (
	gateStartWait = 4 * time.Second
	gateStartPoll = 200 * time.Millisecond
)
