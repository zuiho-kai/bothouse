package core

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"
)

func TestUsageMembersImportAndLateCompletion(t *testing.T) {
	data, logs := t.TempDir(), t.TempDir()
	writeSessionStore(t, data, "role_hash.json", claudeSID)
	writeLines(t, filepath.Join(logs, "project", claudeSID+".jsonl"), claudeLine1, claudeLine1Again, claudeLine2)
	ledger := NewUsageLedger(data, map[string]TokenPrice{"claude-opus-5-5": {Input: 1, Output: 2, CacheRead: 1, CacheWrite: 1}})
	im := NewUsageImporter(data, ledger, ClaudeCodeUsageSource{Dir: logs})
	if err := im.Sync(); err != nil {
		t.Fatal(err)
	}
	rows := usageRows(t, ledger, "members")
	if len(rows) != 1 || rows[0].Member != nil || rows[0].Responses != 2 {
		t.Fatalf("in-flight: %+v", rows)
	}
	journal, err := OpenTurnJournal(TurnJournalPath(data, "role"))
	if err != nil {
		t.Fatal(err)
	}
	start, _ := time.Parse(time.RFC3339, "2026-10-24T08:48:40Z")
	en, err := journal.Begin(TurnJournalEntry{Project: "role", AgentSessionID: claudeSID, StartedAt: start, UsageMember: &UsageMember{Platform: "p", Account: "1", Name: "Alice"}})
	if err != nil {
		t.Fatal(err)
	}
	// The queued second member shares the CLI session, but not the first turn.
	_, err = journal.Update(en.TurnID, func(e *TurnJournalEntry) {
		e.StartedAt = start.Add(25 * time.Second)
		e.UsageMember = &UsageMember{Platform: "p", Account: "2", Name: "Bob"}
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := journal.Delete(en.TurnID); err != nil {
		t.Fatal(err)
	}
	// No re-import required: already imported in-flight records resolve once the turn completes.
	rows = usageRows(t, ledger, "members")
	if len(rows) != 2 {
		t.Fatalf("members: %+v", rows)
	}
	totals := map[string]int64{}
	var total int64
	for _, r := range rows {
		totals[r.Member.Account] = r.Total
		total += r.Total
	}
	if totals["1"] != 50323 || totals["2"] != 50135 {
		t.Fatalf("CLI token totals: %v", totals)
	}
	if daily := usageRows(t, ledger, "daily"); len(daily) != 1 || daily[0].Total != total {
		t.Fatalf("reconciliation: %+v vs %d", daily, total)
	}
	for _, group := range []string{"roles", "models", "daily"} {
		rows, err := ledger.Query(start.Add(-24*time.Hour), start.Add(24*time.Hour), group, "role", "claude-opus-5-5", "p:1")
		if err != nil || len(rows) != 1 || rows[0].Total != 50323 {
			t.Fatalf("%s detail: %+v %v", group, rows, err)
		}
	}
	if err := im.Sync(); err != nil {
		t.Fatal(err)
	}
	if rows := usageRows(t, ledger, "members"); len(rows) != 2 {
		t.Fatalf("repeat import: %+v", rows)
	}
}

func TestUsageMembersIdentityAndUnattributed(t *testing.T) {
	human := Message{Platform: "p", UserID: "1", UserName: "Alice"}
	for _, change := range []func(*Message){func(m *Message) { m.FromBot = true }, func(m *Message) { m.UserID = "cron" }, func(m *Message) { m.UserID = "handoff" }, func(m *Message) { m.turnTrigger = TurnTriggerTimer }, func(m *Message) { m.resumedFrom = "old" }} {
		msg := human
		change(&msg)
		if got := usageMemberOf(msg); got != nil {
			t.Fatalf("automated member: %+v", got)
		}
	}
	l := NewUsageLedger(t.TempDir(), nil)
	now := time.Now()
	for _, m := range []*UsageMember{usageMemberOf(human), {Platform: "p", Account: "1", Name: "renamed"}, {Platform: "q", Account: "1", Name: "Alice"}, nil} {
		if err := l.Record(UsageRecord{Time: now, Role: "r", Model: "m", Input: 10, Known: true, Member: m}); err != nil {
			t.Fatal(err)
		}
	}
	// A legacy unknown record stays unknown, not a fabricated zero-token member.
	if err := l.Record(UsageRecord{Time: now, Role: "r", Model: "unknown"}); err != nil {
		t.Fatal(err)
	}
	rows, err := l.Query(now, now, "members", "", "")
	if err != nil || len(rows) != 3 {
		t.Fatalf("platform accounts: %+v %v", rows, err)
	}
	var count, tokens int64
	for _, r := range rows {
		count += r.Responses
		tokens += r.Total
		if r.Member == nil && (r.Unknown != 1 || r.Responses != 2) {
			t.Fatalf("unattributed: %+v", r)
		}
	}
	if count != 5 || tokens != 40 {
		t.Fatalf("totals %d %d", count, tokens)
	}
	m := NewManagementServer(0, "secret", nil)
	m.SetUsageLedger(l)
	server := httptest.NewServer(m.buildHandler(http.NewServeMux()))
	defer server.Close()
	for _, auth := range []bool{false, true} {
		req, _ := http.NewRequest("GET", server.URL+"/api/v1/usage/members", nil)
		if auth {
			req.Header.Set("Authorization", "Bearer secret")
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		if !auth {
			if resp.StatusCode != 401 {
				t.Fatalf("unauth status %d", resp.StatusCode)
			}
		} else {
			var result struct {
				Data struct {
					Items []UsageAggregate `json:"items"`
				} `json:"data"`
			}
			if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
				t.Fatal(err)
			}
			if len(result.Data.Items) != 3 {
				t.Fatalf("HTTP members: %+v", result)
			}
		}
		resp.Body.Close()
	}
}
