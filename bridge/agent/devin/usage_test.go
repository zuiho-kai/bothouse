package devin

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// Official Max response shape; all identity and quota values are synthetic.
const maxQuotaJSON = `{"userStatus":{"userId":"test-user","teamId":"test-account","planStatus":{"dailyQuotaRemainingPercent":100,"weeklyQuotaRemainingPercent":87,"dailyQuotaResetAtUnix":"2000000000","weeklyQuotaResetAtUnix":"2000604800"}},"planInfo":{"planName":"Max","billingStrategy":"BILLING_STRATEGY_QUOTA","hideDailyQuota":true}}`

func TestMaxQuotaUsesWeeklyAccountAllowance(t *testing.T) {
	var status devinUserStatus
	if err := json.Unmarshal([]byte(maxQuotaJSON), &status); err != nil {
		t.Fatal(err)
	}
	r, err := status.report(time.Unix(2000000000, 0))
	if err != nil {
		t.Fatal(err)
	}
	if r.Plan != "Max" || r.UserID != "test-user" || r.AccountID != "test-account" || len(r.Buckets) != 1 {
		t.Fatalf("wrong account or unexpected daily cap: %+v", r)
	}
	w := r.Buckets[0].Windows[0]
	if w.Name != "Weekly" || w.UsedPercent != 13 || w.WindowSeconds != 604800 || w.ResetAtUnix != 2000604800 || w.ResetAfterSeconds != 604800 {
		t.Fatalf("must use account allowance and server reset: %+v", w)
	}
}

func TestQuotaUnknownAndExhaustedAreDistinct(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		exhausted  bool
	}{
		{"exhausted proto default", strings.Replace(maxQuotaJSON, `"weeklyQuotaRemainingPercent":87,`, "", 1), true},
		{"missing plan", `{"userStatus":{}}`, false},
		{"ACU is not quota", strings.Replace(maxQuotaJSON, "BILLING_STRATEGY_QUOTA", "BILLING_STRATEGY_ACU", 1), false},
		{"no reset", strings.Replace(maxQuotaJSON, "2000604800", "0", 1), false},
		{"invalid percent", strings.Replace(maxQuotaJSON, `Percent":87`, `Percent":101`, 1), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var status devinUserStatus
			if err := json.Unmarshal([]byte(tc.body), &status); err != nil {
				t.Fatal(err)
			}
			r, err := status.report(time.Unix(2000000000, 0))
			if !tc.exhausted {
				if err == nil || r != nil {
					t.Fatalf("unknown became quota: %+v, %v", r, err)
				}
				return
			}
			if err != nil || !r.Buckets[0].LimitReached || r.Buckets[0].Windows[0].UsedPercent != 100 {
				t.Fatalf("exhausted quota lost: %+v, %v", r, err)
			}
		})
	}
}

func TestDevinQuotaShadowsACPAndUsesSessionAccount(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX fake CLI")
	}
	dir := t.TempDir()
	cli := filepath.Join(dir, "fake-devin")
	if err := os.WriteFile(cli, []byte("#!/bin/sh\necho 'devin 3000.test (test)'\n"), 0700); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var b struct{ Metadata map[string]string }
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			t.Error(err)
		}
		if r.URL.Path != devinStatusPath || r.Header.Get("Connect-Protocol-Version") != "1" {
			t.Error("wrong endpoint or protocol")
		}
		if b.Metadata["apiKey"] != "session-key" || b.Metadata["ideType"] != "chisel" || b.Metadata["ideVersion"] != "3000.test" {
			t.Error("wrong credential or CLI identity")
		}
		_, _ = w.Write([]byte(maxQuotaJSON))
	}))
	defer server.Close()
	if err := os.MkdirAll(filepath.Join(dir, "devin"), 0700); err != nil {
		t.Fatal(err)
	}
	credentials := fmt.Sprintf("windsurf_api_key = %q\napi_server_url = %q\n", "session-key", server.URL)
	if err := os.WriteFile(filepath.Join(dir, "devin", "credentials.toml"), []byte(credentials), 0600); err != nil {
		t.Fatal(err)
	}
	a, err := New(map[string]any{"command": cli, "env": map[string]string{"WINDSURF_API_KEY": "project-key"}})
	if err != nil {
		t.Fatal(err)
	}
	if !a.(core.UsageCapability).SupportsUsageReporting() {
		t.Fatal("Devin inherits ACP's Cursor-only capability")
	}
	a.(core.SessionEnvInjector).SetSessionEnv([]string{"WINDSURF_API_KEY=", "XDG_DATA_HOME=" + dir})
	r, err := a.(core.ModelUsageReporter).GetUsageForModel(context.Background(), "any-model")
	if err != nil || r.Plan != "Max" {
		t.Fatalf("Devin used Cursor or the wrong login: %+v, %v", r, err)
	}
}

func TestQuotaFailureDoesNotExposeProviderBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte("fake-key private account details"))
	}))
	defer server.Close()
	_, err := fetchDevinUsage(context.Background(), server.Client(), devinCredentials{APIKey: "fake-key", APIServer: server.URL}, "3000.test")
	if err == nil || !strings.Contains(err.Error(), "HTTP 401") || strings.Contains(err.Error(), "private") || strings.Contains(err.Error(), "fake-key") {
		t.Fatalf("failure exposed provider body or lost HTTP status: %v", err)
	}
}
