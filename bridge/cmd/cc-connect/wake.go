package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
)

// runWake: `bothouse wake [-p project] [-s session] (-m text | --stdin)` runs one turn in the
// session with the text as its input (POST /wake); the role's reply goes to the channel,
// the text itself is not posted (#1130). Defaults: CC_PROJECT / CC_SESSION_KEY.
func runWake(args []string) {
	project, session, text, dataDir := os.Getenv("CC_PROJECT"), os.Getenv("CC_SESSION_KEY"), "", ""
	stdin := false
	for i := 0; i < len(args); i++ {
		a := args[i]
		val := func() string {
			if i+1 >= len(args) {
				fmt.Fprintf(os.Stderr, "Error: %s requires a value\n", a)
				os.Exit(1)
			}
			i++
			return args[i]
		}
		switch a {
		case "-p", "--project":
			project = val()
		case "-s", "--session", "--session-key":
			session = val()
		case "-m", "--message":
			text = val()
		case "--data-dir":
			dataDir = val()
		case "--stdin":
			stdin = true
		case "-h", "--help", "help":
			printWakeUsage()
			return
		default:
			fmt.Fprintf(os.Stderr, "Error: unknown argument %q\n", a)
			printWakeUsage()
			os.Exit(1)
		}
	}
	if stdin {
		b, err := io.ReadAll(os.Stdin)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: read stdin: %v\n", err)
			os.Exit(1)
		}
		text = string(b)
	}
	if strings.TrimSpace(text) == "" || session == "" {
		printWakeUsage()
		os.Exit(1)
	}
	sockPath := resolveSocketPath(dataDir)
	payload, _ := json.Marshal(map[string]string{"project": project, "session_key": session, "text": text})
	client := &http.Client{Transport: &http.Transport{DialContext: func(_ context.Context, _, _ string) (net.Conn, error) {
		return net.Dial("unix", sockPath)
	}}}
	resp, err := client.Post("http://unix/wake", "application/json", bytes.NewReader(payload))
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: failed to connect (is bothouse running? %s): %v\n", sockPath, err)
		os.Exit(1)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusAccepted && resp.StatusCode != http.StatusOK {
		fmt.Fprintf(os.Stderr, "Error: %s\n", strings.TrimSpace(string(body)))
		os.Exit(1)
	}
	fmt.Println(strings.TrimSpace(string(body)))
}

func printWakeUsage() {
	fmt.Fprintln(os.Stderr, `Usage: bothouse wake [-p <project>] [-s <session_key>] (-m <text> | --stdin) [--data-dir <dir>]
Runs one turn in the session with the text as its input; the reply goes to the channel,
the text itself is not posted. Defaults: CC_PROJECT / CC_SESSION_KEY.`)
}
