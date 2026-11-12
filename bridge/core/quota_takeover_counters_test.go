package core

import (
	"testing"
	"time"
)

// #1492 常识：换了人，计数从头算。A takeover kept the old owner's AutoResumed and ParkFails, so the
// new owner's first quiet check went straight to park, with no resume.
func TestQuotaTakeoverClearsTheOldOwnersWatchCounters(t *testing.T) {
	dir := t.TempDir()
	source := NewEngine("orange", &stubAgent{}, []Platform{&stubPlatformEngine{n: "discord"}}, "", LangChinese)
	target := NewEngine("longniang", &stubAgent{}, []Platform{&stubPlatformEngine{n: "discord"}}, "", LangChinese)
	source.dataDir, target.dataDir = dir, dir
	t.Cleanup(source.cancel)
	t.Cleanup(target.cancel)
	at := time.Now().Add(-time.Hour)
	h := TeamHandoff{Chat: "discord:chat1", At: at, Owner: "orange", Title: "修复", AutoResumed: true, ParkFails: 2}
	teamWorkspaceStore.mu.Lock()
	err := saveTeamWorkspacesLocked(teamWorkspacePath(dir), &teamWorkspaceState{Version: teamWorkspaceStateVersion,
		Handoffs: map[string][]TeamHandoff{"discord:ws1": {h}}})
	teamWorkspaceStore.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	if err := source.applyQuotaWork(quotaWork{ID: "w", Source: "orange", Session: "discord:ws1", At: at, Title: "修复"}, target, time.Now()); err != nil {
		t.Fatal(err)
	}
	teamWorkspaceStore.mu.Lock()
	st := testLoadTeamWorkspacesLocked(teamWorkspacePath(dir))
	teamWorkspaceStore.mu.Unlock()
	got := st.Handoffs["discord:ws1"][0]
	if got.Owner != "longniang" {
		t.Fatalf("not taken over: %+v", got)
	}
	if got.AutoResumed || got.ParkFails != 0 {
		t.Fatalf("new owner inherited AutoResumed=%v ParkFails=%d", got.AutoResumed, got.ParkFails)
	}
}
