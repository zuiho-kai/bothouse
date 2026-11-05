package core

import "testing"

// #159: DSH's cloud_web team roles (kind "bot") count on the panel, except one this panel
// already lists as a local bridge role.
func TestDSHStateRolesIncludesBotsNotLocal(t *testing.T) {
	st := &dshState{Members: []dshStateMember{
		{ID: "owner", Name: "主人", Kind: "human", Online: true},
		{ID: "helper", Name: "助手", Kind: "dsh", Online: true},
		{ID: "cjiang", Name: "C酱", Kind: "bot", Online: true},
		{ID: "gge", Name: "G哥", Kind: "bot", Online: true},
		{ID: "ju", Name: "橘", Kind: "bot", Online: false},
		{ID: "local-proj", Name: "别名", Kind: "bot", Online: true}, // same project as a local role
		{ID: "other-id", Name: "大豆包", Kind: "bot", Online: true},  // same display name as a local role
		{ID: "", Name: "无 ID", Kind: "bot"},
	}}
	local := []RoleInfo{
		{Name: "local-proj", DisplayName: "本机角色"},
		{Name: "doubao", DisplayName: "大豆包"},
	}
	got := map[string]RoleInfo{}
	for _, r := range dshStateRoles(st, local) {
		got[r.Name] = r
	}
	want := []string{"dsh:helper", "dsh:cjiang", "dsh:gge", "dsh:ju"}
	if len(got) != len(want) {
		t.Fatalf("roles = %v, want %v", got, want)
	}
	for _, n := range want {
		r, ok := got[n]
		if !ok {
			t.Fatalf("missing %s in %v", n, got)
		}
		if r.Source != "dsh" {
			t.Errorf("%s source = %q, want dsh (read-only on the page)", n, r.Source)
		}
	}
	if got["dsh:cjiang"].DisplayName != "C酱" || !got["dsh:cjiang"].Online || got["dsh:ju"].Online {
		t.Errorf("bot fields wrong: %+v %+v", got["dsh:cjiang"], got["dsh:ju"])
	}
	if got["dsh:cjiang"].Model != "" {
		t.Errorf("bot model = %q, want empty (DSH does not know it)", got["dsh:cjiang"].Model)
	}
	if got["dsh:helper"].Model != "DSH 默认" {
		t.Errorf("dsh member model = %q, want DSH 默认", got["dsh:helper"].Model)
	}
}

// With no local roles (a DSH-only panel), every bot counts.
func TestDSHStateRolesNoLocal(t *testing.T) {
	st := &dshState{Members: []dshStateMember{
		{ID: "a", Name: "A", Kind: "bot"}, {ID: "b", Name: "B", Kind: "bot"}, {ID: "c", Name: "C", Kind: "bot"},
		{ID: "d", Name: "D", Kind: "bot"}, {ID: "e", Name: "E", Kind: "bot"},
	}}
	if n := len(dshStateRoles(st, nil)); n != 5 {
		t.Fatalf("got %d roles, want 5", n)
	}
}
