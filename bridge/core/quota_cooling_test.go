package core

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestQuotaResetTime(t *testing.T) {
	now := time.Date(2026, 10, 27, 13, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		raw string
		at  time.Time
	}{
		{"RESOURCE_EXHAUSTED Individual quota reached. Resets in 83h59m53s.", now.Add(83*time.Hour + 59*time.Minute + 53*time.Second)},
		{"9:30pm (Asia/Tokyo)", time.Date(2026, 10, 28, 12, 30, 0, 0, time.UTC)},
		{"Oct 30, 2pm (Asia/Tokyo)", time.Date(2026, 10, 30, 5, 0, 0, 0, time.UTC)},
		{"2026-10-28T09:00:00Z", time.Date(2026, 10, 28, 9, 0, 0, 0, time.UTC)},
	} {
		got, ok := quotaResetTime(tc.raw, now)
		if !ok || !got.Equal(tc.at) {
			t.Fatalf("%q => %v, %v; want %v", tc.raw, got, ok, tc.at)
		}
	}
	if _, ok := quotaResetTime("", now); ok {
		t.Fatal("missing reset must not invent a deadline")
	}
}

func TestQuotaUsageThresholdAndPersistence(t *testing.T) {
	e, _, _ := exitFixture(t, nil)
	until := time.Now().Add(time.Hour).Truncate(time.Second)
	report := func(used int) *UsageReport {
		return &UsageReport{Buckets: []UsageBucket{{Windows: []UsageWindow{{WindowSeconds: 18000, UsedPercent: used, ResetAtUnix: until.Unix()}}}}}
	}
	e.observeQuotaUsage(report(95), "discord:chat")
	if !e.quotaCooling().IsZero() {
		t.Fatal("5% remaining must not trigger below-5% rule")
	}
	e.observeQuotaUsage(report(96), "discord:chat")
	if !e.quotaCooling().Equal(until) || !e.capacityCoolingUntil().Equal(until) {
		t.Fatal("cooling_until contract missing")
	}
	b, err := os.ReadFile(e.quotaPath())
	if err != nil {
		t.Fatal(err)
	}
	var saved quotaCoolingState
	if err := json.Unmarshal(b, &saved); err != nil || !saved.Until.Equal(until) {
		t.Fatalf("persisted state: %s, %v", b, err)
	}
}

func TestQuotaTakeoverIsolationJourney(t *testing.T) {
	for _, plat := range []string{"discord", "cloud_web"} {
		t.Run(plat, func(t *testing.T) {
			dir := t.TempDir()
			engines := map[string]*Engine{}
			agents := map[string]*inputTestAgent{}
			platforms := map[string]*exitTestPlatform{}
			rm := NewRelayManager(dir)
			store, err := NewTimerStore(dir)
			if err != nil {
				t.Fatal(err)
			}
			ts := NewTimerScheduler(store)
			for _, name := range []string{"orange", "longniang", "jingyu"} {
				as := &inputTestSession{events: make(chan Event, 32), prompts: make(chan string, 32), id: name}
				a := &inputTestAgent{session: as, requested: make(chan string, 32)}
				p := &exitTestPlatform{inputTestPlatform: inputTestPlatform{stubPlatformEngine: stubPlatformEngine{n: plat}}}
				e := NewEngine(name, a, []Platform{p}, "", LangChinese)
				e.dataDir = dir
				e.team = &teamState{dir: filepath.Join(dir, "team"), name: name, inject: name == "orange", seen: map[string]*teamSession{}}
				os.MkdirAll(e.team.dir, 0700)
				e.SetRelayManager(rm)
				rm.RegisterEngine(name, e)
				e.SetTimerScheduler(ts)
				ts.RegisterEngine(name, e)
				e.markPlatformReady(p)
				engines[name], agents[name], platforms[name] = e, a, p
				t.Cleanup(func() { e.cancel(); e.Stop() })
			}
			t.Cleanup(ts.Stop)
			source := engines["orange"]
			chat, ws := plat+":chat", plat+":ws"
			rm.Bind(plat, "chat", map[string]string{"orange": "orange", "longniang": "longniang", "jingyu": "jingyu"})
			rm.Bind(plat, "ws", map[string]string{"orange": "orange", "longniang": "longniang", "jingyu": "jingyu"})
			if err := writeLeadSelectionFile(dir, "orange", "orange", time.Now()); err != nil {
				t.Fatal(err)
			}
			now := time.Now()
			teamWorkspaceStore.mu.Lock()
			st := loadTeamWorkspacesLocked(teamWorkspacePath(dir))
			st.Handoffs = map[string][]TeamHandoff{}
			st.Handoffs[ws] = []TeamHandoff{{Chat: chat, At: now, Owner: "orange", Title: "修复代码", Board: 9}}
			err = saveTeamWorkspacesLocked(teamWorkspacePath(dir), st)
			teamWorkspaceStore.mu.Unlock()
			if err != nil {
				t.Fatal(err)
			}
			board := `{"id":9,"what":"修复代码","where":"/isolation/original-handoff.md","status":"未完成","who":"orange","ws":"` + ws + `","sk":"` + ws + `","chat":"` + chat + `","custom":"preserved"}` + "\n"
			if err := os.WriteFile(filepath.Join(source.team.dir, "board.jsonl"), []byte(board), 0600); err != nil {
				t.Fatal(err)
			}
			reset := time.Now().Add(time.Hour).Truncate(time.Second)
			source.observeQuotaEvent(Event{Type: EventError, Metadata: WithQuotaExhausted(nil, reset.Format(time.RFC3339)), Error: errors.New("quota exhausted")}, chat, nil)
			if err := source.ExecuteCronJob(&CronJob{ID: "cron", SessionKey: chat, Prompt: "must not run"}); err != nil {
				t.Fatal(err)
			}
			if err := source.ExecuteTimerJob(&TimerJob{ID: "timer", SessionKey: chat, Prompt: "must not run"}); err != nil {
				t.Fatal(err)
			}
			if _, err := source.HandleRelay(context.Background(), "jingyu", chat, "must not run"); err == nil {
				t.Fatal("relay did not respect cooling")
			}
			source.quotaTick(now)
			sel, _ := readLeadSelectionFull(dir)
			if sel.Lead != "jingyu" {
				t.Fatalf("automatic lead selection=%+v", sel)
			}
			items := readTeamTaskBoard(source.team.dir)
			if len(items) != 1 || items[0].Who != "longniang" {
				t.Fatalf("board owner=%+v", items)
			}
			content, _ := os.ReadFile(filepath.Join(source.team.dir, "board.jsonl"))
			if !strings.Contains(string(content), "preserved") || !strings.Contains(string(content), "/isolation/original-handoff.md") {
				t.Fatal("handoff or unknown board fields lost")
			}
			teamWorkspaceStore.mu.Lock()
			st = loadTeamWorkspacesLocked(teamWorkspacePath(dir))
			owner := st.Handoffs[ws][0].Owner
			teamWorkspaceStore.mu.Unlock()
			if owner != "longniang" {
				t.Fatalf("workspace watch owner=%s", owner)
			}
			// Both automatic wakes execute through the real timer entry. The
			// fake agents only record prompts; no provider/network is involved.
			prompt := inputPrompt(t, agents["longniang"])
			if !strings.Contains(prompt, "/isolation/original-handoff.md") {
				t.Fatalf("new owner lost original handoff: %s", prompt)
			}
			inputDone(agents["longniang"], "交接已收到")
			inputPrompt(t, agents["jingyu"])
			inputDone(agents["jingyu"], "主角色已接")
			select {
			case <-agents["orange"].requested:
				t.Fatal("cooling role was woken")
			default:
			}
			count := len(store.List())
			source.quotaTick(now.Add(time.Minute))
			if len(store.List()) != count {
				t.Fatal("takeover wake duplicated")
			}
			source.quotaTick(reset.Add(time.Second))
			sel, _ = readLeadSelectionFull(dir)
			if sel.Lead != "orange" {
				t.Fatalf("lead not restored: %+v", sel)
			}
			if len(platforms["orange"].sentTo(chat)) < 2 {
				t.Fatal("lead switch/recovery notices missing")
			}
			t.Log("quota event -> lead switched and notified -> board/workspace reassigned -> original handoff delivered -> cron/timer/relay skipped -> no duplicate wake -> lead restored")
		})
	}
}
