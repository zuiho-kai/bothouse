package core

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func autostartReq(t *testing.T, m *ManagementServer, method, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, "/api/v1/autostart", strings.NewReader(body))
	rec := httptest.NewRecorder()
	m.handleAutostart(rec, req)
	return rec
}

func TestAutostartAPISelfSwitches(t *testing.T) {
	m := NewManagementServer(0, "tok", nil)
	cur := AutostartInfo{Supervisor: "self", Platform: "launchd"}
	calls := 0
	m.SetAutostartFuncs(
		func() (AutostartInfo, error) { return cur, nil },
		func(on bool) (AutostartInfo, error) { calls++; cur.Enabled = on; return cur, nil },
	)
	if rec := autostartReq(t, m, http.MethodGet, ""); rec.Code != 200 || !strings.Contains(rec.Body.String(), `"enabled":false`) {
		t.Fatalf("GET: %d %s", rec.Code, rec.Body)
	}
	if rec := autostartReq(t, m, http.MethodPut, `{"enabled":true}`); rec.Code != 200 || !strings.Contains(rec.Body.String(), `"enabled":true`) {
		t.Fatalf("PUT on: %d %s", rec.Code, rec.Body)
	}
	if calls != 1 {
		t.Fatalf("set calls = %d, want 1", calls)
	}
	if rec := autostartReq(t, m, http.MethodPut, `{}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("PUT without enabled: %d", rec.Code)
	}
}

// An externally managed bridge (e.g. a hand-written launchd plist) must never
// reach the daemon's SetAutostart, so the panel cannot install a second service.
func TestAutostartAPIExternalRefuses(t *testing.T) {
	for _, sup := range []string{"external", "none"} {
		m := NewManagementServer(0, "tok", nil)
		called := false
		m.SetAutostartFuncs(
			func() (AutostartInfo, error) { return AutostartInfo{Supervisor: sup, Label: "com.zuiho.cc-connect"}, nil },
			func(bool) (AutostartInfo, error) { called = true; return AutostartInfo{}, nil },
		)
		rec := autostartReq(t, m, http.MethodPut, `{"enabled":true}`)
		if rec.Code != http.StatusConflict || called {
			t.Fatalf("%s: code %d, set called %v", sup, rec.Code, called)
		}
		if rec := autostartReq(t, m, http.MethodGet, ""); !strings.Contains(rec.Body.String(), `"supervisor":"`+sup+`"`) {
			t.Fatalf("%s GET: %s", sup, rec.Body)
		}
	}
}
