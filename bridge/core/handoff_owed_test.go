package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// #758: the open promises and the results that came back are listed from records — this bot's
// unfired timers on the channel, and board items of the channel reported after the old context's
// last entry — not left to the minutes model.
func TestHandoffBlockListsOwedFromRecords(t *testing.T) {
	dir := t.TempDir()
	last := time.Date(2026, 11, 13, 23, 11, 0, 0, time.Local)
	board := strings.Join([]string{
		`{"id":31,"what":"在做的活","short":"在做","sk":"discord:chat1","status":"在做"}`,
	}, "\n") + "\n"
	writeTaskBoard(t, dir, teamTaskBoardFile, board)
	done := strings.Join([]string{
		`{"id":21,"what":"查 wiki 提炼单","short":"查提炼单","sk":"discord:chat1","status":"完成"}`,
		`{"id":22,"what":"早就交回的","short":"早交回","sk":"discord:chat1","status":"完成"}`,
		`{"id":23,"what":"别的频道的","short":"别频道","sk":"discord:chat2","status":"完成"}`,
	}, "\n") + "\n"
	writeTaskBoard(t, dir, teamTaskBoardDoneFile, done)

	a := &handoffStubAgent{handoffs: map[string]*SessionHandoff{
		"old": {Path: "/x/old.jsonl", Tail: []HistoryEntry{{Role: "assistant", Content: "交给工作区了，查完带回来", Timestamp: last}}},
	}}
	e := NewEngine("cj", a, []Platform{&stubPlatformEngine{n: "discord"}}, "", LangEnglish)
	defer e.Stop()
	e.dataDir = t.TempDir()
	e.SetTeam(dir, "橘", false)
	rep, _ := json.Marshal(map[string]time.Time{
		"21": last.Add(8 * time.Minute),
		"22": last.Add(-time.Hour),
		"23": last.Add(8 * time.Minute),
	})
	if err := os.WriteFile(filepath.Join(e.dataDir, exitReportedFile), rep, 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := NewTimerStore(e.dataDir)
	if err != nil {
		t.Fatal(err)
	}
	future := time.Now().Add(30 * time.Minute)
	for _, j := range []*TimerJob{
		{ID: "a", Project: "cj", SessionKey: "discord:chat1", ScheduledAt: future, Description: "兜底 #31：30m 没交回就查"},
		{ID: "b", Project: "cj", SessionKey: "discord:chat1", ScheduledAt: future, Description: "已经跑过的", Fired: true},
		{ID: "c", Project: "other", SessionKey: "discord:chat1", ScheduledAt: future, Description: "别的角色的"},
		{ID: "d", Project: "cj", SessionKey: "discord:chat2", ScheduledAt: future, Description: "别的频道的"},
	} {
		if err := store.Add(j); err != nil {
			t.Fatal(err)
		}
	}
	e.SetTimerScheduler(NewTimerScheduler(store))

	s := &Session{}
	s.SetHandoffFrom("old", "空闲 1.1 小时")
	b := e.handoffBlock(s, "discord:chat1:u1")
	for _, want := range []string{
		"## 已排的定时",
		"兜底 #31：30m 没交回就查",
		"## 本频道交出去的活，旧会话停下后有了结果",
		"#21 查提炼单 · 11-13 23:19 汇报已贴进本频道",
	} {
		if !strings.Contains(b, want) {
			t.Fatalf("handoff lacks %q:\n%s", want, b)
		}
	}
	for _, bad := range []string{"已经跑过的", "别的角色的", "别的频道的", "#22", "#23"} {
		if strings.Contains(b, bad) {
			t.Fatalf("handoff has %q:\n%s", bad, b)
		}
	}
	if !strings.HasSuffix(b, handoffEnd) {
		t.Fatalf("owed lists must sit inside the handoff:\n%s", b)
	}
	// the stored full handoff carries them too
	if i := strings.Index(b, "[#"); i >= 0 {
		cid := b[i+2 : i+2+strings.Index(b[i+2:], "]")]
		full, err := os.ReadFile(filepath.Join(CtxStoreDir(e.dataDir), cid+".md"))
		if err != nil || !strings.Contains(string(full), "#21 查提炼单") || !strings.Contains(string(full), "兜底 #31") {
			t.Fatalf("full handoff %s lacks the owed lists (err %v):\n%s", cid, err, full)
		}
	}
}

// The minutes model is no longer asked for open work or next steps (#758).
func TestSealDigestPromptLeavesOpenWorkToRecords(t *testing.T) {
	for _, col := range []string{"没做完/卡住的：", "下一步："} {
		if strings.Contains(sealDigestPrompt, col) {
			t.Fatalf("prompt still asks for %q", col)
		}
	}
}
