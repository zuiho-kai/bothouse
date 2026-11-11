//go:build linux && runase2e

package core

// Opt-in end-to-end check of member isolation under run_as_user (#1359, #618), on a real Linux box:
// the bridge user owns the member directories, the role runs as another OS user through sudo, and the
// kernel — not a prompt — refuses one member's turn reading another member's credentials.
//
// #618 adds the part the first version could not test: `bothouse member` is now reachable from the role
// account. The test therefore drives the real CLI, as the role user:
//
//	sudo -n -iu <role> --preserve-env=CC_PROJECT,CC_SESSION_KEY,CC_DATA_DIR -- <bothouse> member status
//
// The CLI fetches a caller token over identity.sock (0666) and posts it to member.sock, which checks the
// peer uid and the signature; api.sock (0600, full control) stays closed to the role.
//
// Needs: the test runs as the bridge's OS user; BH_E2E_ROLE_USER names the role's OS user and the
// bridge user may `sudo -n -iu <role>` without a password; real gh and git on PATH; BH_E2E_ROLE_CWD a
// directory the role user owns. Build: go test -c -tags 'linux runase2e' ./core ; run the binary with
// -test.run TestMemberRunAsE2E -test.v.

import (
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

// roleRun runs argv as the role user with the turn's session env, exactly as a role's shell would.
func roleRun(t *testing.T, role, bin string, env []string, args ...string) (string, string, int) {
	t.Helper()
	sudo := []string{"-n", "-iu", role, "--preserve-env=CC_PROJECT,CC_SESSION_KEY,CC_DATA_DIR"}
	sudo = append(sudo, "--")
	cmd := exec.Command("sudo", append(sudo, append([]string{bin}, args...)...)...)
	cmd.Env = append(os.Environ(), env...)
	var out, errOut strings.Builder
	cmd.Stdout, cmd.Stderr = &out, &errOut
	err := cmd.Run()
	code := 0
	if err != nil {
		code = 1
		if ee, ok := err.(*exec.ExitError); ok {
			code = ee.ExitCode()
		} else {
			errOut.WriteString(err.Error())
		}
	}
	t.Logf("$ sudo -n -iu %s --preserve-env=CC_PROJECT,CC_SESSION_KEY,CC_DATA_DIR -- %s %s\n%s%s(exit %d)",
		role, bin, strings.Join(args, " "), out.String(), errOut.String(), code)
	return out.String(), errOut.String(), code
}

// roleScript writes a small script the role user owns and can execute, for git aliases: sudo -i
// re-splits its command string, so aliases can only carry single-word arguments.
func roleScript(t *testing.T, role, dir, name, body string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	cmd := exec.Command("sudo", "-n", "-iu", role, "sh", "-c", "cat > "+path+" && chmod 700 "+path)
	cmd.Stdin = strings.NewReader(body)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("write %s: %s %v", path, out, err)
	}
	return path
}

func TestMemberRunAsE2E(t *testing.T) {
	role, roleCwd := os.Getenv("BH_E2E_ROLE_USER"), os.Getenv("BH_E2E_ROLE_CWD")
	if role == "" || roleCwd == "" {
		t.Skip("BH_E2E_ROLE_USER / BH_E2E_ROLE_CWD not set")
	}
	data := os.Getenv("BH_E2E_DATA")
	if data == "" {
		// Short path: a unix socket name is capped near 104 bytes.
		d, err := os.MkdirTemp("/tmp", "bhe2e")
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { os.RemoveAll(d) })
		data = d
	}
	// The role has to traverse the data dir to reach identity.sock; the member directories under it
	// stay 0700 and belong to the bridge.
	if err := os.Chmod(data, 0o755); err != nil {
		t.Fatal(err)
	}

	// The real binary, world-executable so sudo -iu can start it: BH_E2E_BIN names one built elsewhere
	// (a Linux VM without the Go toolchain), otherwise it is built here.
	binDir, err := os.MkdirTemp("/tmp", "bhe2ebin")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(binDir) })
	if err := os.Chmod(binDir, 0o755); err != nil {
		t.Fatal(err)
	}
	bin := filepath.Join(binDir, "bothouse")
	if pre := os.Getenv("BH_E2E_BIN"); pre != "" {
		b, err := os.ReadFile(pre)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(bin, b, 0o755); err != nil {
			t.Fatal(err)
		}
	} else if out, err := exec.Command("go", "build", "-tags", "no_web", "-o", bin, "./cmd/cc-connect").CombinedOutput(); err != nil {
		t.Fatalf("build bothouse: %s %v", out, err)
	}
	if err := os.Chmod(bin, 0o755); err != nil {
		t.Fatal(err)
	}

	s, err := NewAPIServer(data)
	if err != nil {
		t.Fatal(err)
	}
	e := &Engine{name: "lead", dataDir: data, adminFrom: "u-owner", agent: memberE2EAgent{user: role}}
	e.SetMemberWorkspaces(true)
	s.RegisterEngine("lead", e)
	s.Start()
	t.Cleanup(s.Stop)

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

	// 0. The sockets are what docs/MEMBER_WORKSPACES.md promises: api.sock 0600 (bridge only),
	// member.sock + identity.sock reachable by the role. Checked as the role itself.
	out, _, code := roleRun(t, role, "/bin/sh", nil, "-c",
		"stat -c '%a %U' "+filepath.Join(data, "run", "api.sock")+" "+MemberSocketPath(data)+" "+IdentitySocketPath(data)+
			"; echo '--- connect api.sock:'; (exec 3<>"+filepath.Join(data, "run", "api.sock")+") 2>&1 || echo refused")
	t.Logf("sockets:\n%s", out)
	if !strings.Contains(out, "600") || !strings.Contains(out, "666") || !strings.Contains(out, "refused") {
		t.Fatalf("socket permissions as the role: %s", out)
	}

	// 1. The role process itself (what a turn's shell runs as) opens bob's credentials: kernel says no.
	out, errOut, code := roleRun(t, role, "/bin/cat", nil, bobHosts)
	if code == 0 || !strings.Contains(errOut, "Permission denied") {
		t.Fatalf("role read bob's credentials: %s", out+errOut)
	}
	out, _, code = roleRun(t, role, "/bin/ls", nil, dirs["alice"])
	if code == 0 {
		t.Fatalf("role listed alice's directory: %s", out)
	}

	// 2. alice's turn, through the real CLI as the role user: her own identity, her own token.
	e.noteCallerTurn("discord:c1", "discord", "u-alice", "alice", "c1", false, false, false)
	env := []string{"CC_PROJECT=lead", "CC_SESSION_KEY=discord:c1", "CC_DATA_DIR=" + data}
	out, errOut, code = roleRun(t, role, bin, env, "member", "status")
	if code != 0 || !strings.Contains(out, "个人目录") || !strings.Contains(out, "gh-alice") {
		t.Fatalf("bothouse member status as the role: %s%s", out, errOut)
	}
	// sudo -i hands the command to the target's login shell as one string, so an argv element holding
	// spaces or `;` is re-split before the program sees it. Keep every argument a single word: the
	// token check is a script, named by a git alias.
	who := roleScript(t, role, roleCwd, "who.sh",
		"#!/bin/sh\necho \"who=$(id -un) token=${GH_TOKEN:-none}\"\n")
	out, errOut, code = roleRun(t, role, bin, env, "member", "git", "-c", "alias.whoami=!"+who, "whoami")
	if code != 0 || !strings.Contains(out, "who="+role+" ") || !strings.Contains(out, "token=gho_FAKE_alice_token") ||
		strings.Contains(out, "bob") {
		t.Fatalf("alice's git did not run as %s with alice's token: %s%s", role, out, errOut)
	}

	// 3. alice's turn tries bob's credentials through the bridge's own command: kernel says no.
	out, errOut, code = roleRun(t, role, bin, env, "member", "git", "diff", "--no-index", bobHosts, "/dev/null")
	if code == 0 || strings.Contains(out, "gho_FAKE_bob") || !strings.Contains(errOut, "Could not access") {
		t.Fatalf("alice's turn read bob's credentials: %s%s", out, errOut)
	}
	peek := roleScript(t, role, roleCwd, "peek.sh", "#!/bin/sh\ncat "+bobHosts+"\n")
	out, errOut, code = roleRun(t, role, bin, env, "member", "git", "-c", "alias.peek=!"+peek, "peek")
	if code == 0 || strings.Contains(out, "gho_FAKE_bob") || !strings.Contains(errOut, "Permission denied") {
		t.Fatalf("alice's turn read bob's credentials through a git alias: %s%s", out, errOut)
	}

	// 4. Files go through the bridge: alice puts one, the role cannot open it directly, bob cannot get it.
	src := filepath.Join(roleCwd, "report.txt")
	if out, err := exec.Command("sudo", "-n", "-iu", role, "sh", "-c", "echo alice-report > "+src).CombinedOutput(); err != nil {
		t.Fatalf("write as role: %s %v", out, err)
	}
	out, errOut, code = roleRun(t, role, bin, env, "member", "put", src)
	if code != 0 {
		t.Fatalf("put: %s%s", out, errOut)
	}
	stored := filepath.Join(dirs["alice"], "files", "report.txt")
	if out, _, code := roleRun(t, role, "/bin/cat", nil, stored); code == 0 {
		t.Fatalf("role read alice's file directly: %s", out)
	}
	// Absolute destination: sudo -i starts the CLI in the role's HOME, so a bare name would land there
	// (in a real turn the workspace cwd is re-applied through CC_RUNAS_CHDIR, and `get` follows it).
	back := filepath.Join(roleCwd, "back.txt")
	out, errOut, code = roleRun(t, role, bin, env, "member", "get", "report.txt", back)
	got, _, _ := roleRun(t, role, "/bin/sh", nil, "-c", "stat -c '%U %a' "+back+"; cat "+back)
	if code != 0 || !strings.Contains(got, role) || !strings.Contains(got, "alice-report") {
		t.Fatalf("get: %s%s %s", out, errOut, got)
	}

	// 5. bob's turn over the same session: his own token, and alice's file stays hers.
	e.noteCallerTurn("discord:c1", "discord", "u-bob", "bob", "c1", false, false, false)
	out, errOut, code = roleRun(t, role, bin, env, "member", "get", "report.txt")
	if code == 0 {
		t.Fatalf("bob got alice's file: %s%s", out, errOut)
	}
	out, errOut, code = roleRun(t, role, bin, env, "member", "git", "-c", "alias.whoami=!"+who, "whoami")
	if code != 0 || !strings.Contains(out, "token=gho_FAKE_bob_token") || strings.Contains(out, "alice") {
		t.Fatalf("bob's git did not carry bob's token: %s%s", out, errOut)
	}

	// 6. Out of any turn (no live turn record) the token fetch is refused, so the CLI gets nothing.
	e.endCallerTurn("discord:c1")
	out, errOut, code = roleRun(t, role, bin, env, "member", "status")
	if code == 0 {
		t.Fatalf("member status worked outside a turn: %s%s", out, errOut)
	}
}
