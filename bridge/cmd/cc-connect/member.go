package main

// `bothouse member` (#1355): the personal directory and own GitHub authorization of whoever started the
// turn this runs in. The bridge decides who that is (signed caller, core/caller_identity.go) and runs
// gh / git itself with that person's credentials; nothing here names a member.

import (
	"encoding/json"
	"fmt"
	"io"
	"os"

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
	resp, err := apiPost(resolveSocketPath(""), "/member", body)
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
			fmt.Fprintln(os.Stderr, out.Text)
		} else {
			fmt.Println(out.Text)
		}
	}
	os.Exit(out.Exit)
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
