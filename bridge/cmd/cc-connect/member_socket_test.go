package main

// #618: `bothouse member` must reach the bridge from a role that runs under run_as_user, where api.sock
// (0600) is out of reach. This drives the real CLI path — memberPost, the socket it picks, the caller
// token it attaches — against a real bridge socket, without going through os.Exit.

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

type memberCLIAgent struct{ user string }

func (a *memberCLIAgent) Name() string { return "stub" }
func (a *memberCLIAgent) StartSession(_ context.Context, _ string) (core.AgentSession, error) {
	return &handoffCLISession{}, nil
}
func (a *memberCLIAgent) ListSessions(_ context.Context) ([]core.AgentSessionInfo, error) {
	return nil, nil
}
func (a *memberCLIAgent) Stop() error          { return nil }
func (a *memberCLIAgent) GetRunAsUser() string { return a.user }

// memberFixture: a real bridge on a short-path data dir, one project, member workspaces on.
func memberFixture(t *testing.T) (string, *core.APIServer) {
	t.Helper()
	dir, err := os.MkdirTemp("/tmp", "bhmcli") // unix socket names are capped near 104 bytes
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	t.Setenv("CC_DATA_DIR", dir)
	t.Setenv("CC_PROJECT", "lead")
	t.Setenv("CC_SESSION_KEY", "discord:c1")

	e := core.NewEngine("lead", &memberCLIAgent{}, nil, "", core.LangChinese)
	e.SetDataDir(dir)
	e.SetMemberWorkspaces(true)
	s, err := core.NewAPIServer(dir)
	if err != nil {
		t.Fatal(err)
	}
	s.RegisterEngine("lead", e)
	s.Start()
	t.Cleanup(s.Stop)
	time.Sleep(20 * time.Millisecond)
	return dir, s
}

// memberStatus runs one `bothouse member status` request through the CLI's own transport and returns
// the bridge's status code and body.
func memberStatus(t *testing.T, project, session string) (int, string) {
	t.Helper()
	body, _ := json.Marshal(core.MemberRequest{Project: project, Session: session, Op: "status"})
	resp, _, err := memberPost(project, session, body)
	if err != nil {
		t.Fatalf("memberPost: %v", err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(b)
}

// The CLI talks to member.sock, which sits next to api.sock, and does not need api.sock at all: with
// api.sock made unconnectable (0000) the request still reaches the bridge's member handler.
func TestMemberCLIUsesMemberSocket(t *testing.T) {
	dir, _ := memberFixture(t)
	fi, err := os.Stat(core.MemberSocketPath(dir))
	if err != nil || fi.Mode().Perm() != 0o666 {
		t.Fatalf("member.sock: %v %v, want 0666", fi, err)
	}
	api := resolveSocketPath(dir)
	if err := os.Chmod(api, 0o000); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(api, 0o600) })

	code, out := memberStatus(t, "lead", "discord:c1")
	// No turn record here (this is not a bot turn), so the bridge refuses — but it refuses from
	// handleMember, which is what proves the request got in over member.sock. The bridge's own account
	// is trusted without a token, so the refusal is the turn one, not the credential one.
	if code != 403 || !strings.Contains(out, "一轮对话") {
		t.Fatalf("status over member.sock: %d %s", code, out)
	}
}

// A bridge started without member.sock (an older binary, or the socket gone) still answers on api.sock,
// which the bridge's own account — the ordinary single-account install — opens as before.
func TestMemberCLIFallsBackToAPISocket(t *testing.T) {
	dir, _ := memberFixture(t)
	if err := os.Remove(core.MemberSocketPath(dir)); err != nil {
		t.Fatal(err)
	}
	code, out := memberStatus(t, "lead", "discord:c1")
	if code != 403 || !strings.Contains(out, "一轮对话") {
		t.Fatalf("fallback to api.sock: %d %s", code, out)
	}
}
