//go:build darwin || windows

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
		{"empty", nil, "今日用量：0 tokens"},
		{"reported zero", []core.UsageAggregate{{Responses: 1}}, "今日用量：0 tokens"},
		{"unknown", []core.UsageAggregate{{Responses: 1, Unknown: 1}}, "今日用量：已知 0 tokens（1 次未完整报告）"},
		{"partial", []core.UsageAggregate{{Total: 42, Unknown: 1, Unpriced: 1, EstimatedCost: &cost}}, "今日用量：已知 42 tokens（1 次未完整报告） · 部分估算 $0.50"},
		{"sum", []core.UsageAggregate{{Total: 40}, {Total: 2, EstimatedCost: &cost}}, "今日用量：42 tokens · 估算 $0.50"},
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
