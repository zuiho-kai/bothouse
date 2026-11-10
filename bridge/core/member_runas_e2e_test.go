//go:build linux && runase2e

package core

// Opt-in end-to-end check of member isolation under run_as_user (#1359), on a real Linux box:
// the bridge user owns the member directories, the role runs as another OS user through sudo, and
// the kernel — not a prompt — refuses one member's turn reading another member's credentials.
//
// Needs: the test runs as the bridge's OS user; BH_E2E_ROLE_USER names the role's OS user and the
// bridge user may `sudo -n -iu <role>` without a password; real gh and git on PATH; BH_E2E_ROLE_CWD a
// directory the role user owns. Build: go test -c -tags runase2e ./core ; run the binary with
// -test.run TestMemberRunAsE2E -test.v.

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

type memberE2EAgent struct {
	Agent
	user string
}

func (a memberE2EAgent) GetRunAsUser() string { return a.user }

func TestMemberRunAsE2E(t *testing.T) {
	role, roleCwd := os.Getenv("BH_E2E_ROLE_USER"), os.Getenv("BH_E2E_ROLE_CWD")
	if role == "" || roleCwd == "" {
		t.Skip("BH_E2E_ROLE_USER / BH_E2E_ROLE_CWD not set")
	}
	data := os.Getenv("BH_E2E_DATA")
	if data == "" {
		data = t.TempDir()
	}
	e := &Engine{name: "lead", dataDir: data, adminFrom: "u-owner", agent: memberE2EAgent{user: role}}
	e.SetMemberWorkspaces(true)
	ctx := context.Background()

	// Both members joined and finished their own device login (fake tokens; gh stores them in hosts.yml).
	dirs := map[string]string{}
	for _, u := range []string{"alice", "bob"} {
		dir, created, err := ensureMemberDir(data, "discord", "u-"+u, u)
		if err != nil || !created {
			t.Fatalf("join %s: created=%v err=%v", u, created, err)
		}
		hosts := "github.com:\n    oauth_token: gho_FAKE_" + u + "_token\n    user: gh-" + u + "\n    git_protocol: https\n"
		if err := os.WriteFile(filepath.Join(dir, ".gh-config", "hosts.yml"), []byte(hosts), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := writeMemberGitHubRecord(dir, memberAuthorizedYes, "gh-"+u, "e2e"); err != nil {
			t.Fatal(err)
		}
		dirs[u] = dir
		t.Logf("joined %s -> %s", u, dir)
	}
	bobHosts := filepath.Join(dirs["bob"], ".gh-config", "hosts.yml")

	// 1. The role process itself (what a turn's shell runs as) opens bob's credentials: kernel says no.
	out, err := exec.Command("sudo", "-n", "-iu", role, "cat", bobHosts).CombinedOutput()
	t.Logf("$ sudo -n -iu %s cat %s\n%s(err=%v)", role, bobHosts, out, err)
	if err == nil || !strings.Contains(string(out), "Permission denied") {
		t.Fatalf("role read bob's credentials: %s", out)
	}
	out, err = exec.Command("sudo", "-n", "-iu", role, "ls", dirs["alice"]).CombinedOutput()
	t.Logf("$ sudo -n -iu %s ls %s\n%s(err=%v)", role, dirs["alice"], out, err)
	if err == nil {
		t.Fatalf("role listed alice's directory: %s", out)
	}

	// 2. alice's turn: member git runs as the role user, carrying only alice's token.
	e.noteCallerTurn("discord:c1", "discord", "u-alice", "alice", "c1", false, false, false)
	who := MemberRequest{Session: "discord:c1", Op: "git", Cwd: roleCwd,
		Args: []string{"-c", `alias.whoami=!id -un; echo "token=$GH_TOKEN"`, "whoami"}}
	resp, st := e.memberOp(ctx, who)
	t.Logf("alice: bothouse member git whoami -> status=%d exit=%d\n%s%s", st, resp.Exit, resp.Stdout, resp.Stderr)
	if resp.Exit != 0 || !strings.Contains(resp.Stdout, role+"\n") || !strings.Contains(resp.Stdout, "token=gho_FAKE_alice_token") ||
		strings.Contains(resp.Stdout, "bob") {
		t.Fatalf("alice's git did not run as %s with alice's token: %+v", role, resp)
	}

	// 3. alice's turn tries bob's credentials through the bridge's own command: kernel says no.
	resp, st = e.memberOp(ctx, MemberRequest{Session: "discord:c1", Op: "git", Cwd: roleCwd,
		Args: []string{"diff", "--no-index", bobHosts, "/dev/null"}})
	t.Logf("alice: bothouse member git diff --no-index %s /dev/null -> status=%d exit=%d\n%s%s", bobHosts, st, resp.Exit, resp.Stdout, resp.Stderr)
	if resp.Exit == 0 || strings.Contains(resp.Stdout, "gho_FAKE_bob") || !strings.Contains(resp.Stderr, "Could not access") {
		t.Fatalf("alice's turn read bob's credentials: %+v", resp)
	}
	resp, st = e.memberOp(ctx, MemberRequest{Session: "discord:c1", Op: "git", Cwd: roleCwd,
		Args: []string{"-c", "alias.peek=!cat " + bobHosts, "peek"}})
	t.Logf("alice: bothouse member git -c 'alias.peek=!cat %s' peek -> status=%d exit=%d\n%s%s", bobHosts, st, resp.Exit, resp.Stdout, resp.Stderr)
	if resp.Exit == 0 || strings.Contains(resp.Stdout, "gho_FAKE_bob") || !strings.Contains(resp.Stderr, "Permission denied") {
		t.Fatalf("alice's turn read bob's credentials through a git alias: %+v", resp)
	}

	// 4. Files go through the bridge: alice puts one, the role cannot open it directly, bob cannot get it.
	src := filepath.Join(roleCwd, "report.txt")
	if out, err := exec.Command("sudo", "-n", "-iu", role, "sh", "-c", "echo alice-report > "+src).CombinedOutput(); err != nil {
		t.Fatalf("write as role: %s %v", out, err)
	}
	resp, _ = e.memberOp(ctx, MemberRequest{Session: "discord:c1", Op: "put", Cwd: roleCwd, Args: []string{src}})
	t.Logf("alice: bothouse member put report.txt -> %s", resp.Text)
	if resp.Exit != 0 {
		t.Fatalf("put: %+v", resp)
	}
	stored := filepath.Join(dirs["alice"], "files", "report.txt")
	out, err = exec.Command("sudo", "-n", "-iu", role, "cat", stored).CombinedOutput()
	t.Logf("$ sudo -n -iu %s cat %s\n%s(err=%v)", role, stored, out, err)
	if err == nil {
		t.Fatalf("role read alice's file directly: %s", out)
	}
	resp, _ = e.memberOp(ctx, MemberRequest{Session: "discord:c1", Op: "get", Cwd: roleCwd, Args: []string{"report.txt", "back.txt"}})
	got, _ := exec.Command("sudo", "-n", "-iu", role, "sh", "-c", "stat -c '%U %a' "+filepath.Join(roleCwd, "back.txt")+"; cat "+filepath.Join(roleCwd, "back.txt")).CombinedOutput()
	t.Logf("alice: bothouse member get report.txt back.txt -> %s\n%s", resp.Text, got)
	if resp.Exit != 0 || !strings.Contains(string(got), role) || !strings.Contains(string(got), "alice-report") {
		t.Fatalf("get: %+v %s", resp, got)
	}

	e.noteCallerTurn("discord:c1", "discord", "u-bob", "bob", "c1", false, false, false)
	resp, _ = e.memberOp(ctx, MemberRequest{Session: "discord:c1", Op: "get", Cwd: roleCwd, Args: []string{"report.txt"}})
	t.Logf("bob: bothouse member get report.txt -> exit=%d %s", resp.Exit, resp.Text)
	if resp.Exit == 0 {
		t.Fatalf("bob got alice's file: %+v", resp)
	}
	resp, _ = e.memberOp(ctx, who)
	t.Logf("bob: bothouse member git whoami -> exit=%d\n%s", resp.Exit, resp.Stdout)
	if resp.Exit != 0 || !strings.Contains(resp.Stdout, "token=gho_FAKE_bob_token") || strings.Contains(resp.Stdout, "alice") {
		t.Fatalf("bob's git did not carry bob's token: %+v", resp)
	}
}
