package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// autostartFixture: a lead engine with the real gate/board.py, one board item handed to 工作区1
// (「已交接」) and the bridge's handoff record for it.
func autostartFixture(t *testing.T) (*Engine, *handoffWatch, string) {
	t.Helper()
	e := NewEngine("lead", &stubAgent{}, nil, "", LangChinese)
	dataDir := t.TempDir()
	gateSrc, err := filepath.Abs(filepath.Join("..", "contrib", "gate"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(gateSrc, filepath.Join(dataDir, "gate")); err != nil {
		t.Fatal(err)
	}
	e.SetDataDir(dataDir)
	e.productPyBin.Store(t.TempDir())
	boardDir := t.TempDir()
	e.SetTeam(boardDir, "橘", true)
	if err := os.WriteFile(filepath.Join(boardDir, teamTaskBoardFile), []byte(
		`{"id":7,"what":"开工后自动标在做","short":"自动标在做","status":"已交接","who":"工作区1橘","ws":"discord:ws1","sk":"discord:ws1","chat":"discord:main","at":"11-05 12:00"}`+"\n",
	), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := e.ClaimTeamWorkspaceFor("discord:main", "ws1", "工作区1", "", "自动标在做"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { e.cancel(); _ = e.Stop() })
	return e, newHandoffWatch(e), boardDir
}

func autostartEvent(t *testing.T, e *Engine, key, step string) {
	t.Helper()
	st := &interactiveState{}
	st.lastEventAt.Store(time.Now().UnixNano())
	e.interactiveMu.Lock()
	e.interactiveStates[key] = st
	e.interactiveMu.Unlock()
	if step == "" {
		return
	}
	j := e.turnJournalStore()
	en, err := j.Begin(TurnJournalEntry{InteractiveKey: key})
	if err != nil {
		t.Fatal(err)
	}
	if err := j.Progress(en.TurnID, step, "", true); err != nil {
		t.Fatal(err)
	}
}

func boardStatus(t *testing.T, dir string, id int) string {
	t.Helper()
	for _, it := range readTeamTaskBoard(dir) {
		if it.ID == id {
			return it.Status
		}
	}
	t.Fatalf("board item %d missing", id)
	return ""
}

// The board still says 已交接 while the workspace session already produces agent events: the
// watch flips it to 在做 with the latest step (11-05 #1063 sat at 已交接 for 20 minutes).
func TestBoardAutostart_MarksStartedWorkspace(t *testing.T) {
	e, w, dir := autostartFixture(t)
	w.markStartedHandoffs(time.Now(), map[int]time.Time{})
	if got := boardStatus(t, dir, 7); got != "已交接" {
		t.Fatalf("no event yet, status = %q", got)
	}
	autostartEvent(t, e, "discord:ws1", "Bash go test ./core -run TestBoard")
	w.markStartedHandoffs(time.Now(), map[int]time.Time{})
	if got := boardStatus(t, dir, 7); got != "在做：Bash go test ./co..." {
		t.Fatalf("status = %q", got)
	}
}

// A started turn with no tool step yet still counts; a status the workspace wrote itself is kept.
func TestBoardAutostart_NoStepAndKeepsOwnStatus(t *testing.T) {
	e, w, dir := autostartFixture(t)
	autostartEvent(t, e, "discord:ws1:u1", "")
	w.markStartedHandoffs(time.Now(), map[int]time.Time{})
	if got := boardStatus(t, dir, 7); got != "在做：已开工" {
		t.Fatalf("status = %q", got)
	}
	if out, err := e.runLeadScript("discord:main", "board", "update", "7", "在做：自己写的进度"); err != nil {
		t.Fatalf("board update: %v %s", err, out)
	}
	autostartEvent(t, e, "discord:ws1", "Read x.go")
	w.markStartedHandoffs(time.Now(), map[int]time.Time{})
	if got := boardStatus(t, dir, 7); got != "在做：自己写的进度" {
		t.Fatalf("own status overwritten: %q", got)
	}
}

// The backstop prompt gets the live state appended when it fires; other prompts and the stored
// job are unchanged.
func TestBoardAutostart_GuardPromptCarriesLiveState(t *testing.T) {
	e, _, _ := autostartFixture(t)
	job := &TimerJob{ID: "g1", Prompt: "兜底到点：#7「开工后自动标在做」交给工作区1橘 10m 了，还没交回。"}
	got := e.withGuardLiveStatus(job, time.Now())
	if !strings.Contains(got.Prompt, "桥实时查") || !strings.Contains(got.Prompt, "现在没有在跑的一轮") || !strings.Contains(got.Prompt, "交活后还没有 agent 事件") {
		t.Fatalf("idle prompt = %q", got.Prompt)
	}
	autostartEvent(t, e, "discord:ws1", "Bash go build ./...")
	got = e.withGuardLiveStatus(job, time.Now())
	if !strings.Contains(got.Prompt, "最近一次 agent 事件 刚刚") || !strings.Contains(got.Prompt, "最近一步 Bash go build ./...") {
		t.Fatalf("active prompt = %q", got.Prompt)
	}
	if strings.Contains(job.Prompt, "桥实时查") {
		t.Fatal("stored job modified")
	}
	other := &TimerJob{ID: "o", Prompt: "每天总结"}
	if e.withGuardLiveStatus(other, time.Now()) != other {
		t.Fatal("non-backstop job changed")
	}
}
