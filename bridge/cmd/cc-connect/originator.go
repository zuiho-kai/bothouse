package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
)

func printOriginatorUsage() {
	fmt.Println("Usage: bothouse originator sign --action <operation> --expires-at <RFC3339>")
	fmt.Println("       bothouse originator context")
}

func runOriginator(args []string) {
	if len(args) < 1 || isHelpArg(args[0]) {
		printOriginatorUsage()
		return
	}
	switch args[0] {
	case "sign":
		runOriginatorSign(args[1:])
	case "context":
		runOriginatorContext(args[1:])
	default:
		fmt.Fprintln(os.Stderr, "Usage: bothouse originator sign --action <operation> --expires-at <RFC3339>")
		fmt.Fprintln(os.Stderr, "       bothouse originator context")
		os.Exit(1)
	}
}

// runOriginatorContext prints whose turn this process is running in, as the
// bridge recorded it. It exists for the turns that cannot be signed — a cron
// job, a timer, a heartbeat, a workspace wake-up — which used to have no way to
// ask at all. The answer carries no secret: it names the platform person and
// their CURRENT role, and the caller's own project and session.
func runOriginatorContext(args []string) {
	for _, a := range args {
		if isHelpArg(a) {
			printOriginatorUsage()
			return
		}
		fmt.Fprintf(os.Stderr, "Unknown option: %s\n", a)
		os.Exit(1)
	}
	resp, err := apiPost(resolveSocketPath(""), "/originator/context", []byte("{}"))
	if err != nil {
		fmt.Fprintln(os.Stderr, "Error:", err)
		os.Exit(1)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		reason, readErr := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
		detail := strings.TrimSpace(string(reason))
		if readErr != nil || detail == "" {
			detail = http.StatusText(resp.StatusCode)
		}
		fmt.Fprintf(os.Stderr, "Error: user context was refused: %s\n", detail)
		os.Exit(1)
	}
	var ctx any
	if err := json.NewDecoder(resp.Body).Decode(&ctx); err != nil {
		fmt.Fprintln(os.Stderr, "Error: decode user context:", err)
		os.Exit(1)
	}
	out, err := json.Marshal(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Error: encode user context:", err)
		os.Exit(1)
	}
	fmt.Println(string(out))
}

func runOriginatorSign(args []string) {
	var action, expiresAt string
	for i := 0; i < len(args); i++ {
		if isHelpArg(args[i]) {
			printOriginatorUsage()
			return
		}
		if i+1 >= len(args) {
			fmt.Fprintf(os.Stderr, "Missing value for %s\n", args[i])
			os.Exit(1)
		}
		switch args[i] {
		case "--action":
			action = args[i+1]
		case "--expires-at":
			expiresAt = args[i+1]
		default:
			fmt.Fprintf(os.Stderr, "Unknown option: %s\n", args[i])
			os.Exit(1)
		}
		i++
	}
	if action == "" || expiresAt == "" {
		fmt.Fprintln(os.Stderr, "Error: --action and --expires-at are required")
		os.Exit(1)
	}
	project, session := os.Getenv("CC_PROJECT"), envSessionKey()
	if project == "" || session == "" {
		fmt.Fprintln(os.Stderr, "Error: CC_PROJECT and CC_SESSION_KEY are required")
		os.Exit(1)
	}
	payload, err := json.Marshal(map[string]string{"project": project, "session": session, "action": action, "expires_at": expiresAt})
	if err != nil {
		fmt.Fprintln(os.Stderr, "Error: encode originator request:", err)
		os.Exit(1)
	}
	resp, err := apiPost(resolveSocketPath(""), "/originator/sign", payload)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Error:", err)
		os.Exit(1)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		// The bridge answers a refusal with the reason in the body ("no active
		// platform originator for this session", "expires_at must be in the
		// future", …). Print it: the caller needs it to know why. The body never
		// carries the private key — signOriginator only returns claims, the
		// public key and the signature, and errors name the failed check only.
		reason, readErr := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
		detail := strings.TrimSpace(string(reason))
		if readErr != nil || detail == "" {
			detail = http.StatusText(resp.StatusCode)
		}
		fmt.Fprintf(os.Stderr, "Error: originator signing was denied: %s\n", detail)
		os.Exit(1)
	}
	// The socket response is already a JSON ticket. The private key is never a
	// CLI argument, environment variable or response field.
	var ticket any
	if err := json.NewDecoder(resp.Body).Decode(&ticket); err != nil {
		fmt.Fprintln(os.Stderr, "Error: decode originator ticket:", err)
		os.Exit(1)
	}
	out, err := json.Marshal(ticket)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Error: encode originator ticket:", err)
		os.Exit(1)
	}
	fmt.Println(string(out))
}
