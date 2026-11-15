package core

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// #1434: platform addressee metadata must survive a failing gate. Ordinary
// unaddressed messages retain the configured fallback; self mentions still reply.
func TestGateFailureExternalAddressee(t *testing.T) {
	for _, status := range []int{http.StatusNotFound, http.StatusBadGateway, http.StatusServiceUnavailable} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "gate unavailable", status)
		}))
		t.Run(http.StatusText(status), func(t *testing.T) {
			g := &gateState{url: srv.URL, timeout: time.Second, fallback: "reply", gateRuntime: newGateRuntime()}
			ordinary := "reply"
			if status == http.StatusServiceUnavailable {
				ordinary = "context"
			}
			for _, tc := range []struct {
				req  gateRequest
				want string
			}{
				{gateRequest{Content: "help", Mentioned: true}, "reply"},
				{gateRequest{Content: "hello"}, ordinary},
			} {
				if got := g.decide(context.Background(), tc.req); got.Action != tc.want {
					t.Errorf("decide(%+v) = %+v, want %s", tc.req, got, tc.want)
				}
			}
		})
		srv.Close()
	}
}
