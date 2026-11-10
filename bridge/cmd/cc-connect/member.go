package main

// `bothouse member` (#1355): the personal directory and own GitHub authorization of whoever started the
// turn this runs in. The bridge decides who that is (signed caller, core/caller_identity.go) and runs
// gh / git itself with that person's credentials; nothing here names a member.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/chenhg5/cc-connect/config"
	"github.com/chenhg5/cc-connect/core"
)

const memberUsage = `Usage: bothouse member <command> [args]

Personal directory and own GitHub authorization of the person who started this turn
(the bridge knows who; a teammate bot, timer or hand-off turn has nobody's). Needs
member_workspaces = true (wizard team page, or the owner agrees and you run enable).

Commands:
  status            this person's directory and whether their GitHub is authorized
  login             start their GitHub device-code login; the code goes to them privately
  gh <args...>      run gh with their authorization (e.g. bothouse member gh pr list -R o/r)
  git <args...>     run git with their GitHub authorization (push / clone private repos)
  ls                list the files kept in their directory
  put <file> [name] keep a file in their directory (read with your own permissions)
  get <name> [dest] copy one of their files out to dest (default: same name here)
  logout            delete their local GitHub credentials
  enable | disable  turn member workspaces on / off (only in a turn the owner started)
`

func runMember(args []string) {
	if len(args) == 0 || args[0] == "-h" || args[0] == "--help" || args[0] == "help" {
		fmt.Print(memberUsage)
		return
	}
	op := args[0]
	switch op {
	case "status", "dir", "login", "gh", "git", "logout", "enable", "disable", "put", "get", "ls":
	default:
		fmt.Fprintf(os.Stderr, "member: unknown command %q\n\n%s", op, memberUsage)
		os.Exit(2)
	}
	cwd, _ := os.Getwd()
	req := core.MemberRequest{Project: os.Getenv("CC_PROJECT"), Session: envSessionKey(), Op: op, Args: args[1:], Cwd: cwd}
	if req.Session == "" {
		fmt.Fprintln(os.Stderr, "member: CC_SESSION_KEY not set; run inside a bot turn")
		os.Exit(1)
	}
	body, _ := json.Marshal(req)
	resp, tokErr, err := memberPost(req.Project, req.Session, body)
	if err != nil {
		fmt.Fprintln(os.Stderr, "member: bridge not reachable:", err)
		os.Exit(1)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	var out core.MemberResponse
	if json.Unmarshal(b, &out) != nil {
		fmt.Fprintf(os.Stderr, "member: bridge: %s\n", b)
		os.Exit(1)
	}
	if out.Stdout != "" {
		fmt.Print(out.Stdout)
	}
	if out.Stderr != "" {
		fmt.Fprint(os.Stderr, out.Stderr)
	}
	if out.Text != "" {
		if out.Exit != 0 {
			// The bridge refused for want of a caller token: say why the fetch failed (usually "no turn
			// running now"), so the model does not go looking for a socket problem.
			if tokErr != "" && strings.Contains(out.Text, "凭证") {
				fmt.Fprintln(os.Stderr, "member: 这一轮的凭证取不到：", tokErr)
			}
			fmt.Fprintln(os.Stderr, out.Text)
		} else {
			fmt.Println(out.Text)
		}
	}
	os.Exit(out.Exit)
}

// memberPost sends one member request to member.sock, the socket a role under run_as_user can open
// (core/member_socket.go). api.sock stays 0600: it gives full control of the bridge, and the role must
// not have that. When the caller runs under another system account the bridge also wants a caller token
// for the turn it claims to be in, so this fills in the one identity.sock just signed for this turn; the
// bridge's own account does not need it (it already holds api.sock).
// memberCallTimeout: see memberPost.
const memberCallTimeout = 20 * time.Minute

func memberPost(project, session string, body []byte) (*http.Response, string, error) {
	dataDir := identityDataDir("")
	sock := core.MemberSocketPath(dataDir)
	tok, _, fetchErr := fetchCallerToken("", project, session)
	tokErr := ""
	if fetchErr != nil {
		// No turn token (the bridge's own account does not need one): try anyway, the bridge answers
		// with why not.
		tok, tokErr = "", fetchErr.Error()
	}
	// memberCallTimeout: a little past the bridge's own longest member op (memberLoginTimeout, 15 min in
	// core/member_workspace.go), so a live op never gets cut off here, while a bridge that accepts and
	// then goes quiet ends in an error instead of a role turn that hangs forever.
	client := &http.Client{Timeout: memberCallTimeout, Transport: &http.Transport{DialContext: func(_ context.Context, _, _ string) (net.Conn, error) {
		c, err := net.Dial("unix", sock)
		if err == nil || !errors.Is(err, fs.ErrNotExist) {
			return c, err
		}
		// Older bridge without member.sock: fall back to api.sock, which only this account can open.
		return net.Dial("unix", resolveSocketPath(""))
	}}}
	req, err := http.NewRequest(http.MethodPost, "http://unix/member", bytes.NewReader(body))
	if err != nil {
		return nil, tokErr, err
	}
	req.Header.Set("Content-Type", "application/json")
	if tok != "" {
		req.Header.Set("X-Bothouse-Caller", tok)
	}
	resp, err := client.Do(req)
	return resp, tokErr, err
}

// saveMemberWorkspaces writes member_workspaces for every project: the directories belong to the
// people, not to one role, so all roles of this bridge see the same switch.
func saveMemberWorkspaces(on bool) error {
	cfg, err := config.Load(config.ConfigPath)
	if err != nil {
		return err
	}
	for _, p := range cfg.Projects {
		if err := config.SaveProjectSettings(p.Name, config.ProjectSettingsUpdate{MemberWorkspaces: &on}); err != nil {
			return err
		}
	}
	return nil
}
