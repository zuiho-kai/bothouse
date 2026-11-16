package core

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"
)

func TestUsageMembersConservationAndDetails(t *testing.T) {
	dir := t.TempDir()
	l := NewUsageLedger(dir, map[string]TokenPrice{"m": {Input: 2}})
	start := time.Date(2026, 11, 17, 10, 0, 0, 0, time.Local)
	turns := []usageTurn{
		{Role: "r", SessionID: "s", Member: "discord:1", Start: start, End: start.Add(time.Minute)},
		{Role: "r", SessionID: "s", Member: "feishu:1", Start: start.Add(time.Minute), End: start.Add(2 * time.Minute)},
		{Role: "r", SessionID: "s", Member: usageUnassigned, Start: start.Add(2 * time.Minute), End: start.Add(3 * time.Minute)},
	}
	for _, turn := range turns {
		if err := writeUsageTurn(filepath.Join(dir, "usage", "turns"), turn); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 4; i++ {
		if err := l.Record(UsageRecord{Time: start.Add(time.Duration(i)*time.Minute + time.Second), Role: "r", SessionID: "s", Model: "m", Input: int64((i + 1) * 10), Known: true}); err != nil {
			t.Fatal(err)
		}
	}
	// Historical records have no source session, even if their timestamps match.
	if err := l.Record(UsageRecord{Time: start, Role: "r", Model: "m", Input: 5, Known: true}); err != nil {
		t.Fatal(err)
	}
	rows, err := l.Query(start, start, "members", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 3 || rows[0].Member != usageUnassigned || rows[0].Total != 75 || rows[1].Member != "feishu:1" || rows[2].Member != "discord:1" {
		t.Fatalf("members: %+v", rows)
	}
	var total int64
	for _, row := range rows {
		total += row.Total
	}
	daily, err := l.Query(start, start, "daily", "", "")
	if err != nil || daily[0].Total != total {
		t.Fatalf("daily %+v members total %d error %v", daily, total, err)
	}
	for _, group := range []string{"daily", "roles", "models"} {
		detail, err := l.QueryMember(start, start, group, "r", "m", "feishu:1")
		if err != nil || len(detail) != 1 || detail[0].Total != 20 || detail[0].Responses != 1 || detail[0].EstimatedCost == nil {
			t.Fatalf("%s detail: %+v %v", group, detail, err)
		}
	}
}

func TestUsageMembersAdminAuthentication(t *testing.T) {
	m := &ManagementServer{token: "admin", usageLedger: NewUsageLedger(t.TempDir(), nil)}
	for _, path := range []string{"/api/v1/usage/members", "/api/v1/usage/daily?member=discord%3A1"} {
		for _, token := range []string{"", "member", "admin"} {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			req.Header.Set("Authorization", "Bearer "+token)
			rec := httptest.NewRecorder()
			m.wrap(m.handleUsage)(rec, req)
			want := 401
			if token == "admin" {
				want = 200
			}
			if rec.Code != want {
				t.Fatalf("%s token %q: %d", path, token, rec.Code)
			}
		}
	}
}

func TestUsageMemberAutomaticTurns(t *testing.T) {
	dir := t.TempDir()
	e := &Engine{name: "r", dataDir: dir}
	start := time.Now()
	for _, msg := range []*Message{
		{Platform: "discord", UserID: "1", FromBot: true},
		{Platform: "discord", UserID: "1", timerJobID: "timer"},
		{Platform: "discord", UserID: "handoff"},
		{Platform: "discord", UserID: "1", inputTurn: &inputTurn{}},
	} {
		e.recordUsageTurn(msg, "s", start, start.Add(time.Second))
	}
	turns, err := readUsageTurns(filepath.Join(dir, "usage", "turns"))
	if err != nil {
		t.Fatal(err)
	}
	for _, turn := range turns["s"] {
		if turn.Member != usageUnassigned {
			t.Fatalf("automatic turn: %+v", turn)
		}
	}
}

func TestUsageMembersEngineCapturesHuman(t *testing.T) {
	as := newResultAgentSession("done")
	p := &stubPlatformEngine{n: "test"}
	e := NewEngine("role", &resultAgent{session: as}, []Platform{p}, t.TempDir()+"/sessions.json", LangEnglish)
	t.Cleanup(func() { _ = e.Stop() })
	dir := t.TempDir()
	e.SetDataDir(dir)
	s := e.sessions.GetOrCreateActive("test:channel")
	if !s.TryLock() {
		t.Fatal("busy")
	}
	e.processInteractiveMessage(p, &Message{SessionKey: "test:channel", Platform: "test", UserID: "person", Content: "hello", ReplyCtx: "rc"}, s)
	turns, err := readUsageTurns(filepath.Join(dir, "usage", "turns"))
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for sid, entries := range turns {
		for _, entry := range entries {
			count++
			if sid == "" || entry.Member != "test:person" || !entry.End.After(entry.Start) {
				t.Fatalf("capture: %+v", entry)
			}
		}
	}
	if count != 1 {
		t.Fatalf("captured %d turns", count)
	}
}

func TestUsageMembersImportBeforeTurnFinishes(t *testing.T) {
	dir, logs := t.TempDir(), t.TempDir()
	writeSessionStore(t, dir, "role_123.json", claudeSID)
	writeLines(t, filepath.Join(logs, "project", claudeSID+".jsonl"), claudeUser, claudeLine1)
	ledger := NewUsageLedger(dir, nil)
	importer := NewUsageImporter(dir, ledger, ClaudeCodeUsageSource{Dir: logs})
	if err := importer.Sync(); err != nil {
		t.Fatal(err)
	}
	before := usageRows(t, ledger, "members")
	if len(before) != 1 || before[0].Member != usageUnassigned {
		t.Fatalf("before: %+v", before)
	}
	day := time.Date(2026, 10, 24, 0, 0, 0, 0, time.UTC)
	if err := writeUsageTurn(filepath.Join(dir, "usage", "turns"), usageTurn{Role: "role", SessionID: claudeSID, Member: "discord:1", Start: day, End: day.Add(24 * time.Hour)}); err != nil {
		t.Fatal(err)
	}
	after := usageRows(t, ledger, "members")
	if len(after) != 1 || after[0].Member != "discord:1" || after[0].Total != before[0].Total {
		t.Fatalf("after: %+v", after)
	}
	if err := importer.Sync(); err != nil {
		t.Fatal(err)
	}
	again := usageRows(t, ledger, "members")
	if again[0].Responses != 1 || again[0].Total != after[0].Total {
		t.Fatalf("duplicate import: %+v", again)
	}
}
