package core

import (
	"encoding/json"
	"testing"
)

// dshStateFromJSON parses a /collab/api/state body the way dshAPI.get does, so the test reads the
// same shape the running `dsh web` sends (json field names, nulls, extra presence fields).
func dshStateFromJSON(t *testing.T, body string) dshState {
	t.Helper()
	var st dshState
	if err := json.Unmarshal([]byte(body), &st); err != nil {
		t.Fatalf("decode state: %v", err)
	}
	return st
}

// TestDSHStateRolesKeepsBotsDropsHuman: the deployed hub has no kind "dsh" members at all — the
// panel's roles are "bot" members (agents that registered into DSH) plus the "human" owner. Every
// agent must reach the page; the owner must not.
func TestDSHStateRolesKeepsBotsDropsHuman(t *testing.T) {
	// Trimmed from this machine's live /collab/api/state (owner + 5 bots, one of them busy),
	// minus fields unrelated to the roles page.
	const live = `{
	  "me": "owner", "lead_id": "deep", "effective_lead_id": "deep",
	  "rooms": [{"id": 1, "name": "general", "kind": "chat"}],
	  "members": [
	    {"id": "owner", "name": "我", "kind": "human", "online": true},
	    {"id": "cjiang", "name": "C酱", "kind": "bot", "rooms": [], "online": true, "busy": false, "busy_task": "", "busy_chat": null},
	    {"id": "gge", "name": "G哥", "kind": "bot", "rooms": [], "online": true, "busy": false, "busy_task": "", "busy_chat": null},
	    {"id": "deep", "name": "肥鱼", "kind": "bot", "rooms": [], "online": true, "busy": true, "busy_task": "⏰ 161-4", "busy_chat": "drame"},
	    {"id": "gone", "name": "离线成员", "kind": "bot", "rooms": [], "online": false},
	    {"id": "ds", "name": "DSH 成员", "kind": "dsh", "online": true, "model": "deepseek-v4.1", "cli": "codex"},
	    {"id": "", "name": "无 id", "kind": "bot", "online": true}
	  ],
	  "thinking": {"1": ["deep"]}
	}`

	roles := dshStateRoles(func() *dshState { st := dshStateFromJSON(t, live); return &st }())
	got := map[string]RoleInfo{}
	for _, r := range roles {
		got[r.Name] = r
	}
	if len(roles) != 5 {
		t.Fatalf("roles = %d (%v), want 5: every agent member, no owner, no empty id", len(roles), names(roles))
	}
	for _, id := range []string{"cjiang", "gge", "deep", "gone", "ds"} {
		if _, ok := got["dsh:"+id]; !ok {
			t.Errorf("member %q missing from roles %v", id, names(roles))
		}
	}
	if _, ok := got["dsh:owner"]; ok {
		t.Errorf("owner (kind human) must not be a role: %v", names(roles))
	}
	if _, ok := got["dsh:"]; ok {
		t.Errorf("member without id must be skipped: %v", names(roles))
	}

	// Fields the page prints: bot rows are agents like any other, so online/busy come through
	// and the backend label is the member kind, not a made-up model.
	deep := got["dsh:deep"]
	if deep.DisplayName != "肥鱼" || !deep.Online || !deep.Busy {
		t.Errorf("deep = %+v, want display 肥鱼, online and busy", deep)
	}
	if deep.CurrentTask != "⏰ 161-4" {
		t.Errorf("deep.CurrentTask = %q, want the busy_task", deep.CurrentTask)
	}
	if deep.AgentType != "dsh" || deep.Model != "" || deep.Source != "dsh" {
		t.Errorf("deep = %+v, want agent_type dsh (the row is DSH's view), no invented model, source dsh", deep)
	}
	if off := got["dsh:gone"]; off.Online || off.Busy || off.CurrentTask != "空闲" {
		t.Errorf("offline member = %+v, want offline and idle", off)
	}
	// kind "dsh" keeps its own model and CLI: the behaviour that existed before this fix.
	if ds := got["dsh:ds"]; ds.AgentType != "codex" || ds.Model != "deepseek-v4.1" {
		t.Errorf("dsh member = %+v, want agent_type codex and model deepseek-v4.1", ds)
	}
	// Sorted by display name, so the page order does not follow DSH's member order.
	for i := 1; i < len(roles); i++ {
		if roles[i-1].DisplayName > roles[i].DisplayName {
			t.Errorf("roles not sorted by display name: %v", names(roles))
			break
		}
	}
}

// TestDSHStateRolesEmptyState: a hub with only the owner (fresh install) yields no rows, not nil.
func TestDSHStateRolesEmptyState(t *testing.T) {
	st := dshStateFromJSON(t, `{"members":[{"id":"owner","name":"我","kind":"human","online":true}]}`)
	roles := dshStateRoles(&st)
	if len(roles) != 0 {
		t.Fatalf("roles = %v, want none", names(roles))
	}
	if roles == nil {
		t.Fatal("roles = nil, want an empty slice (the page renders it as no DSH rows)")
	}
}

func names(roles []RoleInfo) []string {
	out := make([]string, len(roles))
	for i, r := range roles {
		out[i] = r.Name
	}
	return out
}
