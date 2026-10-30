package main

// maomao fork: `cc-connect model …` lets an agent switch its own model / reasoning effort.
// CC_PROJECT, CC_SESSION_KEY and CC_DATA_DIR are injected into the agent's environment.

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

var errModelAPIUnreachable = errors.New("cannot reach bothouse")

// Optional agent plugin hook; absent in builds without that agent. Only a
// query for the calling tool's own injected project/channel may use it.
var localModelStatus func() (core.ModelStatus, bool)

func readLocalModelStatus(project, session, socket string) (core.ModelStatus, bool) {
	if project == "" || session == "" || project != os.Getenv("CC_PROJECT") || session != os.Getenv("CC_SESSION_KEY") || socket != resolveSocketPath("") || localModelStatus == nil {
		return core.ModelStatus{}, false
	}
	return localModelStatus()
}

func runModel(args []string) {
	if len(args) == 0 || args[0] == "-h" || args[0] == "--help" || args[0] == "help" {
		printModelUsage()
		return
	}
	sub, rest := args[0], args[1:]
	fs := flag.NewFlagSet("model "+sub, flag.ExitOnError)
	project := fs.String("project", os.Getenv("CC_PROJECT"), "project (default: $CC_PROJECT)")
	session := fs.String("session-key", os.Getenv("CC_SESSION_KEY"), "session (default: $CC_SESSION_KEY)")
	dataDir := fs.String("data-dir", "", "data directory (default: $CC_DATA_DIR or ~/.bothouse)")
	effort := fs.String("effort", "", "reasoning effort to set together with the model")
	jsonOut := fs.Bool("json", false, "print raw JSON")
	// Allow flags after the positional model name: `model set sol --effort high`.
	var pos []string
	for len(rest) > 0 {
		_ = fs.Parse(rest)
		rest = fs.Args()
		if len(rest) > 0 {
			pos = append(pos, rest[0])
			rest = rest[1:]
		}
	}
	sock := resolveSocketPath(*dataDir)

	switch sub {
	case "list", "info", "status":
		q := url.Values{"project": {*project}, "session_key": {*session}}
		var st core.ModelStatus
		if err := modelAPIGet(sock, "/model/info?"+q.Encode(), &st); err != nil {
			var found bool
			if errors.Is(err, errModelAPIUnreachable) {
				st, found = readLocalModelStatus(*project, *session, sock)
			}
			if !found {
				modelFail(err)
			}
		}
		if *jsonOut {
			printModelJSON(st)
			return
		}
		printModelStatus(st)
	case "set", "effort", "auto":
		req := map[string]any{"project": *project, "session_key": *session}
		switch sub {
		case "set":
			if len(pos) == 0 {
				modelFail(fmt.Errorf("usage: bothouse model set <model id> [--effort <level>]"))
			}
			req["model"] = strings.Join(pos, " ")
			req["effort"] = *effort
		case "effort":
			if len(pos) == 0 {
				modelFail(fmt.Errorf("usage: bothouse model effort <level>"))
			}
			req["effort"] = pos[0]
		case "auto":
			req["auto"] = true
		}
		if *session == "" {
			modelFail(fmt.Errorf("no session: run this from inside a bothouse agent session (CC_SESSION_KEY unset)"))
		}
		body, _ := json.Marshal(req)
		resp, err := apiPost(sock, "/model/set", body)
		if err != nil {
			modelFail(err)
		}
		defer resp.Body.Close()
		data, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != http.StatusOK {
			modelFail(fmt.Errorf("%s", strings.TrimSpace(string(data))))
		}
		var r core.ModelSwitchResult
		_ = json.Unmarshal(data, &r)
		if *jsonOut {
			printModelJSON(r)
		} else {
			printModelResult(r)
		}
		if !r.OK {
			os.Exit(2)
		}
	default:
		printModelUsage()
		os.Exit(1)
	}
}

func modelAPIGet(sock, path string, out any) error {
	client := &http.Client{Timeout: 60 * time.Second, Transport: &http.Transport{
		DialContext: func(_ context.Context, _, _ string) (net.Conn, error) { return net.Dial("unix", sock) },
	}}
	resp, err := client.Get("http://unix" + path)
	if err != nil {
		return fmt.Errorf("%w (%s): %w", errModelAPIUnreachable, sock, err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%s", strings.TrimSpace(string(data)))
	}
	return json.Unmarshal(data, out)
}

func printModelStatus(st core.ModelStatus) {
	fmt.Printf("agent: %s\ncurrent model: %s\n", st.Agent, st.Model)
	if st.Source == "local_session" {
		fmt.Println("source: current session metadata (bridge unavailable; model catalog and switch status not queried)")
		return
	}
	if st.Effort != "" || len(st.Efforts) > 0 {
		fmt.Printf("reasoning effort: %s (available: %s)\n", orDash(st.Effort), orDash(strings.Join(st.Efforts, ", ")))
	} else if st.EffortInModel {
		fmt.Println("reasoning effort: part of the model id — switch to the variant with the level you want")
	} else {
		fmt.Println("reasoning effort: not adjustable for this agent")
	}
	if st.AutoChat != "" {
		state := "on"
		if st.AutoPaused {
			state = "paused (a hand-picked model is active; `bothouse model auto` resumes)"
		}
		fmt.Printf("automatic model choice: %s — chat %s, task %s\n", state, st.AutoChat, st.AutoTask)
	}
	if st.Pending != "" {
		fmt.Printf("pending switch (applies on the next message): %s\n", st.Pending)
	}
	fmt.Printf("available models (%d):\n", len(st.Models))
	for _, m := range st.Models {
		label := strings.TrimSpace(m.Alias)
		if label != "" && label != m.Name {
			fmt.Printf("  %s    — %s\n", m.Name, label)
		} else {
			fmt.Printf("  %s\n", m.Name)
		}
	}
}

func printModelResult(r core.ModelSwitchResult) {
	if r.OK {
		fmt.Printf("OK: %s\n", r.Message)
		if r.Model != "" {
			fmt.Printf("model: %s\n", r.Model)
		}
		if r.Effort != "" {
			fmt.Printf("reasoning effort: %s\n", r.Effort)
		}
		return
	}
	fmt.Printf("NOT CHANGED: %s\n", r.Message)
	for _, c := range r.Candidates {
		if c.Alias != "" && c.Alias != c.Name {
			fmt.Printf("  %s    — %s\n", c.Name, c.Alias)
		} else {
			fmt.Printf("  %s\n", c.Name)
		}
	}
}

func orDash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}

func printModelJSON(v any) {
	b, _ := json.MarshalIndent(v, "", "  ")
	fmt.Println(string(b))
}

func modelFail(err error) {
	fmt.Fprintln(os.Stderr, "Error:", err)
	os.Exit(1)
}

func printModelUsage() {
	fmt.Println(`Usage: bothouse model <command>   (run by the agent inside its own session)

Commands:
  list                              current model, available models, reasoning effort levels
  set <model id> [--effort <level>] switch model (takes effect from the user's next message)
  effort <level>                    change reasoning effort (low / medium / high / xhigh / max)
  auto                              hand model choice back to automatic chat/task switching

CC_PROJECT and CC_SESSION_KEY are already set inside agent sessions.
Flags: --project, --session-key, --data-dir, --json`)
}
