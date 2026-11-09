package main

// `bothouse channel create <name>`: create the channel the user asked for next to this chat
// channel, above the category's workspace channels (user 11-09). CC_SESSION_KEY says which channel.

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/chenhg5/cc-connect/core"
)

func runChannel(args []string) {
	if len(args) == 0 || args[0] == "-h" || args[0] == "--help" || args[0] == "help" {
		printChannelUsage()
		return
	}
	sub, rest := args[0], args[1:]
	if sub != "create" {
		printChannelUsage()
		os.Exit(1)
	}
	fs := flag.NewFlagSet("channel create", flag.ExitOnError)
	session := fs.String("session-key", envSessionKey(), "chat channel the new channel goes next to (default: $CC_SESSION_KEY)")
	project := fs.String("project", os.Getenv("CC_PROJECT"), "project (default: $CC_PROJECT)")
	dataDir := fs.String("data-dir", "", "data directory (default: $CC_DATA_DIR or ~/.bothouse)")
	jsonOut := fs.Bool("json", false, "print raw JSON")
	_ = parseWorkspaceFlags(fs, rest)
	if len(rest) > 0 && (rest[0] == "-h" || rest[0] == "--help") {
		printChannelUsage()
		return
	}
	name := strings.TrimSpace(strings.Join(fs.Args(), " "))
	if name == "" {
		workspaceFail(fmt.Errorf("usage: bothouse channel create <name>"))
	}
	if *session == "" {
		workspaceFail(fmt.Errorf("no channel: run this inside a bothouse agent session or pass --session-key discord:<channel id>"))
	}
	body, _ := json.Marshal(map[string]string{"project": *project, "session_key": *session, "name": name})
	resp, err := apiPost(resolveSocketPath(*dataDir), "/channel/create", body)
	if err != nil {
		workspaceFail(err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		workspaceFail(fmt.Errorf("%s", strings.TrimSpace(string(data))))
	}
	var r core.TeamChannelCreateResult
	_ = json.Unmarshal(data, &r)
	if *jsonOut {
		printModelJSON(r)
		return
	}
	fmt.Printf("%s\t%s\n", r.Channel.ID, r.Channel.Name)
	if r.Warning != "" {
		fmt.Fprintln(os.Stderr, "Warning:", r.Warning)
	}
}

func printChannelUsage() {
	fmt.Println(`Usage: bothouse channel create <name> [--session-key discord:<channel id>] [--project <name>] [--json]

  create  create text channel <name> in the same category as this chat channel (a workspace
          session uses its chat channel), placed above the category's 「工作区n」 channels.
          Use this when the user asks for a new channel; do not call the Discord API yourself.
          Workspaces are made with "bothouse workspace new". Discord only.`)
}
