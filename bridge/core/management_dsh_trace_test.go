package core

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

type dshTraceLog struct {
	mu sync.Mutex
	bytes.Buffer
}

func (b *dshTraceLog) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.Buffer.Write(p)
}

func (b *dshTraceLog) text() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.Buffer.String()
}

func captureDSHTrace(t *testing.T) *dshTraceLog {
	t.Helper()
	logs := &dshTraceLog{}
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(logs, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })
	return logs
}

// The real management handlers fail before any configure/open side effects.
// A socket request keeps the caller's id on both handler boundaries and joins
// it to the server connection lifecycle; neither auth nor payload enters logs.
func TestManagementDSHTraceRealHTTPFailures(t *testing.T) {
	logs := captureDSHTrace(t)
	m := NewManagementServer(0, "synthetic-auth-secret", nil)
	server := httptest.NewUnstartedServer(m.buildHandler(http.NewServeMux()))
	observeManagementConnections(server.Config)
	server.Start()
	defer server.Close()
	for _, tc := range []struct {
		path, method, body, id string
		want                   int
	}{
		{"/setup/dsh/configure", http.MethodPost, "{synthetic-body-secret", "configure-1-a1b2c3", http.StatusBadRequest},
		{"/setup/dsh/open", http.MethodGet, "", "open-1-d4e5f6", http.StatusMethodNotAllowed},
	} {
		req, err := http.NewRequest(tc.method, server.URL+"/api/v1"+tc.path+"?token=synthetic-query-secret", strings.NewReader(tc.body))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", "Bearer synthetic-auth-secret")
		req.Header.Set("X-Bothouse-Request-Id", tc.id)
		req.Header.Set("X-Request-Id", "wrong-gateway-id")
		res, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(res.Body)
		res.Body.Close()
		if err != nil || res.StatusCode != tc.want || !bytes.Contains(body, []byte(`"ok":false`)) {
			t.Fatalf("HTTP %d body=%s err=%v", res.StatusCode, body, err)
		}
		text := logs.text()
		if strings.Count(text, "request_id="+tc.id) != 2 || !strings.Contains(text, "management dsh request started") || !strings.Contains(text, "management dsh request ended") || !strings.Contains(text, "connection=0x") {
			t.Fatalf("missing correlated handler boundaries: %s", text)
		}
	}
	server.CloseClientConnections()
	server.Close()
	text := logs.text()
	if !strings.Contains(text, "management api connection state") || !strings.Contains(text, "state=active") {
		t.Fatalf("missing connection lifecycle: %s", text)
	}
	for _, secret := range []string{"synthetic-auth-secret", "synthetic-query-secret", "synthetic-body-secret", "wrong-gateway-id"} {
		if strings.Contains(text, secret) {
			t.Fatalf("trace leaked %s", secret)
		}
	}
}

type failingDSHTraceWriter struct{ httptest.ResponseRecorder }

func (*failingDSHTraceWriter) Write([]byte) (int, error) {
	return 0, errors.New("synthetic broken pipe")
}

func TestManagementDSHTraceWriteFailureAndLegacyHeader(t *testing.T) {
	logs := captureDSHTrace(t)
	m := NewManagementServer(0, "", nil)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/setup/dsh/configure", nil)
	req.Header.Set("X-Request-Id", "legacy-1-abcdef")
	w := &failingDSHTraceWriter{*httptest.NewRecorder()}
	m.buildHandler(http.NewServeMux()).ServeHTTP(w, req)
	text := logs.text()
	if !strings.Contains(text, "management dsh response write failed") || strings.Count(text, "request_id=legacy-1-abcdef") != 3 {
		t.Fatalf("write failure lost correlation: %s", text)
	}
	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status changed: %d", w.Code)
	}
}

func TestManagementDSHTracePreservesConnectionCallbacks(t *testing.T) {
	type callerKey struct{}
	called := false
	server := &http.Server{
		ConnContext: func(ctx context.Context, _ net.Conn) context.Context {
			return context.WithValue(ctx, callerKey{}, true)
		},
		ConnState: func(net.Conn, http.ConnState) { called = true },
	}
	left, right := net.Pipe()
	defer left.Close()
	defer right.Close()
	observeManagementConnections(server)
	ctx := server.ConnContext(context.Background(), left)
	server.ConnState(left, http.StateNew)
	if ctx.Value(callerKey{}) != true || ctx.Value(managementConnectionKey{}) == nil || !called {
		t.Fatal("connection instrumentation replaced existing callbacks")
	}
}

func TestManagementDSHTracePreservesSuccessAndRejectsTokenURLID(t *testing.T) {
	logs := captureDSHTrace(t)
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mgmtJSON(w, http.StatusOK, map[string]string{"result": "unchanged"})
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/setup/dsh/configure", nil)
	req.Header.Set("X-Bothouse-Request-Id", "http://localhost/login?token=synthetic-id-secret")
	plain, traced := httptest.NewRecorder(), httptest.NewRecorder()
	handler.ServeHTTP(plain, req)
	traceDSHRequest(handler).ServeHTTP(traced, req)
	if plain.Code != traced.Code || plain.Body.String() != traced.Body.String() || plain.Header().Get("Content-Type") != traced.Header().Get("Content-Type") {
		t.Fatal("request tracing changed the normal response")
	}
	if strings.Contains(logs.text(), "synthetic-id-secret") || !strings.Contains(logs.text(), `request_id=""`) {
		t.Fatalf("unsafe id entered the trace: %s", logs.text())
	}
}
