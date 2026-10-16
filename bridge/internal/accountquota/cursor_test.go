package accountquota

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestCursorQuotaSelectsActualModelBucket(t *testing.T) {
	const fixture = `{"billingCycleStart":"1700000000000","billingCycleEnd":"1702592000000","autoBucketModels":["default","composer-2"],"planUsage":{"autoPercentUsed":20,"apiPercentUsed":100,"totalPercentUsed":60}}`
	for _, tc := range []struct {
		model, bucket string
		used          int
	}{{"grok-test[fast=true]", "API", 100}, {"auto", "Auto", 20}, {"default", "Auto", 20}, {"composer-2[reasoning_effort=high]", "Auto", 20}} {
		t.Run(tc.model, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "POST" || r.Header.Get("Authorization") != "Bearer fixture-token" || r.Header.Get("Connect-Protocol-Version") != "1" {
					t.Error("invalid authenticated quota request")
				}
				b, _ := io.ReadAll(r.Body)
				if string(b) != "{}" {
					t.Errorf("body %q", b)
				}
				_, _ = io.WriteString(w, fixture)
			}))
			defer server.Close()
			got, err := fetchCursor(context.Background(), server.Client(), server.URL, "fixture-token", tc.model)
			if err != nil {
				t.Fatal(err)
			}
			if got.Buckets[0].Name != tc.bucket || got.Buckets[0].Windows[0].UsedPercent != tc.used {
				t.Fatalf("wrong pool: %+v", got)
			}
			if got.Buckets[0].Windows[0].ResetAtUnix != 1702592000 {
				t.Fatal("billing milliseconds not converted")
			}
		})
	}
}

func TestCursorQuotaMissingIsNotZero(t *testing.T) {
	for _, raw := range []string{`{}`, `{"planUsage":{}}`, `{"planUsage":{"limit":100}}`, `{"planUsage":{"apiPercentUsed":0}}`} {
		var d cursorUsage
		if err := json.Unmarshal([]byte(raw), &d); err != nil {
			t.Fatal(err)
		}
		got, err := d.report("test-model")
		if err != nil || got != nil {
			t.Fatalf("invented quota from %s: %+v %v", raw, got, err)
		}
	}
	var d cursorUsage
	_ = json.Unmarshal([]byte(`{"autoBucketModels":["default"],"planUsage":{"apiPercentUsed":0}}`), &d)
	got, err := d.report("test-model")
	if err != nil || got == nil || got.Buckets[0].Windows[0].UsedPercent != 0 {
		t.Fatal("explicit zero lost")
	}
}

func TestQuotaHTTPDoesNotLeakSecretsOrFollowRedirects(t *testing.T) {
	reached := false
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { reached = true }))
	defer target.Close()
	for _, code := range []int{http.StatusUnauthorized, http.StatusFound} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Location", target.URL)
			w.WriteHeader(code)
			_, _ = io.WriteString(w, "fixture-secret private-account")
		}))
		_, err := fetchCursor(context.Background(), server.Client(), server.URL, "fixture-secret", "default")
		server.Close()
		if err == nil || strings.Contains(err.Error(), "fixture-secret") || strings.Contains(err.Error(), "private-account") {
			t.Fatalf("unsafe error: %v", err)
		}
	}
	if reached {
		t.Fatal("credential request followed redirect")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := fetchCursor(ctx, httpClient(), target.URL, "fixture-secret", "default")
	if err == nil {
		t.Fatal("ignored cancellation")
	}
}

func TestCursorQuotaDoesNotUseOtherAuth(t *testing.T) {
	for _, env := range [][]string{{"CURSOR_API_KEY=fixture-secret"}, {"CURSOR_API_BASE_URL=https://example.invalid"}} {
		_, err := Cursor(context.Background(), env, "default")
		if err != ErrUnsupportedAuth {
			t.Fatalf("wrong auth: %v", err)
		}
	}
	if canUseKeychain([]string{"HOME=/conest-fixture-other-user"}) {
		t.Fatal("cross-home credential reuse")
	}
}

func TestCursorQuotaFileCredentialsAreScoped(t *testing.T) {
	root := t.TempDir()
	env := []string{"HOME=" + root, "APPDATA=" + root}
	path := filepath.Join(root, ".cursor", "auth.json")
	switch runtime.GOOS {
	case "linux":
		path = filepath.Join(root, ".config", "cursor", "auth.json")
	case "windows":
		path = filepath.Join(root, "Cursor", "auth.json")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		raw, want string
		err       error
	}{
		{`{"accessToken":"fixture-token"}`, "fixture-token", nil},
		{`{"accessToken":"old-login","apiKey":"fixture-key"}`, "", ErrUnsupportedAuth},
		{`{malformed secret fixture`, "", ErrNoCredentials},
	} {
		if err := os.WriteFile(path, []byte(tc.raw), 0600); err != nil {
			t.Fatal(err)
		}
		got, err := cursorToken(context.Background(), env)
		if got != tc.want || err != tc.err {
			t.Fatal("incorrect credential source or unsafe error")
		}
	}
}

// Opt-in, read-only provider acceptance; never runs in ordinary CI.
func TestCursorQuotaLive(t *testing.T) {
	model := os.Getenv("CC_CONNECT_LIVE_CURSOR_MODEL")
	if model == "" {
		t.Skip("set CC_CONNECT_LIVE_CURSOR_MODEL for read-only account query")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	got, err := Cursor(ctx, os.Environ(), model)
	if err != nil {
		t.Fatal(err)
	}
	if got == nil || len(got.Buckets) == 0 {
		t.Fatal("no measured quota")
	}
	w := got.Buckets[0].Windows[0]
	t.Logf("provider=Cursor bucket=%s remaining=%d%% reset=%d", got.Buckets[0].Name, 100-w.UsedPercent, w.ResetAtUnix)
}
