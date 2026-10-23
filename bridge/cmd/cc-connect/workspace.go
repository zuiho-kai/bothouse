package main

// Team mode D: `bothouse workspace new|list` — the lead or a working role adds 「工作区n+1」
// to its chat channel, or lists the chat channel's workspaces. CC_SESSION_KEY says which channel.

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/chenhg5/cc-connect/core"
)

func runWorkspace(args []string) {
	if len(args) == 0 || args[0] == "-h" || args[0] == "--help" || args[0] == "help" {
		printWorkspaceUsage()
		return
	}
	sub, rest := args[0], args[1:]
	fs := flag.NewFlagSet("workspace "+sub, flag.ExitOnError)
	session := fs.String("session-key", os.Getenv("CC_SESSION_KEY"), "chat or workspace channel (default: $CC_SESSION_KEY)")
	dataDir := fs.String("data-dir", "", "data directory (default: $CC_DATA_DIR or ~/.bothouse)")
	jsonOut := fs.Bool("json", false, "print raw JSON")
	_ = fs.Parse(rest)
	if *session == "" {
		workspaceFail(fmt.Errorf("no channel: run this inside a bothouse agent session or pass --session-key discord:<channel id>"))
	}
	sock := resolveSocketPath(*dataDir)
	switch sub {
	case "new":
		body, _ := json.Marshal(map[string]string{"session_key": *session})
		resp, err := apiPost(sock, "/team/workspace/new", body)
		if err != nil {
			workspaceFail(err)
		}
		defer resp.Body.Close()
		data, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != http.StatusOK {
			workspaceFail(fmt.Errorf("%s", strings.TrimSpace(string(data))))
		}
		var r core.TeamWorkspaceNewResult
		_ = json.Unmarshal(data, &r)
		if *jsonOut {
			printModelJSON(r)
			return
		}
		fmt.Printf("%s\t%s\n", r.Workspace.ID, r.Workspace.Name)
	case "list":
		var r core.TeamWorkspaceListResult
		if err := modelAPIGet(sock, "/team/workspace/list?"+url.Values{"session_key": {*session}}.Encode(), &r); err != nil {
			workspaceFail(err)
		}
		if *jsonOut {
			printModelJSON(r)
			return
		}
		fmt.Printf("chat %s\n", r.Parent)
		for _, w := range r.Workspaces {
			fmt.Printf("%s\t%s\n", w.ID, w.Name)
		}
	default:
		printWorkspaceUsage()
		os.Exit(1)
	}
}

func printWorkspaceUsage() {
	fmt.Println(`Usage: bothouse workspace <new|list> [--session-key discord:<channel id>] [--json]

  new    create the next 「工作区n+1」 for this chat channel (from a workspace: for its chat channel)
  list   list this chat channel's workspaces

Needs team_workspaces = true on the team lead project (Discord only).`)
}

func workspaceFail(err error) {
	fmt.Fprintln(os.Stderr, "Error:", err)
	os.Exit(1)
}
