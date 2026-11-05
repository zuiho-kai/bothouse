package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestVisibleSessionsHidesOtherRolesPrivateChats(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir) // no config.toml: lead comes from lead.json only
	t.Setenv("BOTHOUSE_DATA_DIR", dir)
	t.Setenv("CC_DATA_DIR", dir)
	if err := os.WriteFile(filepath.Join(dir, "lead.json"), []byte(`{"lead":"boss"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	recs := []sessionRecord{
		{Project: "jingyu_f2414637", Platform: "discord", GroupUser: "111", ChatName: "111"}, // jingyu DM (name = id)
		{Project: "jingyu_f2414637", Platform: "discord", GroupUser: "222", ChatName: "后宅"},  // public
		{Project: "boss_9f6042dd", Platform: "discord", GroupUser: "333"},                    // boss DM (no name)
		{Project: "boss_9f6042dd", Platform: "discord", GroupUser: "444"},                    // public: named by another role
		{Project: "longniang_4efeeb1c", Platform: "discord", GroupUser: "444", ChatName: "工作区8"},
		{Project: "longniang_4efeeb1c", Platform: "discord", GroupUser: "555"},                          // own DM
		{Project: "grok_2c3410cb", Platform: "discord", GroupUser: "666", ChatName: "某人", Direct: true}, // flagged DM with a name
		{Project: "boss_9f6042dd", Platform: "relay", GroupUser: "jingyu:discord:222"},                  // relay in public channel
		{Project: "boss_9f6042dd", Platform: "relay", GroupUser: "jingyu:discord:111"},                  // relay in a DM
	}
	t.Setenv("CC_PROJECT", "longniang")
	got := visibleSessions(dir, recs)
	want := map[string]bool{"222": true, "444": true, "555": true, "jingyu:discord:222": true}
	if len(got) != len(want)+1 { // 444 appears twice
		t.Fatalf("longniang sees %d sessions, want %d: %+v", len(got), len(want)+1, got)
	}
	for _, r := range got {
		if !want[r.GroupUser] {
			t.Errorf("longniang should not see %s/%s", r.Project, r.GroupUser)
		}
	}
	t.Setenv("CC_PROJECT", "boss")
	if n := len(visibleSessions(dir, recs)); n != len(recs) {
		t.Errorf("lead sees %d, want all %d", n, len(recs))
	}
	t.Setenv("CC_PROJECT", "")
	if n := len(visibleSessions(dir, recs)); n != len(recs) {
		t.Errorf("terminal sees %d, want all %d", n, len(recs))
	}
}
