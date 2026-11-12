package core

import (
	"testing"
	"time"
)

// #1492 L13: a quota takeover gives the watched work a new owner. The new owner's watch starts
// afresh: the old owner's park failures, auto-resume and unread checks are not carried over
// (AutoResumed carried over made the new owner's first no-progress check park at once).
func TestQuotaTakeoverResetsWatchCounts(t *testing.T) {
	dir := t.TempDir()
	src := NewEngine("orange", &stubAgent{}, nil, "", LangChinese)
	t.Cleanup(src.cancel)
	src.dataDir = dir
	dst := NewEngine("longniang", &stubAgent{}, nil, "", LangChinese)
	t.Cleanup(dst.cancel)
	dst.dataDir = dir
	at := time.Now().Add(-time.Hour)
	teamWorkspaceStore.mu.Lock()
	st := testLoadTeamWorkspacesLocked(teamWorkspacePath(dir))
	st.Handoffs = map[string][]TeamHandoff{"discord:ws": {{Chat: "discord:chat", At: at, Owner: "orange", Title: "修复",
		ParkFails: 2, AutoResumed: true, Renewed: 3, Nudged: true}}}
	err := saveTeamWorkspacesLocked(teamWorkspacePath(dir), st)
	teamWorkspaceStore.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	if err := src.applyQuotaWork(quotaWork{Session: "discord:ws", At: at}, dst, time.Now()); err != nil {
		t.Fatal(err)
	}
	teamWorkspaceStore.mu.Lock()
	h := testLoadTeamWorkspacesLocked(teamWorkspacePath(dir)).Handoffs["discord:ws"][0]
	teamWorkspaceStore.mu.Unlock()
	if h.Owner != "longniang" {
		t.Fatalf("owner = %q, want longniang", h.Owner)
	}
	if h.ParkFails != 0 || h.AutoResumed {
		t.Fatalf("old owner's counts carried to the new owner: park_fails=%d auto_resumed=%v", h.ParkFails, h.AutoResumed)
	}
}
