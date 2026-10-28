package core

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The panel's "add role/model" entry (append_only): a new role is added next to the ones already
// configured; a name that is already taken is refused instead of updating or renaming.
func TestApplyWizardAppendOnly(t *testing.T) {
	noHardware(t)
	noLocalHub(t)
	hub := fakeHub(t, "bot-secret")
	store := newMemStore()
	store.extra = []string{"juzi"} // a project on another platform
	dir := t.TempDir()
	env := WizardEnv{Store: store, DataDir: dir, CLIs: testCLIs}
	if res := ApplyWizard(context.Background(), env, cloudWebReq(hub.URL, "bot-secret", WizardRole{Name: "a"}, WizardRole{Name: "b"})); !res.Saved {
		t.Fatalf("first run: %+v", res)
	}
	add := func(name string) *WizardResult {
		req := cloudWebReq(hub.URL, "bot-secret", WizardRole{Name: name})
		req.AppendOnly = true
		return ApplyWizard(context.Background(), env, req)
	}
	res := add("c")
	if !res.Saved || res.Roles[0].Project != "c" || res.Roles[0].Reused {
		t.Fatalf("add c: %+v", res)
	}
	if got := strings.Join(store.order, ","); !strings.Contains(got, "a") || !strings.Contains(got, "b") || !strings.Contains(got, "c") {
		t.Fatalf("existing roles lost: %v", store.order)
	}
	for _, dup := range []string{"a", "Juzi"} { // same member, and a name taken on another platform
		n := len(store.order)
		res = add(dup)
		if res.Saved || !strings.Contains(res.Error, "already exists") {
			t.Fatalf("add %s: want refused, got %+v", dup, res)
		}
		if len(store.order) != n {
			t.Fatalf("add %s changed config: %v", dup, store.order)
		}
	}
	// without append_only the same request still updates the existing member (unchanged behaviour)
	if res = ApplyWizard(context.Background(), env, cloudWebReq(hub.URL, "bot-secret", WizardRole{Name: "a"})); !res.Saved || !res.Roles[0].Reused {
		t.Fatalf("plain re-run: %+v", res)
	}
}

// Adding a role keeps the lead: old members' gate_url / gate_fallback / team_lead_bot stay as they
// were, even if the request names the new role as fallback (what an older panel would send).
func TestApplyWizardAppendOnlyKeepsLead(t *testing.T) {
	noHardware(t)
	noLocalHub(t)
	hub := fakeHub(t, "bot-secret")
	store := newMemStore()
	env := WizardEnv{Store: store, DataDir: t.TempDir(), CLIs: testCLIs}
	if res := ApplyWizard(context.Background(), env, cloudWebReq(hub.URL, "bot-secret", WizardRole{Name: "a"}, WizardRole{Name: "b"})); !res.Saved {
		t.Fatalf("first run: %+v", res)
	}
	type snap struct{ gate, fb, lead string }
	take := func(p string) snap {
		w := store.projects[p]
		var s snap
		if w.GateURL != nil {
			s.gate = *w.GateURL
		}
		if w.GateFallback != nil {
			s.fb = *w.GateFallback
		}
		s.lead = fmt.Sprint(w.Options["team_lead_bot"])
		return s
	}
	before := map[string]snap{"a": take("a"), "b": take("b")}
	req := cloudWebReq(hub.URL, "bot-secret", WizardRole{Name: "c"})
	req.AppendOnly, req.FallbackRole = true, "c"
	res := ApplyWizard(context.Background(), env, req)
	if !res.Saved || res.FallbackRole != "a" {
		t.Fatalf("add c: fallback=%q %+v", res.FallbackRole, res)
	}
	for p, want := range before {
		if got := take(p); got != want {
			t.Fatalf("%s changed: before %+v after %+v", p, want, got)
		}
	}
	if c := take("c"); c.lead != before["b"].lead || c.fb == "reply" {
		t.Fatalf("c should join as a sub of a: %+v (b=%+v)", c, before["b"])
	}
}

// Non-ASCII names map to role-N: adding two of them one after another both work (role-1, role-2),
// and a real duplicate is refused under the name the user typed.
func TestApplyWizardAppendOnlyNonASCIINames(t *testing.T) {
	noHardware(t)
	noLocalHub(t)
	hub := fakeHub(t, "bot-secret")
	store := newMemStore()
	env := WizardEnv{Store: store, DataDir: t.TempDir(), CLIs: testCLIs}
	if res := ApplyWizard(context.Background(), env, cloudWebReq(hub.URL, "bot-secret", WizardRole{Name: "a"})); !res.Saved {
		t.Fatalf("first run: %+v", res)
	}
	add := func(name string) *WizardResult {
		req := cloudWebReq(hub.URL, "bot-secret", WizardRole{Name: name})
		req.AppendOnly = true
		return ApplyWizard(context.Background(), env, req)
	}
	seen := map[string]bool{}
	for _, name := range []string{"鲸鱼娘", "彩虹猫"} {
		res := add(name)
		if !res.Saved || res.Roles[0].Reused || seen[res.Roles[0].Project] {
			t.Fatalf("add %s: %+v", name, res)
		}
		seen[res.Roles[0].Project] = true
	}
	res := add("鲸鱼娘")
	if res.Saved || !strings.Contains(res.Error, "鲸鱼娘") || !strings.Contains(res.Error, "already exists") {
		t.Fatalf("duplicate: want refused naming 鲸鱼娘, got %+v", res)
	}
}

// Adding roles under non-ASCII names with different backends: each project keeps the backend the
// user picked, and the name the user typed is what the panel shows (team_name → display_name),
// in the wizard's list of existing roles and in the project list.
func TestApplyWizardAppendOnlyDisplayNameAndBackend(t *testing.T) {
	dshStoredKey(t)
	noHardware(t)
	noLocalHub(t)
	hub := fakeHub(t, "bot-secret")
	store := newMemStore()
	dir := t.TempDir()
	clis := append([]LocalCLI{}, testCLIs...)
	clis = append(clis, LocalCLI{AgentType: "dsh", Supported: true, Login: "logged_in", Path: "/usr/local/bin/dsh", InPath: true})
	env := WizardEnv{Store: store, DataDir: dir, CLIs: clis}
	if res := ApplyWizard(context.Background(), env, cloudWebReq(hub.URL, "bot-secret", WizardRole{Name: "a"})); !res.Saved {
		t.Fatalf("first run: %+v", res)
	}
	want := map[string]string{"鲸鱼娘": "dsh", "彩虹猫": "codex"}
	projectOf := map[string]string{}
	for _, name := range []string{"鲸鱼娘", "彩虹猫"} {
		req := cloudWebReq(hub.URL, "bot-secret", WizardRole{Name: name, AgentType: want[name]})
		req.AppendOnly = true
		res := ApplyWizard(context.Background(), env, req)
		if !res.Saved {
			t.Fatalf("add %s: %+v", name, res)
		}
		projectOf[name] = res.Roles[0].Project
	}
	for name, at := range want {
		p := store.projects[projectOf[name]]
		if p == nil || p.AgentType != at || p.DisplayName != name {
			t.Fatalf("%s → %+v, want agent %s and display name %s", name, p, at, name)
		}
	}
	if p := store.projects["a"]; p.DisplayName != "" { // an ASCII name is its own project name: nothing extra
		t.Fatalf("a got display name %q", p.DisplayName)
	}

	m := NewManagementServer(0, "", nil)
	m.SetWizard(store, dir)
	rec := httptest.NewRecorder()
	m.handleSetupState(rec, httptest.NewRequest(http.MethodGet, "/api/v1/setup/state", nil))
	var st struct {
		Data struct {
			Projects []string `json:"projects"`
			Shown    []string `json:"project_display_names"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &st); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(st.Data.Shown, ","); got != "a,鲸鱼娘,彩虹猫" {
		t.Fatalf("existing roles shown as %q (projects %v)", got, st.Data.Projects)
	}

	// the running service: an engine started from team_name lists the user's name
	for name, p := range projectOf {
		e := NewEngine(p, &stubAgent{}, nil, "", LangEnglish)
		e.sessions = NewSessionManager("")
		e.SetTeam("", name, false) // what main.go does with the project's team_name
		m.RegisterEngine(p, e)
	}
	rec = httptest.NewRecorder()
	m.handleProjects(rec, httptest.NewRequest(http.MethodGet, "/api/v1/projects", nil))
	var list struct {
		Data struct {
			Projects []map[string]any `json:"projects"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	got := map[string]any{}
	for _, p := range list.Data.Projects {
		got[fmt.Sprint(p["name"])] = p["display_name"]
	}
	for name, p := range projectOf {
		if got[p] != name {
			t.Fatalf("project list: %s shows %v, want %s (%v)", p, got[p], name, list.Data.Projects)
		}
	}
}

// The first-run wizard (not append_only) treats a non-ASCII name the same way: the project is
// role-N, team_name keeps the name the user typed, and the project list shows that name.
func TestApplyWizardFirstRunDisplayName(t *testing.T) {
	noHardware(t)
	noLocalHub(t)
	hub := fakeHub(t, "bot-secret")
	store := newMemStore()
	dir := t.TempDir()
	env := WizardEnv{Store: store, DataDir: dir, CLIs: testCLIs}
	res := ApplyWizard(context.Background(), env, cloudWebReq(hub.URL, "bot-secret", WizardRole{Name: "鲸鱼娘"}))
	if !res.Saved || res.Roles[0].Reused {
		t.Fatalf("first run: %+v", res)
	}
	proj := res.Roles[0].Project
	if proj == "鲸鱼娘" {
		t.Fatalf("non-ASCII name used as project name")
	}
	w := store.projects[proj]
	if w == nil || w.DisplayName != "鲸鱼娘" {
		t.Fatalf("%s → %+v, want team_name 鲸鱼娘", proj, w)
	}

	m := NewManagementServer(0, "", nil)
	m.SetWizard(store, dir)
	e := NewEngine(proj, &stubAgent{}, nil, "", LangEnglish)
	e.sessions = NewSessionManager("")
	e.SetTeam("", w.DisplayName, false) // what main.go does with the project's team_name
	m.RegisterEngine(proj, e)
	rec := httptest.NewRecorder()
	m.handleProjects(rec, httptest.NewRequest(http.MethodGet, "/api/v1/projects", nil))
	var list struct {
		Data struct {
			Projects []map[string]any `json:"projects"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if len(list.Data.Projects) != 1 || list.Data.Projects[0]["name"] != proj || list.Data.Projects[0]["display_name"] != "鲸鱼娘" {
		t.Fatalf("project list: %v", list.Data.Projects)
	}
}
