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
			cardPlatform := newProgressPlatform()
			cardPlatform.n = plat
			source.publicProgress, err = NewPublicProgress(dir, source.name, []Platform{cardPlatform})
			if err != nil {
				t.Fatal(err)
			}
			cardRun := source.publicProgress.begin(cardPlatform, ws, LangChinese, nil)
			_, err = source.publicProgress.Report(PublicProgressRequest{Project: source.name, SessionKey: ws, Run: cardRun, Seq: 1, Kind: "start", Title: "修复代码", Summary: "和任务板同一工作区"})
			if err != nil {
				t.Fatal(err)
			}
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
			if count != 2 {
				t.Fatalf("expected one lead wake and one coalesced workspace wake; got %d", count)
			}
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

func TestQuotaTaskCardTakeoverContinuesOriginalJournal(t *testing.T) {
	dir := t.TempDir()
	rm := NewRelayManager(dir)
	engines := map[string]*Engine{}
	for _, name := range []string{"orange", "longniang"} {
		p := newProgressPlatform()
		e := NewEngine(name, &stubAgent{}, []Platform{p}, "", LangChinese)
		e.dataDir = dir
		e.SetRelayManager(rm)
		rm.RegisterEngine(name, e)
		if err := e.EnablePublicProgress(); err != nil {
			t.Fatal(err)
		}
		e.publicProgress.workspaceChat = func(string) bool { return true }
		engines[name] = e
		t.Cleanup(e.cancel)
	}
	source, target := engines["orange"], engines["longniang"]
	platform := source.platforms[0]
	run := source.publicProgress.begin(platform, "discord:ws", LangChinese, nil)
	req := PublicProgressRequest{Project: source.name, SessionKey: "discord:ws", Run: run, Seq: 1, Kind: "start", Title: "修复代码", Summary: "正在修复"}
	id, err := source.publicProgress.Report(req)
	if err != nil {
		t.Fatal(err)
	}
	source.recordQuota(time.Now().Add(time.Hour), "discord:ws")
	source.publicProgress.finish(run, "failed")
	r := source.publicProgress.records[id]
	if IsTerminalState(r.record.Task.State) {
		t.Fatal("quota ended unfinished card before takeover")
	}
	work := quotaWork{ID: "task:" + id, Task: id, Source: source.name, Session: "discord:ws", Title: "修复代码"}
	if err := source.applyQuotaWork(work, target, time.Now()); err != nil {
		t.Fatal(err)
	}
	source.quotaState.Transfers = map[string]quotaTransfer{work.ID: {To: target.name, Session: work.Session, Work: work, Applied: true, Woken: true}}
	token := target.publicProgress.begin(target.platforms[0], work.Session, LangChinese, nil)
	update := PublicProgressRequest{Project: target.name, SessionKey: work.Session, Run: token, TaskID: id, Seq: 1, Kind: "update", Summary: "接手原卡"}
	for i := 0; i < 2; i++ {
		if got, handled, err := target.reportQuotaProgress(update); err != nil || !handled || got != id {
			t.Fatalf("takeover update: %s %v %v", got, handled, err)
		}
	}
	update.Seq, update.Kind, update.Summary = 2, "result", "修复完成"
	if _, _, err := target.reportQuotaProgress(update); err != nil {
		t.Fatal(err)
	}
	if r.record.Task.State != TaskStateResultReady || r.record.Task.ResultSummary != "修复完成" {
		t.Fatal("replacement could not finish original card")
	}
	if r.record.Task.Events[len(r.record.Task.Events)-1].ReporterProject != target.name {
		t.Fatal("replacement attribution lost")
	}
	source.publicProgress.finishRun(r, "failed", false)
	if r.record.Task.State != TaskStateResultReady {
		t.Fatal("old owner overwrote replacement result")
	}
}

func TestQuotaRelayWatchDoesNotNudgeCoolingMember(t *testing.T) {
	p, d, now := relayWatchFixture(t)
	p.quotaBlocked = func(project string) bool { return project == d.req.To }
	p.relayWatchTick(now.Add(watchCheckAfter()))
	select {
	case <-d.nudge:
		t.Fatal("watch nudged a cooling backend")
	default:
	}
	if relayWatchStopped(d) != 0 || relayWatchReceipt(d).WatchDone {
		t.Fatal("quota handoff was stopped instead of retained")
	}
}
