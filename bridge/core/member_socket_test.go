package core

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// withPeerUID makes the handlers see uid as the peer (ok=false: platform cannot tell).
func withPeerUID(t *testing.T, uid uint32, ok bool) {
	t.Helper()
	old := socketPeerUIDFn
	t.Cleanup(func() { socketPeerUIDFn = old })
	socketPeerUIDFn = func(*http.Request) (uint32, bool) { return uid, ok }
}

// withRunAsUID maps run_as_user name to uid, the way user.Lookup would.
func withRunAsUID(t *testing.T, name string, uid uint32) {
	t.Helper()
	old := runAsUIDFn
	t.Cleanup(func() { runAsUIDFn = old })
	runAsUIDFn = func(n string) (uint32, bool) {
		if n != name {
			return 0, false
		}
		return uid, true
	}
}

// otherMemberUID is a uid no test process runs as: whoever "another local account" is here.
const otherMemberUID = 424242

// memberAPI builds an API server with one engine, the way main does before Start.
func memberAPI(t *testing.T) (*APIServer, *Engine) {
	t.Helper()
	// Short path: a unix socket name is capped near 104 bytes, and t.TempDir lives deep under
	// /var/folders.
	dir, err := os.MkdirTemp("/tmp", "bhmember")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	s, err := NewAPIServer(dir)
	if err != nil {
		t.Fatal(err)
	}
	e := &Engine{name: "lead", dataDir: s.dataDir, adminFrom: "u-owner"}
	e.SetMemberWorkspaces(true)
	s.RegisterEngine("lead", e)
	// Start serves api.sock, member.sock and identity.sock: the real CLI dials them, so the sockets
	// must have someone accepting (a listener alone would leave the client hanging).
	s.Start()
	t.Cleanup(func() { s.Stop() })
	return s, e
}

// memberCall issues POST /member the way `bothouse member` does, optionally with a caller token.
func memberCall(s *APIServer, body MemberRequest, token string) (*httptest.ResponseRecorder, MemberResponse) {
	raw, _ := json.Marshal(body)
	r := httptest.NewRequest(http.MethodPost, "/member", bytes.NewReader(raw))
	if token != "" {
		r.Header.Set("X-Bothouse-Caller", token)
	}
	w := httptest.NewRecorder()
	s.handleMember(w, r)
	var out MemberResponse
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	return w, out
}

// A role under run_as_user now reaches /member, but only with a token the bridge signed for the turn
// it claims to be in: peer uid alone is not enough, and the token alone is not enough either.
func TestMemberSocketRequiresPeerUIDAndToken(t *testing.T) {
	fakeGH(t)
	s, e := memberAPI(t)
	authorize(t, e, "u-alice")
	e.noteCallerTurn("discord:c1", "discord", "u-alice", "alice", "c1", false, false, false)
	tok, claims, err := e.IssueCallerToken("discord:c1", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if claims.Kind != CallerHuman {
		t.Fatalf("fixture turn is %s", claims.Kind)
	}
	status := MemberRequest{Project: "lead", Session: "discord:c1", Op: "status"}

	// The role's own account, with the turn's token: allowed.
	withPeerUID(t, otherMemberUID, true)
	withRunAsUID(t, "botrole", otherMemberUID)
	e.agent = &runAsTestAgent{namedTestAgent: &namedTestAgent{name: "stub"}, runAsUser: "botrole"}
	if w, out := memberCall(s, status, tok); w.Code != 200 || out.Exit != 0 || !strings.Contains(out.Text, "个人目录") {
		t.Fatalf("role with token: %d %+v", w.Code, out)
	}
	// Same account, no token: refused (the turn record belongs to platform users, not to an account).
	if w, out := memberCall(s, status, ""); w.Code != 403 || out.Exit == 0 || !strings.Contains(out.Text, "凭证") {
		t.Fatalf("role without token: %d %+v", w.Code, out)
	}
	// A token for a different session is not this request's turn either.
	other, _, err := e.IssueCallerToken("discord:c1", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if w, out := memberCall(s, MemberRequest{Project: "lead", Session: "discord:c2", Op: "status"}, other); w.Code != 403 || out.Exit == 0 {
		t.Fatalf("token replayed into another session: %d %+v", w.Code, out)
	}
	// Some other local account is not the role.
	withPeerUID(t, otherMemberUID+1, true)
	if w, _ := memberCall(s, status, tok); w.Code != 403 {
		t.Fatalf("stranger uid let in: %d", w.Code)
	}
	// Forged token (signed by someone else) is rejected on its signature.
	stranger := &Engine{name: "lead", dataDir: t.TempDir()}
	stranger.noteCallerTurn("discord:c1", "discord", "u-alice", "alice", "c1", false, false, false)
	if _, _, err := stranger.IssueCallerToken("discord:c1", time.Now()); err != nil {
		t.Fatal(err)
	}
	forgedTok, _, _ := stranger.IssueCallerToken("discord:c1", time.Now())
	withPeerUID(t, otherMemberUID, true)
	if w, _ := memberCall(s, status, forgedTok); w.Code != 403 {
		t.Fatalf("token signed by another bridge accepted: %d", w.Code)
	}
}

// The bridge's own account keeps working exactly as before: no token needed (api.sock is 0600 and
// already in its hands).
func TestMemberSocketBridgeAccountUnchanged(t *testing.T) {
	fakeGH(t)
	s, e := memberAPI(t)
	authorize(t, e, "u-alice")
	e.noteCallerTurn("discord:c1", "discord", "u-alice", "alice", "c1", false, false, false)
	withPeerUID(t, bridgeAccountUID(), true) // the bridge's own account
	if w, out := memberCall(s, MemberRequest{Project: "lead", Session: "discord:c1", Op: "status"}, ""); w.Code != 200 || out.Exit != 0 {
		t.Fatalf("bridge account: %d %+v", w.Code, out)
	}
	// A non-human turn is still refused inside the bridge's account.
	e.noteCallerTurn("discord:c1", "discord", "u-alice", "alice", "c1", true, false, false)
	if w, out := memberCall(s, MemberRequest{Project: "lead", Session: "discord:c1", Op: "status"}, ""); w.Code != 403 || out.Exit == 0 {
		t.Fatalf("bot turn: %d %+v", w.Code, out)
	}
}

// A platform without peer credentials (Windows) has no member.sock at all: `bothouse member` falls back
// to api.sock, 0600, open to the bridge's own account alone. The caller check must not lock that caller
// out — before #618 the very same request answered 200, and after it answered 403 (#634).
func TestMemberWithoutPeerCredentialsStaysBridgeAccount(t *testing.T) {
	fakeGH(t)
	s, e := memberAPI(t)
	authorize(t, e, "u-alice")
	e.noteCallerTurn("discord:c1", "discord", "u-alice", "alice", "c1", false, false, false)

	old := memberSocketSupported
	t.Cleanup(func() { memberSocketSupported = old })
	memberSocketSupported = false
	// What unixPeerUID returns there (update_peer_uid_other.go): the kernel cannot name the peer.
	withPeerUID(t, 0, false)

	// The bridge's own account on api.sock: allowed, and it still runs as the turn's own person.
	w, out := memberCall(s, MemberRequest{Project: "lead", Session: "discord:c1", Op: "status"}, "")
	if w.Code != 200 || out.Exit != 0 || !strings.Contains(out.Text, "alice 的个人目录") {
		t.Fatalf("no peer credentials, bridge account: %d %+v", w.Code, out)
	}
	// The rest of the check is not skipped: a turn that is not a real person is still refused.
	e.noteCallerTurn("discord:c1", "discord", "u-alice", "alice", "c1", true, false, false)
	if w, out := memberCall(s, MemberRequest{Project: "lead", Session: "discord:c1", Op: "status"}, ""); w.Code != 403 || out.Exit == 0 {
		t.Fatalf("no peer credentials, bot turn: %d %+v", w.Code, out)
	}
	// Neither is the session check: no turn for this session at all is an error, not a pass.
	e.noteCallerTurn("discord:c1", "discord", "u-alice", "alice", "c1", false, false, false)
	if w, out := memberCall(s, MemberRequest{Project: "lead", Session: "discord:c2", Op: "status"}, ""); w.Code != 403 || out.Exit == 0 {
		t.Fatalf("no peer credentials, unknown session: %d %+v", w.Code, out)
	}
}

// Over a real socket the server learns the peer's uid from the kernel, so the uid check is not just a
// hook for tests.
func TestSocketPeerUID_RealSocket(t *testing.T) {
	if runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
		t.Skip("no peer credentials on this platform")
	}
	dir, err := os.MkdirTemp("/tmp", "bhuid") // short path: unix socket names are capped near 104 bytes
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	sock := filepath.Join(dir, "member.sock")
	ln, err := net.Listen("unix", sock)
	if err != nil {
		t.Fatal(err)
	}
	srv := &http.Server{ConnContext: withPeerConn, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		uid, ok := socketPeerUIDFn(r)
		_ = json.NewEncoder(w).Encode(map[string]any{"uid": uid, "ok": ok})
	})}
	go srv.Serve(ln)
	t.Cleanup(func() { srv.Close() })
	if err := os.Chmod(sock, 0o666); err != nil {
		t.Fatal(err)
	}

	tr := &http.Transport{Dial: func(_, _ string) (net.Conn, error) { return net.Dial("unix", sock) }}
	resp, err := (&http.Client{Transport: tr}).Get("http://unix/peer")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var got struct {
		UID uint32 `json:"uid"`
		OK  bool   `json:"ok"`
	}
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("decode %q: %v", raw, err)
	}
	if !got.OK || got.UID != bridgeAccountUID() {
		t.Fatalf("peer %+v, want uid %d", got, bridgeAccountUID())
	}
}

// The real `bothouse member` binary against a real bridge, on the bridge's own account: the entry point
// a single-account install uses is unchanged (api.sock is open to it, and it now also has member.sock).
// Opt-in because it builds the binary: BH_CLI_E2E=1 go test -run TestMemberCLIBinary ./core
// testCLIWait bounds one real-CLI call in this file: 来源 — a local `member status` answers in
// milliseconds, so anything near this is a hang, and the test should say so instead of timing out as a
// whole (the first run of TestMemberCLIBinary sat for `go test`'s default 10 minutes).
const testCLIWait = 60 * time.Second

func TestMemberCLIBinary(t *testing.T) {
	if os.Getenv("BH_CLI_E2E") == "" {
		t.Skip("set BH_CLI_E2E=1 to build bothouse and drive the real CLI")
	}
	fakeGH(t)
	s, e := memberAPI(t)
	authorize(t, e, "u-alice")
	e.noteCallerTurn("discord:c1", "discord", "u-alice", "alice", "c1", false, false, false)

	// BH_CLI_BIN names a binary built beforehand (the build takes minutes on a cold cache and a test
	// binary's own build step should not compete with the suite).
	bin := os.Getenv("BH_CLI_BIN")
	if bin == "" {
		bin = filepath.Join(t.TempDir(), "bothouse")
		if out, err := exec.Command("go", "build", "-tags", "no_web", "-o", bin, "github.com/chenhg5/cc-connect/cmd/cc-connect").CombinedOutput(); err != nil {
			t.Fatalf("build bothouse: %s %v", out, err)
		}
	}
	run := func(args ...string) (string, string, int) {
		// Bounded wait: a CLI that connects and then waits forever must fail here with the command and
		// its output, not sit until `go test`'s 10-minute panic (that is how the first run of this test
		// reported nothing useful). testCLIWait is far past a local `member status`, which answers at once.
		ctx, cancel := context.WithTimeout(context.Background(), testCLIWait)
		defer cancel()
		cmd := exec.CommandContext(ctx, bin, args...)
		cmd.Env = append(os.Environ(), "CC_PROJECT=lead", "CC_SESSION_KEY=discord:c1", "CC_DATA_DIR="+s.dataDir)
		// WaitDelay keeps the timeout from leaving an orphan CLI holding the pipe.
		cmd.WaitDelay = 5 * time.Second
		var out, errOut strings.Builder
		cmd.Stdout, cmd.Stderr = &out, &errOut
		err := cmd.Run()
		if ctx.Err() == context.DeadlineExceeded {
			t.Fatalf("$ bothouse %s hung for %s (bridge did not answer)\n%s%s", strings.Join(args, " "), testCLIWait, out.String(), errOut.String())
		}
		code := 0
		if err != nil {
			code = 1
			if ee, ok := err.(*exec.ExitError); ok {
				code = ee.ExitCode()
			}
		}
		t.Logf("$ bothouse %s\n%s%s(exit %d)", strings.Join(args, " "), out.String(), errOut.String(), code)
		return out.String(), errOut.String(), code
	}
	out, errOut, code := run("member", "status")
	if code != 0 || !strings.Contains(out, "个人目录") || !strings.Contains(out, "gh-u-alice") {
		t.Fatalf("member status: %s%s", out, errOut)
	}
	out, errOut, code = run("member", "gh", "auth", "status")
	if code != 0 || !strings.Contains(out, "GH_CONFIG_DIR=") || strings.Contains(out, "shared-token") {
		t.Fatalf("member gh: %s%s", out, errOut)
	}
}
