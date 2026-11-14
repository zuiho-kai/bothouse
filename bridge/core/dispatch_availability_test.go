package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// #771: a failed quota probe must not become an invitation to dispatch work.
func TestDispatchAvailabilityUnknownPublishedToTeam(t *testing.T) {
	peer := newTestEngine()
	peer.name, peer.dataDir = "peer", t.TempDir()
	peer.quotaState.ProbeStatus = "unknown"
	dir := t.TempDir()
	peer.team = &teamState{dir: dir, name: "伙伴", seen: map[string]*teamSession{}}
	done := make(chan struct{})
	go func() { defer close(done); peer.runTeamWriter() }()
	t.Cleanup(func() { peer.cancel(); <-done })
	path := filepath.Join(dir, "peer.json")
	waitFor(t, "team heartbeat", func() bool { _, err := os.Stat(path); return err == nil })
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var f teamFile
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	lead := newTestEngine()
	lead.name = "lead"
	lead.team = &teamState{dir: dir, inject: true}
	summary, _ := lead.teamSummary("discord:chat")
	board, _ := teamBoardMembers([]teamFile{f}, "discord:chat", nil)
	voice := renderVoiceDeskBrief([]teamFile{f}, time.Now())
	for name, got := range map[string]string{"summary": summary, "board": board, "voice": voice} {
		if !strings.Contains(got, "额度未知") || strings.Contains(got, "可以派活") {
			t.Errorf("%s calls unmeasured quota available: %s", name, got)
		}
	}
}

func TestDispatchAvailabilityCoolingBusyElsewhere(t *testing.T) {
	dir := t.TempDir()
	lead := newTestEngine()
	lead.name = "lead"
	lead.team = &teamState{dir: dir, inject: true}
	f := teamFile{Project: "peer", Name: "伙伴", Updated: time.Now(), CoolingUntil: time.Now().Add(time.Hour), Sessions: []teamEntry{
		{Key: "discord:elsewhere", Chat: "别处", Task: "工作", Busy: true, Worked: true, Since: time.Now()},
	}}
	writeTeamFile(t, dir, f)
	summary, _ := lead.teamSummary("discord:chat")
	board, _ := teamBoardMembers([]teamFile{f}, "discord:chat", nil)
	voice := renderVoiceDeskBrief([]teamFile{f}, time.Now())
	for name, got := range map[string]string{"summary": summary, "board": board, "voice": voice} {
		if strings.Contains(got, teamElsewhereNote) || !strings.Contains(got, "额度冷却到") || !strings.Contains(got, "工作") {
			t.Errorf("%s must keep activity without advertising cooled role: %s", name, got)
		}
	}
}

func TestDispatchAvailabilityCandidateRejectsUnknown(t *testing.T) {
	engines, _, _, _ := quotaReassignFixture(t)
	for _, name := range []string{"caihongmao", "jingyu", "longniang"} {
		engines[name].quotaState.ProbeStatus = "unknown"
	}
	if got := engines["orange"].quotaCandidate("discord:chat", nil); got != nil {
		t.Fatalf("unknown quota candidate selected: %s", got.name)
	}
}
