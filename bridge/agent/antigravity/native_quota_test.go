package antigravity

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

const quotaFixture = `{"response":{"groups":[{"displayName":"Gemini Models","buckets":[{"bucketId":"gemini-weekly","window":"weekly","remainingFraction":0.4},{"bucketId":"gemini-5h","window":"5h","remainingFraction":0.8}]},{"displayName":"Third-party models","buckets":[{"bucketId":"3p-weekly","window":"weekly","remainingFraction":0}]},{"displayName":"Argon","buckets":[{"bucketId":"gemini-argon-wtu-weekly","window":"weekly","remainingFraction":0.65,"resetTime":"2030-01-01T00:00:00Z"}]}]}}`

func TestNativeQuotaModelIsolation(t *testing.T) {
	var data quotaSummary
	if err := json.Unmarshal([]byte(quotaFixture), &data); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		model, name string
		used        int
	}{{"gemini-4-argon-medium", "Argon", 35}, {"gemini-3.8-flash-medium", "Gemini Models", 60}, {"claude-opus-test", "Third-party models", 100}} {
		got, err := data.report(tc.model)
		if err != nil || got == nil {
			t.Fatalf("%s: %v", tc.model, err)
		}
		if len(got.Buckets) != 1 || got.Buckets[0].Name != tc.name || got.Buckets[0].Windows[0].UsedPercent != tc.used {
			t.Fatalf("%s: wrong pool %+v", tc.model, got)
		}
	}
	got, err := data.report("unrecognized-model")
	if got != nil || err != nil {
		t.Fatal("unknown model must not inherit another model's quota")
	}
	data.Response.Groups = data.Response.Groups[:2]
	got, err = data.report("gemini-4-argon-medium")
	if err != nil || got == nil || got.Buckets[0].Name != "Gemini Models" {
		t.Fatal("shared Ultra quota not selected")
	}
}

func TestNativeQuotaUnknownZeroAndInvalid(t *testing.T) {
	for _, tc := range []struct {
		raw            string
		known, invalid bool
	}{
		{`{}`, false, false},
		{`{"response":{"groups":[{"buckets":[{"bucketId":"gemini-weekly","window":"weekly"}]}]}}`, false, false},
		{`{"response":{"groups":[{"buckets":[{"bucketId":"gemini-weekly","window":"weekly","remainingFraction":0}]}]}}`, true, false},
		{`{"response":{"groups":[{"buckets":[{"bucketId":"gemini-weekly","remainingFraction":2}]}]}}`, false, true},
	} {
		var d quotaSummary
		_ = json.Unmarshal([]byte(tc.raw), &d)
		got, err := d.report("gemini-test")
		if (err != nil) != tc.invalid || (got != nil) != tc.known {
			t.Fatalf("unknown quota converted to balance: %s %+v %v", tc.raw, got, err)
		}
	}
}

func TestNativeQuotaAuthenticatedRPCAndCache(t *testing.T) {
	var calls atomic.Int32
	var fail atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != "POST" || r.URL.Path != "/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary" || r.Header.Get("x-codeium-csrf-token") != "fixture-csrf" {
			t.Error("invalid native quota authentication")
		}
		if fail.Load() {
			w.WriteHeader(500)
			_, _ = io.WriteString(w, "fixture-secret private account")
			return
		}
		_, _ = io.WriteString(w, quotaFixture)
	}))
	defer server.Close()
	q := &nativeQuota{pid: 123, address: server.URL, csrf: "fixture-csrf"}
	ctx := context.Background()
	if _, err := q.get(ctx, "gemini-4-argon-medium"); err != nil {
		t.Fatal(err)
	}
	if _, err := q.get(ctx, "gemini-4-argon-medium"); err != nil || calls.Load() != 1 {
		t.Fatal("quota cache not reused")
	}
	if _, err := q.get(ctx, "gemini-3.8-flash-medium"); err != nil || calls.Load() != 2 {
		t.Fatal("model switch reused wrong quota")
	}
	q.fetchedAt = time.Now().Add(-time.Minute)
	fail.Store(true)
	got, err := q.get(ctx, "gemini-3.8-flash-medium")
	if err == nil || got != nil || strings.Contains(err.Error(), "fixture-secret") {
		t.Fatal("stale balance or credential leaked")
	}
	q.close()
	if got, err := q.get(ctx, "gemini-4-argon-medium"); got != nil || err != nil {
		t.Fatal("closed process reused")
	}
}

func TestNativeQuotaOnlyLoopbackListeners(t *testing.T) {
	got := nativeQuotaAddresses("p123\nn127.0.0.1:12345\nn[::1]:12346\nn*:12347\nn192.0.2.1:12348\nnlocalhost:12349\nn127.0.0.1:99999\n")
	if len(got) != 2 || got[0] != "http://127.0.0.1:12345" || got[1] != "http://[::1]:12346" {
		t.Fatalf("unsafe listeners: %v", got)
	}
}

// Starts an isolated idle CLI. No user prompt or model turn is submitted.
func TestAntigravityQuotaLive(t *testing.T) {
	bin := os.Getenv("CC_CONNECT_LIVE_AGY")
	if bin == "" {
		t.Skip("set CC_CONNECT_LIVE_AGY for read-only native quota acceptance")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	s, err := newStreamSession(ctx, bin, nil, t.TempDir(), "gemini-4-argon-medium", "plan", "", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	var report *core.UsageReport
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for report == nil {
		select {
		case <-ctx.Done():
			t.Fatalf("native quota unavailable: %v", err)
		case <-ticker.C:
		}
		report, err = s.GetUsage(ctx)
	}
	for _, b := range report.Buckets {
		for _, w := range b.Windows {
			t.Logf("provider=Antigravity bucket=%s window=%s remaining=%d%% reset=%d", b.Name, w.Name, 100-w.UsedPercent, w.ResetAtUnix)
		}
	}
}
