package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
)

func runRelay(args []string) {
	if len(args) == 0 {
		printRelayUsage()
		return
	}
	switch args[0] {
	case "send":
		runRelaySend(args[1:])
	case "--help", "-h", "help":
		printRelayUsage()
	default:
		fmt.Fprintf(os.Stderr, "Unknown relay subcommand: %s\n", args[0])
		printRelayUsage()
		os.Exit(1)
	}
}

func runRelaySend(args []string) {
	if err := relaySendCommand(args, os.Stdout); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}

func relaySendCommand(args []string, out io.Writer) error {
	var from, to, sessionKey, message, dataDir, taskID, requestID string

	var positional []string
	for i := 0; i < len(args); i++ {
		// Every value flag must have an argument; never silently drop task scope.
		switch args[i] {
		case "--from", "-f", "--to", "-t", "--session-key", "--session", "-s", "--message", "-m", "--data-dir", "--task", "--request-id":
			if i+1 >= len(args) {
				return fmt.Errorf("%s requires a value", args[i])
			}
		}
		switch args[i] {
		case "--from", "-f":
			if i+1 < len(args) {
				i++
				from = args[i]
			}
		case "--to", "-t":
			if i+1 < len(args) {
				i++
				to = args[i]
			}
		case "--session-key", "--session", "-s":
			if i+1 < len(args) {
				i++
				sessionKey = args[i]
			}
		case "--message", "-m":
			if i+1 < len(args) {
				i++
				message = args[i]
			}
		case "--data-dir":
			if i+1 < len(args) {
				i++
				dataDir = args[i]
			}
		case "--task":
			i++
			taskID = args[i]
			if strings.TrimSpace(taskID) == "" {
				return fmt.Errorf("--task must not be empty")
			}
		case "--request-id":
			i++
			requestID = args[i]
			if strings.TrimSpace(requestID) == "" {
				return fmt.Errorf("--request-id must not be empty")
			}
		case "--help", "-h":
			printRelaySendUsage()
			return nil
		default:
			if strings.HasPrefix(args[i], "--") {
				return fmt.Errorf("unknown relay option: %s", args[i])
			}
			positional = append(positional, args[i])
		}
	}

	if from == "" {
		from = os.Getenv("CC_PROJECT")
	}
	if sessionKey == "" {
		sessionKey = os.Getenv("CC_SESSION_KEY")
	}
	if message == "" && len(positional) > 0 {
		if to == "" && len(positional) >= 2 {
			to = positional[0]
			message = strings.Join(positional[1:], " ")
		} else {
			message = strings.Join(positional, " ")
		}
	}

	if to == "" || message == "" {
		return fmt.Errorf("target project (--to) and message are required")
	}
	if sessionKey == "" {
		return fmt.Errorf("session key is required (set CC_SESSION_KEY or use --session-key)")
	}
	if (taskID == "") != (requestID == "") {
		return fmt.Errorf("--task and --request-id must be provided together")
	}

	sockPath := resolveSocketPath(dataDir)
	if _, err := os.Stat(sockPath); err != nil {
		return fmt.Errorf("bothouse socket unavailable (%s): %w", sockPath, err)
	}

	payload, _ := json.Marshal(map[string]string{
		"from":        from,
		"to":          to,
		"session_key": sessionKey,
		"message":     message,
		"task_id":     taskID,
		"request_id":  requestID,
	})

	resp, err := apiPost(sockPath, "/relay/send", payload)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read relay response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%s", strings.TrimSpace(string(body)))
	}

	var result struct {
		Response string `json:"response"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return fmt.Errorf("decode response: %w", err)
	}
	_, err = fmt.Fprint(out, result.Response)
	return err
}

func printRelayUsage() {
	fmt.Println(`Usage: bothouse relay <command> [options]

Commands:
  send      Send a message to another bot via relay

Run 'bothouse relay <command> --help' for details.`)
}

func printRelaySendUsage() {
	fmt.Println(`Usage: bothouse relay send [options] [<target_project> <message>]

Send a message to another bot and wait for the response.

Options:
  -f, --from <project>       Source project (auto-detected from CC_PROJECT env)
  -t, --to <project>         Target bot project name
  -s, --session-key <key>    Session key (auto-detected from CC_SESSION_KEY env)
  -m, --message <text>       Message to send
      --data-dir <path>      Data directory (default: ~/.bothouse)
      --task <id>            Existing source task; details go to its thread
      --request-id <id>      Stable dispatch ID (required with --task)
  -h, --help                 Show this help

Examples:
  bothouse relay send --to claude-bot "What's the weather today?"
  bothouse relay send claude-bot What is the weather today`)
}
