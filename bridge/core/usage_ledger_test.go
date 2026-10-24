package core

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestUsageLedgerPersistenceAndAggregation(t *testing.T) {
	dir := t.TempDir()
	l := NewUsageLedger(dir, map[string]TokenPrice{"m": {Input: 2, Output: 4, CacheRead: 1}})
	when := time.Date(2026, 10, 24, 13, 0, 0, 0, time.Local)
	for _, r := range []UsageRecord{
		{Time: when, Role: "a", Model: "m", Input: 100, Output: 50, CacheRead: 40, Known: true},
		{Time: when.Add(time.Hour), Role: "b", Model: "unpriced", Input: 20, Known: true},
		{Time: when, Role: "a", Model: "unknown"},
	} {
		if err := l.Record(r); err != nil {
			t.Fatal(err)
		}
	}
	reloaded := NewUsageLedger(dir, l.prices)
	rows, err := reloaded.Query(when, when, "daily", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].Responses != 3 || rows[0].Total != 210 || rows[0].Unknown != 1 || rows[0].Unpriced != 2 {
		t.Fatalf("rows: %+v", rows)
	}
	if rows[0].EstimatedCost == nil || *rows[0].EstimatedCost != 0.00044 {
		t.Fatalf("cost: %+v", rows[0])
	}
	hourly, _ := reloaded.Query(when, when, "hourly", "a", "")
	if len(hourly) != 1 || hourly[0].Hour != 13 || hourly[0].Responses != 2 {
		t.Fatalf("hourly: %+v", hourly)
	}
	models, _ := reloaded.Query(when, when, "models", "", "m")
	if len(models) != 1 || models[0].Input != 100 {
		t.Fatalf("models: %+v", models)
	}
	b, err := os.ReadFile(filepath.Join(dir, "usage", "2026-10-24.json"))
	if err != nil {
		t.Fatal(err)
	}
	var day usageDay
	if err = json.Unmarshal(b, &day); err != nil || len(day.Records) != 3 || len(day.Buckets) != 3 {
		t.Fatalf("persisted day: %+v, %v", day, err)
	}
}
func TestUsageLedgerConcurrentAndCorrupt(t *testing.T) {
	dir := t.TempDir()
	l := NewUsageLedger(dir, nil)
	when := time.Now()
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := l.Record(UsageRecord{Time: when, Role: "a", Model: "m", Input: 1, Known: true}); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	rows, err := l.Query(when, when, "roles", "", "")
	if err != nil || len(rows) != 1 || rows[0].Responses != 20 {
		t.Fatalf("%+v %v", rows, err)
	}
	if err = os.WriteFile(filepath.Join(dir, "usage", when.Format("2006-01-02")+".json"), []byte("broken"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = l.Record(UsageRecord{Time: when}); err == nil {
		t.Fatal("must preserve corrupt data instead of overwriting it")
	}
}
func TestUsageManagementHTTP(t *testing.T) {
	m := NewManagementServer(0, "test-secret", nil)
	m.SetUsageLedger(NewUsageLedger(t.TempDir(), nil))
	if err := m.usageLedger.Record(UsageRecord{Time: time.Now(), Role: "role-a", Model: "m", Input: 5, Known: true}); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(m.buildHandler(http.NewServeMux()))
	defer server.Close()
	for _, path := range []string{"daily", "hourly", "roles", "models"} {
		req, _ := http.NewRequest("GET", server.URL+"/api/v1/usage/"+path, nil)
		req.Header.Set("Authorization", "Bearer test-secret")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		var result struct {
			Data struct {
				Items []UsageAggregate `json:"items"`
			} `json:"data"`
		}
		err = json.NewDecoder(resp.Body).Decode(&result)
		resp.Body.Close()
		if err != nil || resp.StatusCode != 200 || len(result.Data.Items) != 1 || result.Data.Items[0].Responses != 1 {
			t.Fatalf("%s: %d %+v %v", path, resp.StatusCode, result, err)
		}
	}
	req := httptest.NewRequest("GET", "/api/v1/usage/daily?from=bad", nil)
	req.Header.Set("Authorization", "Bearer test-secret")
	w := httptest.NewRecorder()
	m.buildHandler(http.NewServeMux()).ServeHTTP(w, req)
	if w.Code != 400 {
		t.Fatal(w.Code)
	}
	req = httptest.NewRequest("GET", "/api/v1/usage/daily", nil)
	w = httptest.NewRecorder()
	m.buildHandler(http.NewServeMux()).ServeHTTP(w, req)
	if w.Code != 401 {
		t.Fatal(w.Code)
	}
}
func TestUsageHoursAreSortedNumerically(t *testing.T) {
	l := NewUsageLedger(t.TempDir(), nil)
	day := time.Date(2026, 10, 24, 0, 0, 0, 0, time.Local)
	for _, h := range []int{12, 2, 23} {
		if err := l.Record(UsageRecord{Time: day.Add(time.Duration(h) * time.Hour)}); err != nil {
			t.Fatal(err)
		}
	}
	rows, err := l.Query(day, day, "hourly", "", "")
	if err != nil || len(rows) != 3 || rows[0].Hour != 2 || rows[1].Hour != 12 || rows[2].Hour != 23 {
		t.Fatalf("%+v %v", rows, err)
	}
}

// A reply's usage record must not wait for disk writes or dashboard queries.
