package core

import (
	"testing"
	"time"
)

// #1492 常识：失败了，之前做的要跟着退。A claim the task state refused (the task is closed) was
// rolled back locally, but the platform (cloud_web/DSH gateway) kept the workspace owned by this
// chat, with no local record left to release it.
func TestRefusedClaimReleasesThePlatformClaim(t *testing.T) {
	e, p := newOwnerFixture(t)
	teamWorkspaceStore.mu.Lock()
	_, err := transitionTeamTaskLocked(e.dataDir, teamTaskEvent{ID: 5, To: TeamTaskDispatched, WS: "discord:wsX", By: "test"}, time.Now())
	if err == nil {
		_, err = transitionTeamTaskLocked(e.dataDir, teamTaskEvent{ID: 5, To: TeamTaskClosed, By: "test"}, time.Now())
	}
	teamWorkspaceStore.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	if err := e.ClaimTeamWorkspaceTask("discord:chatA", "ws1", "工作区1", "", "#5", 5); err == nil {
		t.Fatal("a claim for a closed task was accepted")
	}
	p.mu.Lock()
	owner := p.owner
	p.mu.Unlock()
	if owner != "" {
		t.Fatalf("platform still records ws1 owned by %q after the refused claim", owner)
	}
}
