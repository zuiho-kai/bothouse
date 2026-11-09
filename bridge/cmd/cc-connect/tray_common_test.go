package main

import (
	"fmt"
	"github.com/chenhg5/cc-connect/core"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTrayClientDecodesManagementEnvelope(t *testing.T) {
	for _, tc := range []struct {
		name, body string
	}{
		{"status", `{"ok":true,"data":{"projects_count":5}}`},
		{"usage", `{"ok":true,"data":{"items":[{"total_tokens":12345}]}}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer test-secret" {
					t.Error("missing authorization")
				}
				fmt.Fprint(w, tc.body)
			}))
			defer s.Close()
			var got struct {
				Projects int `json:"projects_count"`
				Items    []struct {
					Total int64 `json:"total_tokens"`
				} `json:"items"`
			}
			if err := (trayClient{base: s.URL, token: "test-secret"}).get("/api/v1/"+tc.name, &got); err != nil {
				t.Fatal(err)
			}
			if tc.name == "status" && got.Projects != 5 {
				t.Fatalf("projects = %d, want 5", got.Projects)
			}
			if tc.name == "usage" && (len(got.Items) != 1 || got.Items[0].Total != 12345) {
				t.Fatalf("usage = %+v, want 12345 tokens", got.Items)
			}
		})
	}
}

func TestTrayUsageLabelPreservesUnknownAndPartialCost(t *testing.T) {
	cost := 0.5
	for _, tc := range []struct {
		name  string
		items []core.UsageAggregate
		want  string
	}{
		{"empty", nil, "今日用量：0 M tokens"},
		{"reported zero", []core.UsageAggregate{{Responses: 1}}, "今日用量：0 M tokens"},
		{"unknown", []core.UsageAggregate{{Responses: 1, Unknown: 1}}, "今日用量：已知 0 M tokens（1 次未完整报告）"},
		{"partial", []core.UsageAggregate{{Total: 42, Unknown: 1, Unpriced: 1, EstimatedCost: &cost}}, "今日用量：已知 0.00 M tokens（1 次未完整报告） · 部分估算 $0.50"},
		{"sum", []core.UsageAggregate{{Total: 40}, {Total: 2, EstimatedCost: &cost}}, "今日用量：0.00 M tokens · 估算 $0.50"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := trayUsageLabel(tc.items); got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestTrayClientPreservesHTTPAndDecodeErrors(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		code       int
		want       string
	}{
		{"unauthorized", `{"ok":false}`, http.StatusUnauthorized, "HTTP 401"},
		{"invalid json", "{", http.StatusOK, "decode management response"},
		{"invalid data", `{"ok":true,"data":{"projects_count":"bad"}}`, http.StatusOK, "cannot unmarshal"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(tc.code); fmt.Fprint(w, tc.body) }))
			defer s.Close()
			var got struct {
				Projects int `json:"projects_count"`
			}
			err := (trayClient{base: s.URL}).get("/api/v1/status", &got)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error=%v, want %q", err, tc.want)
			}
		})
	}
}

func TestTrayClientRejectsInvalidManagementEnvelope(t *testing.T) {
	for _, body := range []string{
		`{"ok":false,"error":"unavailable"}`,
		`{"ok":true}`,
		`{"ok":true,"data":null}`,
		`{"projects_count":5}`,
	} {
		t.Run(body, func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, body) }))
			defer s.Close()
			var got struct {
				Projects int `json:"projects_count"`
			}
			if err := (trayClient{base: s.URL}).get("/api/v1/status", &got); err == nil {
				t.Fatal("invalid response was accepted as zero")
			}
		})
	}
}

func TestTrayRolesTitleSkipsDSHMembers(t *testing.T) {
	// The panel's GlobalSettings.tsx:153 filters `source !== 'dsh'`; the tray 「角色：」 line follows it.
	// Five DSH rows on top of the five bridge roles pushed the title to 112 runes (#1095 regression):
	// 「角色：cjiang 在线、gge 在线、cursor 在线、gjiang 在线、deep 在线、dsh:cj…」
	bridge := []trayRole{
		{Name: "cjiang", Online: true},
		{Name: "gge", Online: true},
		{Name: "cursor", Online: true},
		{Name: "gjiang", Online: true},
		{Name: "deep", Online: true},
	}
	dsh := []trayRole{
		{Name: "dsh:cjiang", Online: true, Source: "dsh"},
		{Name: "dsh:gge", Online: true, Source: "dsh"},
		{Name: "dsh:cursor", Online: false, Source: "dsh"},
		{Name: "dsh:gjiang", Online: true, Source: "dsh"},
		{Name: "dsh:deep", Online: true, Source: "dsh"},
	}
	mixed := append(append([]trayRole{}, bridge...), dsh...)
	want := "角色：cjiang 在线、gge 在线、cursor 在线、gjiang 在线、deep 在线"
	for _, tc := range []struct {
		name  string
		roles []trayRole
		want  string
	}{
		{"bridge only", bridge, want},
		{"dsh rows after bridge", mixed, want},
		{"dsh rows only", dsh, "角色："},
		{"no roles", nil, "角色："},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := trayRolesTitle(tc.roles)
			if got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
			if n := len([]rune(got)); n > 55 {
				t.Fatalf("%d runes, want <= 55: %q", n, got)
			}
			if strings.Contains(got, "dsh:") {
				t.Fatalf("DSH member leaked into the tray title: %q", got)
			}
		})
	}
}

func TestTrayMissingFieldsDoNotDisplayZero(t *testing.T) {
	for _, tc := range []struct{ body, status, usage string }{
		{`{}`, "运行状态：读取失败", "今日用量：读取失败"},
		{`{"projects_count":null,"items":null}`, "运行状态：读取失败", "今日用量：读取失败"},
		{`{"projects_count":0,"items":[]}`, "运行状态：运行中（已加载 0 个角色）", "今日用量：0 M tokens"},
		{`{"projects_count":5,"items":[{"total_tokens":42}]}`, "运行状态：运行中（已加载 5 个角色）", "今日用量：0.00 M tokens"},
	} {
		t.Run(tc.body, func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprintf(w, `{"ok":true,"data":%s}`, tc.body) }))
			defer s.Close()
			c := trayClient{base: s.URL}
			if got := c.statusLabel(); got != tc.status {
				t.Errorf("status=%q, want %q", got, tc.status)
			}
			if got := c.usageLabel("2026-10-30"); got != tc.usage {
				t.Errorf("usage=%q, want %q", got, tc.usage)
			}
		})
	}
}

// Same rule as the Usage page's M unit (web/src/store/usageSettings.ts formatToken).
func TestTrayTokensM(t *testing.T) {
	for _, tc := range []struct {
		in   int64
		want string
	}{
		{0, "0 M"},
		{12345, "0.01 M"},
		{1_500_000, "1.50 M"},
		{99_994_999, "99.99 M"},
		{1_174_406_688, "1174.4 M"},
	} {
		if got := trayTokensM(tc.in); got != tc.want {
			t.Errorf("trayTokensM(%d) = %q, want %q", tc.in, got, tc.want)
		}
	}
	got := trayUsageLabel([]core.UsageAggregate{{Total: 1_174_406_688}})
	if got != "今日用量：1174.4 M tokens" {
		t.Fatalf("label = %q", got)
	}
}

// Each info row opens its own panel page (routes in web/src/App.tsx).
func TestTrayPagesMatchPanelRoutes(t *testing.T) {
	c := trayClient{base: "http://127.0.0.1:9820", token: "tk"}
	for _, tc := range []struct{ page, want string }{
		{trayPageStatus, "next=%2F"},
		{trayPageRoles, "next=%2Froles"},
		{trayPageUsage, "next=%2Fusage"},
		{trayPageUpdate, "next=%2F"},
	} {
		if got := c.loginURL(tc.page); !strings.HasSuffix(got, tc.want) {
			t.Errorf("loginURL(%q) = %q, want suffix %q", tc.page, got, tc.want)
		}
	}
}
