package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/tests/testutil"
)

func writeDSHLocalOwner(t *testing.T, origin, token string, pid int) {
	t.Helper()
	dir := collabDataDir()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	record := map[string]any{"pid": pid, "local": map[string]string{"origin": origin, "token": token}}
	b, err := json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "collab.owner.json"), b, 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestDSHLocalDiscoveryManagementAPI(t *testing.T) {
	testutil.SetHome(t, t.TempDir())
	var mu sync.Mutex
	var received []string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Collab-Local") != "local-secret" || r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" {
			http.Error(w, "unauthorized", 401)
			return
		}
		mu.Lock()
		received = append(received, r.Method+" "+r.URL.Path)
		mu.Unlock()
		switch r.URL.Path {
		case "/collab/api/state":
			fmt.Fprint(w, `{"rooms":[],"members":[{"id":"alice","name":"Alice","kind":"dsh","online":true}]}`)
		case "/collab/api/panel/members":
			fmt.Fprint(w, `{"members":[]}`)
		case "/collab/api/panel/members/alice":
			fmt.Fprint(w, `{"member":{"id":"alice"}}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()
	// A prior launch can leave a valid-looking URL whose host is no longer listening.
	writeProxyDSHWeb(t, "http://127.0.0.1:1/?token=old-launch")
	before, err := os.ReadFile(dshWebStatePath())
	if err != nil {
		t.Fatal(err)
	}
	writeDSHLocalOwner(t, upstream.URL, "local-secret", os.Getpid())
	m := NewManagementServer(0, "panel-secret", nil)
	for _, tc := range []struct{ method, path string }{
		{http.MethodGet, "/api/v1/dsh/summary"},
		{http.MethodGet, "/api/v1/roles"},
		{http.MethodGet, "/api/v1/dsh/members"},
		{http.MethodPost, "/api/v1/dsh/members"},
		{http.MethodPatch, "/api/v1/dsh/members/alice"},
		{http.MethodDelete, "/api/v1/dsh/members/alice"},
	} {
		req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(`{"name":"Alice"}`))
		req.Header.Set("Authorization", "Bearer panel-secret")
		rec := httptest.NewRecorder()
		m.buildHandler(http.NewServeMux()).ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: HTTP %d: %s", tc.path, rec.Code, rec.Body.String())
		}
		body := rec.Body.String()
		if strings.Contains(body, "local-secret") || strings.Contains(body, "old-launch") {
			t.Fatalf("%s leaked a connection credential", tc.path)
		}
		if (tc.path == "/api/v1/dsh/summary" || tc.path == "/api/v1/roles") && !strings.Contains(body, `"status":"running"`) {
			t.Fatalf("%s did not discover Channels: %s", tc.path, body)
		}
	}
	mu.Lock()
	defer mu.Unlock()
	if len(received) != 6 {
		t.Fatalf("upstream requests = %v, want six Channels requests without shell login", received)
	}
	after, err := os.ReadFile(dshWebStatePath())
	if err != nil || string(after) != string(before) {
		t.Fatal("Channels discovery changed the shell launch record")
	}
}

func TestDSHLocalDiscoveryRoleEvents(t *testing.T) {
	testutil.SetHome(t, t.TempDir())
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Collab-Local") != "events-secret" {
			http.Error(w, "unauthorized", 401)
			return
		}
		if r.URL.Path == "/collab/api/state" {
			fmt.Fprint(w, `{"rooms":[{"id":1,"name":"general"}],"members":[{"id":"alice","kind":"dsh","online":true}]}`)
			return
		}
		if r.URL.Path != "/collab/api/events" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"type\":\"thinking\",\"room_id\":1,\"members\":[\"alice\"]}\n\n")
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer upstream.Close()
	writeDSHLocalOwner(t, upstream.URL, "events-secret", os.Getpid())
	c, status := NewManagementServer(0, "", nil).dshClient()
	if status.Status != "running" {
		t.Fatalf("discovery status = %+v", status)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	updates := 0
	err := streamDSHRoleEvents(ctx, c, func(update dshRoleUpdate) bool {
		updates++
		if updates == 2 {
			if len(update.state.Thinking["1"]) != 1 {
				t.Error("thinking event was not applied")
			}
			cancel()
			return false
		}
		return true
	})
	if !errors.Is(err, context.Canceled) || updates != 2 {
		t.Fatalf("events returned %v after %d updates", err, updates)
	}
}

func TestDSHLocalDiscoveryRejectedCredentialIsAnError(t *testing.T) {
	testutil.SetHome(t, t.TempDir())
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, r.Header.Get("X-Collab-Local"), http.StatusUnauthorized)
	}))
	defer upstream.Close()
	writeDSHLocalOwner(t, upstream.URL, "private-token", os.Getpid())
	summary := NewManagementServer(0, "", nil).dshSummary(context.Background())
	if summary.Status != "error" || summary.Running || strings.Contains(summary.Error, "private-token") {
		t.Fatalf("unexpected summary after credential rejection: %+v", summary)
	}
}

func TestDSHLocalDiscoveryReconnectsAfterOwnerChanges(t *testing.T) {
	testutil.SetHome(t, t.TempDir())
	m := NewManagementServer(0, "", nil)
	for _, secret := range []string{"first-token", "second-token"} {
		t.Run(secret, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/collab/api/state" || r.Header.Get("X-Collab-Local") != secret {
					http.Error(w, "unauthorized", 401)
					return
				}
				fmt.Fprint(w, `{"rooms":[],"members":[]}`)
			}))
			defer upstream.Close()
			writeDSHLocalOwner(t, upstream.URL, secret, os.Getpid())
			if result := m.dshSummary(context.Background()); !result.Running {
				t.Fatalf("summary = %+v, want running after owner changed", result)
			}
		})
	}
}

func TestDSHLocalDiscoveryRejectsInvalidRecords(t *testing.T) {
	for _, tc := range []struct {
		name   string
		origin string
		token  string
		pid    int
	}{
		{"remote host", "http://203.0.113.1:1234", "secret", os.Getpid()},
		{"hostname", "http://localhost:1234", "secret", os.Getpid()},
		{"https", "https://127.0.0.1:1234", "secret", os.Getpid()},
		{"userinfo", "http://user@127.0.0.1:1234", "secret", os.Getpid()},
		{"path", "http://127.0.0.1:1234/other", "secret", os.Getpid()},
		{"query", "http://127.0.0.1:1234/?token=x", "secret", os.Getpid()},
		{"fragment", "http://127.0.0.1:1234/#channels", "secret", os.Getpid()},
		{"missing port", "http://127.0.0.1", "secret", os.Getpid()},
		{"invalid port", "http://127.0.0.1:70000", "secret", os.Getpid()},
		{"missing token", "http://127.0.0.1:1234", "", os.Getpid()},
		{"invalid header", "http://127.0.0.1:1234", "secret\r\nx: y", os.Getpid()},
		{"missing owner", "http://127.0.0.1:1234", "secret", 0},
		{"dead owner", "http://127.0.0.1:1234", "secret", 2147483647},
	} {
		t.Run(tc.name, func(t *testing.T) {
			testutil.SetHome(t, t.TempDir())
			writeDSHLocalOwner(t, tc.origin, tc.token, tc.pid)
			if _, ok := localDSHClient(http.DefaultTransport); ok {
				t.Fatal("invalid owner record was accepted")
			}
		})
	}
}

func TestDSHLocalDiscoveryLegacyFallback(t *testing.T) {
	for _, record := range []string{"", "{", `{"pid":0}`, `{"pid":1,"local":null}`} {
		t.Run(record, func(t *testing.T) {
			upstream := newProxyFakeDSH(t)
			panel := setupDSHProxyTest(t, upstream, "panel-secret")
			dir := collabDataDir()
			if err := os.MkdirAll(dir, 0o700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(dir, "collab.owner.json"), []byte(record), 0o600); err != nil {
				t.Fatal(err)
			}
			result := mgmtGet(t, panel.URL+"/api/v1/dsh/summary", "panel-secret")
			if !result.OK || !strings.Contains(string(result.Data), `"status":"running"`) {
				t.Fatalf("legacy fallback failed: %+v", result)
			}
		})
	}
}

func TestDSHLocalTransportScopesCredentials(t *testing.T) {
	testutil.SetHome(t, t.TempDir())
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/collab/api/state" || r.Header.Get("X-Collab-Local") != "secret" ||
			r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" {
			t.Error("unexpected route or credentials reached Channels")
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()
	writeDSHLocalOwner(t, upstream.URL, "secret", os.Getpid())
	c, ok := localDSHClient(http.DefaultTransport)
	if !ok {
		t.Fatal("valid local owner was rejected")
	}
	for _, target := range []string{upstream.URL + "/", "http://203.0.113.1:1234/collab/api/state"} {
		req := httptest.NewRequest(http.MethodGet, target, nil)
		if res, err := c.rt.RoundTrip(req); err == nil {
			res.Body.Close()
			t.Fatal("local credential was allowed outside its Channels host")
		}
	}
	req := httptest.NewRequest(http.MethodGet, upstream.URL+"/collab/api/state", nil)
	req.Header.Set("Authorization", "Bearer panel-secret")
	req.Header.Set("Cookie", "browser=session")
	res, err := c.rt.RoundTrip(req)
	if err != nil {
		t.Fatal(err)
	}
	io.Copy(io.Discard, res.Body)
	res.Body.Close()
	if req.Header.Get("X-Collab-Local") != "" || req.Header.Get("Cookie") != "browser=session" {
		t.Fatal("transport mutated its caller's headers")
	}
}
