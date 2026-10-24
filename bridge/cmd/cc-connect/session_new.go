package main

// `cc-connect session new --after-turn`: an agent asks the bridge to give its
// own session a fresh context once the current turn has replied (same effect
// as the user typing /new). Only the caller's session: CC_PROJECT and
// CC_SESSION_KEY, which the bridge injects into agent turns.

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

func runSession(args []string) {
	if len(args) == 0 || args[0] == "-h" || args[0] == "--help" || args[0] == "help" {
		printSessionUsage()
		return
	}
	for _, a := range args[1:] {
		if a == "-h" || a == "--help" || a == "help" {
			printSessionUsage()
			return
		}
	}
	if args[0] != "new" {
		printSessionUsage()
		os.Exit(1)
	}
	body, sock, err := sessionNewRequest(args[1:], os.Getenv)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Error:", err)
		os.Exit(1)
	}
	resp, err := apiPost(sock, "/session/new", body)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Error:", err)
		os.Exit(1)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		fmt.Fprintln(os.Stderr, "Error:", strings.TrimSpace(string(data)))
		os.Exit(1)
	}
	var r core.SessionResetResult
	_ = json.Unmarshal(data, &r)
	fmt.Println(r.Message)
}

// sessionNewRequest parses `session new` flags and checks the session env.
func sessionNewRequest(args []string, getenv func(string) string) ([]byte, string, error) {
	fs := flag.NewFlagSet("session new", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	afterTurn := fs.Bool("after-turn", false, "reset after the current turn's reply")
	dataDir := fs.String("data-dir", "", "data directory (default: $CC_DATA_DIR or ~/.bothouse)")
	if err := fs.Parse(args); err != nil {
		return nil, "", err
	}
	if fs.NArg() > 0 {
		return nil, "", fmt.Errorf("unexpected argument %q", fs.Arg(0))
	}
	if !*afterTurn {
		return nil, "", fmt.Errorf("--after-turn is required (resets the caller's session after this turn's reply)")
	}
	project, key := strings.TrimSpace(getenv("CC_PROJECT")), strings.TrimSpace(getenv("CC_SESSION_KEY"))
	if project == "" || key == "" {
		return nil, "", fmt.Errorf("CC_PROJECT and CC_SESSION_KEY must be set: run this from inside a bothouse agent turn")
	}
	if *dataDir == "" {
		*dataDir = getenv("CC_DATA_DIR")
	}
	body, _ := json.Marshal(map[string]any{"project": project, "session_key": key, "after_turn": true})
	return body, resolveSocketPath(*dataDir), nil
}

func printSessionUsage() {
	fmt.Println(`Usage: bothouse session new --after-turn

Give this agent session a fresh context once the current turn's reply is
delivered (same as the user typing /new). With no turn running it resets now.
Only the calling session is reset: CC_PROJECT and CC_SESSION_KEY are already
set inside agent sessions.`)
}
