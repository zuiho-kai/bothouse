package core

import (
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// socketUpdateRequest is what `bothouse update` sends: POST /update {"tag", "exe"} (exe "" = an
// older CLI that does not name its program).
func socketUpdateRequest(exe, tag string) *http.Request {
	body := map[string]string{"tag": tag}
	if exe != "" {
		body["exe"] = exe
	}
	b, _ := json.Marshal(body)
	return httptest.NewRequest(http.MethodPost, "/update", strings.NewReader(string(b)))
}

// withPeerExe makes the handler see exe as the peer process (ok=false: platform cannot tell).
func withPeerExe(t *testing.T, exe string, ok bool) {
	t.Helper()
	old := socketPeerExeFn
	t.Cleanup(func() { socketPeerExeFn = old })
	socketPeerExeFn = func(*http.Request) (string, bool) { return exe, ok }
}

// otherBinary is another bothouse install (an isolated test copy).
func otherBinary(t *testing.T) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "bin", "bothouse")
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte("OTHER"), 0o755); err != nil {
		t.Fatal(err)
	}
	return p
}

func socketUpdate(req *http.Request) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	handleSocketUpdate(rec, req)
	return rec
}

func TestSocketUpdate_RefusesDevBuild(t *testing.T) {
	spec, got := armFixture(t, nil)
	applied := withUpdateStubs(t, "dev", &ReleaseInfo{TagName: "v0.1.5"}, nil, nil)
	withPeerExe(t, spec.Exe, true)
	rec := socketUpdate(socketUpdateRequest(spec.Exe, "v0.1.5"))
	if rec.Code != http.StatusConflict || len(*applied) != 0 || len(*got) != 0 || len(RestartCh) != 0 {
		t.Fatalf("code %d applied %v guards %d body %s", rec.Code, *applied, len(*got), rec.Body.String())
	}
}

func TestSocketUpdate_RefusesTagNotNewer(t *testing.T) {
	spec, _ := armFixture(t, nil)
	applied := withUpdateStubs(t, "v0.1.4", &ReleaseInfo{TagName: "v0.1.5"}, nil, nil)
	withPeerExe(t, spec.Exe, true)
	for _, tag := range []string{"v0.1.4", "v0.1.3"} {
		rec := socketUpdate(socketUpdateRequest(spec.Exe, tag))
		if rec.Code != http.StatusConflict || len(*applied) != 0 {
			t.Fatalf("%s: code %d applied %v body %s", tag, rec.Code, *applied, rec.Body.String())
		}
	}
}

// The 2026-10-25 case and its variants: another program must not make this one replace itself.
// Never 404 (an older CLI would read that as "no /update" and carry on).
func TestSocketUpdate_RefusesAnotherProgram(t *testing.T) {
	spec, got := armFixture(t, nil)
	applied := withUpdateStubs(t, "v0.1.4", &ReleaseInfo{TagName: "v0.1.5"}, nil, nil)
	other := otherBinary(t)
	t.Chdir(t.TempDir())
	cases := []struct {
		name    string
		peer    string
		peerOK  bool
		bodyExe string
	}{
		{"peer is another program", other, true, ""},
		{"body names ours, peer is another (impersonation)", other, true, spec.Exe},
		{"peer is ours, body names another", spec.Exe, true, other},
		{"no peer credentials, body another program", "", false, other},
		{"no peer credentials, older CLI without exe", "", false, ""},
		{"relative peer path, no exe in body", "./bothouse", true, ""},
	}
	for _, c := range cases {
		withPeerExe(t, c.peer, c.peerOK)
		rec := socketUpdate(socketUpdateRequest(c.bodyExe, "v0.1.5"))
		if rec.Code != http.StatusForbidden {
			t.Fatalf("%s: code %d body %s", c.name, rec.Code, rec.Body.String())
		}
	}
	if len(*applied) != 0 || len(*got) != 0 || len(RestartCh) != 0 {
		t.Fatalf("refused requests still acted: applied %v guards %d", *applied, len(*got))
	}
}

// The same program passes: its own path, a PATH symlink to it, and the .old-N backup a process
// started before the last update reports; a relative peer path (macOS procargs2 for
// `./bothouse update`) falls back to the exe the CLI names.
func TestSocketUpdate_AllowsSameProgram(t *testing.T) {
	spec, _ := armFixture(t, nil)
	link := filepath.Join(t.TempDir(), "bothouse")
	if err := os.Symlink(spec.Exe, link); err != nil {
		t.Fatal(err)
	}
	t.Chdir(t.TempDir())
	cases := []struct {
		name    string
		peer    string
		peerOK  bool
		bodyExe string
	}{
		{"own path", spec.Exe, true, spec.Exe},
		{"symlink", link, true, link},
		{"backup .old-1", spec.Exe + ".old-1", true, spec.Exe},
		{"peer creds, older CLI without exe", spec.Exe, true, ""},
		{"no peer credentials, body names ours", "", false, spec.Exe},
		{"relative peer path, body names ours", "./bothouse", true, spec.Exe},
	}
	for _, c := range cases {
		applied := withUpdateStubs(t, "v0.1.4", &ReleaseInfo{TagName: "v0.1.5"}, nil, nil)
		withPeerExe(t, c.peer, c.peerOK)
		rec := socketUpdate(socketUpdateRequest(c.bodyExe, "v0.1.5"))
		if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"restarting"`) || len(*applied) != 1 {
			t.Fatalf("%s: code %d applied %v body %s", c.name, rec.Code, *applied, rec.Body.String())
		}
		takeRestart(t)
	}
}

// Over a real unix socket the server learns the peer's executable from the kernel.
func TestSocketPeerExe_RealSocket(t *testing.T) {
	if runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
		t.Skip("no peer credentials on this platform")
	}
	dir, err := os.MkdirTemp("/tmp", "bhpeer") // short path: unix socket names are capped near 104 bytes
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	sock := filepath.Join(dir, "api.sock")
	ln, err := net.Listen("unix", sock)
	if err != nil {
		t.Fatal(err)
	}
	srv := &http.Server{ConnContext: withPeerConn, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		exe, ok := socketPeerExeFn(r)
		_ = json.NewEncoder(w).Encode(map[string]any{"exe": exe, "ok": ok})
	})}
	go srv.Serve(ln)
	t.Cleanup(func() { srv.Close() })

	tr := &http.Transport{Dial: func(_, _ string) (net.Conn, error) { return net.Dial("unix", sock) }}
	resp, err := (&http.Client{Transport: tr}).Get("http://unix/peer")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var got struct {
		Exe string `json:"exe"`
		OK  bool   `json:"ok"`
	}
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("decode %q: %v", raw, err)
	}
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	if !got.OK || !SameProgram(got.Exe, self) {
		t.Fatalf("peer %+v, want %s", got, self)
	}
}

func TestSocketVersion_ReportsExe(t *testing.T) {
	spec, _ := armFixture(t, nil)
	rec := httptest.NewRecorder()
	handleSocketVersion(rec, httptest.NewRequest(http.MethodGet, "/version", nil))
	var v map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatal(err)
	}
	if v["version"] != "v0.1.4" || v["exe"] != spec.Exe {
		t.Fatalf("got %v", v)
	}
}

func TestProcExeTarget_StripsDeletedSuffix(t *testing.T) {
	cases := []struct {
		in, want string
		ok       bool
	}{
		{"/usr/local/bin/bothouse", "/usr/local/bin/bothouse", true},
		{"/usr/local/bin/bothouse (deleted)", "/usr/local/bin/bothouse", true},
		{"/opt/my app/bothouse (deleted)", "/opt/my app/bothouse", true},
		{"", "", false},
		{" (deleted)", "", false},
	}
	for _, c := range cases {
		got, ok := procExeTarget(c.in)
		if got != c.want || ok != c.ok {
			t.Errorf("procExeTarget(%q) = %q, %v; want %q, %v", c.in, got, ok, c.want, c.ok)
		}
	}
}

// An upgraded peer whose old binary was replaced reports "<path> (deleted)"; after stripping it
// must still count as the same program as the installed binary at that path.
func TestProcExeTarget_DeletedPeerIsSameProgram(t *testing.T) {
	bin := filepath.Join(t.TempDir(), "bothouse")
	if err := os.WriteFile(bin, []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}
	exe, ok := procExeTarget(bin + " (deleted)")
	if !ok || !SameProgram(exe, bin) {
		t.Fatalf("procExeTarget(%q) = %q, %v; want same program as %q", bin+" (deleted)", exe, ok, bin)
	}
}
