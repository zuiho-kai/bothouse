package antigravity

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

func writeQuotaAccount(t *testing.T, home, account string) {
	t.Helper()
	dir := filepath.Join(home, ".gemini", "antigravity-cli")
	if err := os.MkdirAll(filepath.Join(dir, "cache"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "cache", "default_project_id.txt"), []byte("fixture-project"), 0600); err != nil {
		t.Fatal(err)
	}
	claims, _ := json.Marshal(map[string]string{"sub": account})
	token, _ := json.Marshal(map[string]any{"id_token": "x." + base64.RawURLEncoding.EncodeToString(claims) + ".y", "token": map[string]string{"access_token": account, "expiry": time.Now().Add(time.Hour).Format(time.RFC3339Nano)}})
	if err := os.WriteFile(filepath.Join(dir, "antigravity-oauth-token"), token, 0600); err != nil {
		t.Fatal(err)
	}
}

func TestClassicQuota_CacheAndSessionAccountIsolation(t *testing.T) {
	home := t.TempDir()
	writeQuotaAccount(t, home, "account-a")
	a := &Agent{cmd: "unused", model: "gemini-fixture", activeIdx: -1}
	a.cloudQuota.homeDir = home
	a.cloudQuota.inflight = make(chan struct{}) // Hold refresh: this test performs no network I/O.
	a.cloudQuota.report = &core.UsageReport{AccountID: "account-a", ObservedAt: time.Now(), Buckets: []core.UsageBucket{{Windows: []core.UsageWindow{{UsedPercent: 100}}}}}
	a.cloudQuota.cacheModel = a.model
	session, err := a.StartSession(context.Background(), "")
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	cached := session.(core.CachedUsageReporter)
	if cached.CachedUsage() == nil {
		t.Fatal("account A lost its own cache")
	}
	writeQuotaAccount(t, home, "account-b")
	if got := a.CachedUsage(); got != nil {
		t.Fatalf("account B inherited account A report: %+v", got)
	}
	a.cloudQuota.report = &core.UsageReport{AccountID: "account-b", ObservedAt: time.Now()}
	if got := cached.CachedUsage(); got != nil {
		t.Fatal("old account A session read account B cache")
	}
}

func TestClassicQuota_TokenCacheFollowsAccount(t *testing.T) {
	home := t.TempDir()
	writeQuotaAccount(t, home, "account-a")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer account-a" && r.Header.Get("Authorization") != "Bearer account-b" {
			t.Error("unexpected fixture credential")
		}
		_, _ = io.WriteString(w, sampleQuotaSummary)
	}))
	defer srv.Close()
	q := &quotaState{homeDir: home, quotaURL: srv.URL}
	if _, err := q.fetch(context.Background(), "unused", "gemini-fixture"); err != nil {
		t.Fatal(err)
	}
	writeQuotaAccount(t, home, "account-b")
	report, err := q.fetch(context.Background(), "unused", "gemini-fixture")
	if err != nil {
		t.Fatal(err)
	}
	if q.token != "account-b" {
		t.Error("account B quota request reused account A access token")
	}
	if report.AccountID != "account-b" {
		t.Fatal("report did not retain the account that supplied its credential")
	}
}
