package main

// `bothouse report pass|reject --id <board>`: end a workspace [report] the bridge holds for the
// chat lead (core/team_report_accept.go). ws-pass calls pass, ws-forward calls reject.

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// reportVerdictCommand returns 0 when done, 3 when no report of that item is held, 1 otherwise.
func reportVerdictCommand(action string, args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("report "+action, flag.ContinueOnError)
	fs.SetOutput(stderr)
	id := fs.Int("id", 0, "task-board item id of the held [report]")
	verdict := fs.String("verdict", "", "pass: item by item, which expectation is met and the evidence")
	reason := fs.String("reason", "", "reject: why it goes back")
	dataDir := fs.String("data-dir", "", "data directory (default: $CC_DATA_DIR or ~/.bothouse)")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if *id <= 0 {
		fmt.Fprintf(stderr, "usage: bothouse report %s --id <board item> [--verdict ...|--reason ...]\n", action)
		return 2
	}
	text := *verdict
	if action == "reject" {
		text = *reason
	}
	body, _ := json.Marshal(map[string]any{"board": *id, "action": action, "verdict": text})
	resp, err := apiPost(resolveSocketPath(*dataDir), "/team/report/verdict", body)
	if err != nil {
		fmt.Fprintf(stderr, "report %s: %v\n", action, err)
		return 1
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	switch resp.StatusCode {
	case http.StatusOK:
		if action == "pass" {
			fmt.Fprintf(stdout, "#%d 的汇报已放行，贴到聊天频道\n", *id)
		} else {
			fmt.Fprintf(stdout, "#%d 的汇报已打回，不贴\n", *id)
		}
		return 0
	case http.StatusNotFound:
		fmt.Fprintf(stderr, "report %s: #%d 没有等主角色验收的文字汇报\n", action, *id)
		return 3
	default:
		fmt.Fprintf(stderr, "report %s: %s\n", action, strings.TrimSpace(string(data)))
		return 1
	}
}
