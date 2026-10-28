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
	chat := fs.String("chat", "", "park: the chat channel that handed the task off; refused unless it owns the workspace")
	before := fs.String("before", "", "park: RFC 3339 time the task was bound; parks that chat's newest handoff at or before it")
	stop := fs.Bool("stop", false, "park: also stop the turn running in the workspace when it is freed (the user stopped the task)")
	owner := fs.String("owner", "", "claim: who the task goes to (platform user/bot id), mentioned if the ten-minute check finds no progress")
	title := fs.String("title", "", "claim: the task's short name, shown in that nudge")
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
	case "claim":
		if fs.NArg() < 1 {
			workspaceFail(fmt.Errorf("usage: bothouse workspace claim <workspace channel id>"))
		}
		body, _ := json.Marshal(map[string]string{"session_key": *session, "workspace_id": fs.Arg(0), "owner": *owner, "title": *title})
		resp, err := apiPost(sock, "/team/workspace/claim", body)
		if err != nil {
			workspaceFail(err)
		}
		defer resp.Body.Close()
		data, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != http.StatusOK {
			workspaceFail(fmt.Errorf("%s", strings.TrimSpace(string(data))))
		}
		fmt.Println(strings.TrimSpace(string(data)))
	case "park":
		// Optional <workspace id>; without it the session (CC_SESSION_KEY) is the workspace.
		req := map[string]any{"session_key": *session, "chat": *chat, "before": *before, "stop": *stop}
		if fs.NArg() > 0 {
			req["workspace_id"] = fs.Arg(0)
		}
		body, _ := json.Marshal(req)
		resp, err := apiPost(sock, "/team/workspace/park", body)
		if err != nil {
			workspaceFail(err)
		}
		defer resp.Body.Close()
		data, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != http.StatusOK {
			workspaceFail(fmt.Errorf("%s", strings.TrimSpace(string(data))))
		}
		var r core.TeamWorkspaceParkResult
		_ = json.Unmarshal(data, &r)
		if *jsonOut {
			printModelJSON(r)
			return
		}
		if r.Freed {
			fmt.Printf("%s\tfreed\n", r.Workspace)
		} else {
			fmt.Printf("%s\tkept (other tasks in work)\n", r.Workspace)
		}
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
		if r.Hint != "" {
			fmt.Println(r.Hint)
		}
		for _, w := range r.Workspaces {
			fmt.Printf("%s\t%s\n", w.ID, w.Name)
		}
		if len(r.Pool) > 0 {
			fmt.Println("pool")
			for _, w := range r.Pool {
				fmt.Printf("%s\t%s\towner=%s\topen=%d\tparked=%d\n", w.ID, w.Name, w.Owner, w.Open, w.Parked)
			}
		}
	default:
		printWorkspaceUsage()
		os.Exit(1)
	}
}

func printWorkspaceUsage() {
	fmt.Println(`Usage: bothouse workspace <new|list|claim|park> [<workspace id>] [--session-key discord:<channel id>] [--json]

  new    create 「工作区(max+1)」 in the category's shared pool for this chat channel
  list   list this chat channel's workspaces and the category's shared pool
  claim  record this chat channel as the one handing off to <workspace id> (also resumes a paused task);
         [--owner <id>] [--title <short name>]: who the task goes to and what it is, for the
         ten-minute check (no progress then: a nudge in the workspace and the task is paused)
  park   pause one task of <workspace id> (default: this workspace); with no other task in
         work there the workspace goes back to the pool and its sessions are reset;
         --chat <chat key> [--before <RFC 3339>]: only that chat channel's task, refused
         when the workspace belongs to another chat channel now

On by default for the primary role project (Discord only); team_workspaces = false turns it off.`)
}

func workspaceFail(err error) {
	fmt.Fprintln(os.Stderr, "Error:", err)
	os.Exit(1)
}
