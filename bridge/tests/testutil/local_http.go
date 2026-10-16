// Package testutil contains helpers for isolated bridge tests.
package testutil

import (
	"fmt"
	"net"
	"net/http"
	"os"
	"sync/atomic"
	"testing"
)

type localTransport struct {
	base     http.RoundTripper
	rejected atomic.Int64
}

func (t *localTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	ip := net.ParseIP(req.URL.Hostname())
	if ip == nil || !ip.IsLoopback() {
		t.rejected.Add(1)
		err := fmt.Errorf("test attempted external HTTP request: %s %s", req.Method, req.URL.Host)
		fmt.Fprintln(os.Stderr, err)
		return nil, err
	}
	return t.base.RoundTrip(req)
}

// RunLocalHTTPTests keeps default-client requests inside loopback fixtures. An
// attempted external request fails the suite even if application code handles
// the returned error. No DNS query or connection is made for rejected hosts.
func RunLocalHTTPTests(m *testing.M) int {
	original := http.DefaultTransport
	base := original.(*http.Transport).Clone()
	base.Proxy = nil
	guard := &localTransport{base: base}
	http.DefaultTransport = guard
	defer func() { http.DefaultTransport = original; base.CloseIdleConnections() }()
	code := m.Run()
	if guard.rejected.Load() != 0 {
		return 1
	}
	return code
}
