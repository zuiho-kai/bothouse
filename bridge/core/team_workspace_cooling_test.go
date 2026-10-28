package core

import (
	"errors"
	"strings"
	"testing"
	"time"
)

// 橘 2026-10-27 00:35 额度 0%，之后四条活照样交给工作区1/4/5/7，一条没开工（用户
// 2026-10-28 02:08「基本上别人不可用的」）。工作区跑的是同一个项目、同一个额度池，
// 冷却期交活等于把活丢给一个只会回「额度用完」的 bot：claim 必须当场拒绝。
func TestWorkspaceClaimRefusedWhileProjectCooling(t *testing.T) {
	e, _, _ := exitFixture(t, nil)
	e.capMu.Lock()
	e.quotaUntil = time.Now().Add(2 * time.Hour)
	e.capMu.Unlock()
	err := e.ClaimTeamWorkspace("discord:chatA", "ws1", "工作区1")
	if !errors.Is(err, ErrTeamWorkspaceCooling) {
		t.Fatalf("claim during cooldown = %v, want ErrTeamWorkspaceCooling", err)
	}
	if !strings.Contains(err.Error(), "resets in") {
		t.Fatalf("error should say when the cooldown ends: %v", err)
	}
	// The task was not recorded: another role can take it, nobody is woken for it.
	if _, ok := e.WorkspaceParent("ws1"); ok {
		t.Fatal("ws1 was claimed during the cooldown")
	}
	if _, ok := e.WorkspaceLastChat("ws1"); ok {
		t.Fatal("a handoff was recorded during the cooldown")
	}
}

// 冷却结束后照常交活：拒绝只发生在冷却期间，不留后遗症。
func TestWorkspaceClaimAfterCooldownEnds(t *testing.T) {
	e, _, _ := exitFixture(t, nil)
	e.capMu.Lock()
	e.quotaUntil = time.Now().Add(-time.Second) // already reset
	e.capMu.Unlock()
	if err := e.ClaimTeamWorkspace("discord:chatA", "ws1", "工作区1"); err != nil {
		t.Fatalf("claim after the cooldown ended = %v", err)
	}
	if got, ok := e.WorkspaceParent("ws1"); !ok || got != "chatA" {
		t.Fatalf("ws1 parent = %q,%v; want chatA", got, ok)
	}
}
