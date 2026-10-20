package core

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// M3: when the gate is down, an @-mentioned bot still replies; other messages follow gate_fallback.
func TestGateFallbackMentionedReplies(t *testing.T) {
	down := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(500) }))
	down.Close() // unreachable
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(500) }))
	defer bad.Close()
	for _, url := range []string{down.URL, bad.URL} {
		g := &gateState{url: url, timeout: time.Second, fallback: "context"}
		if got := g.decide(context.Background(), gateRequest{Content: "hi", Mentioned: true}); got.Action != "reply" {
			t.Errorf("%s mentioned sub: %s", url, got.Action)
		}
		if got := g.decide(context.Background(), gateRequest{Content: "hi"}); got.Action != "context" {
			t.Errorf("%s not mentioned sub: %s", url, got.Action)
		}
		lead := &gateState{url: url, timeout: time.Second, fallback: "reply"}
		if got := lead.decide(context.Background(), gateRequest{Content: "hi"}); got.Action != "reply" {
			t.Errorf("%s fallback role: %s", url, got.Action)
		}
	}
}
