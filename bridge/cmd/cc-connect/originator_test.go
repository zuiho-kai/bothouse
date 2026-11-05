package main

import (
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// A refused signing request must print the bridge's reason, not a fixed line
// (review item 3). The CLI exits the process, so this runs it as a child.
func TestOriginatorSignPrintsServerReason(t *testing.T) {
	if os.Getenv("CONEST_ORIGINATOR_HELPER") != "" {
		os.Args = []string{"bothouse", "originator", "sign", "--action", "gpu.run", "--expires-at", os.Getenv("CONEST_ORIGINATOR_EXPIRES")}
		main()
		os.Exit(0)
	}
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "run"), 0o700); err != nil {
		t.Fatal(err)
	}
	l, err := net.Listen("unix", filepath.Join(dir, "run", "api.sock"))
	if err != nil {
		t.Fatal(err)
	}
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/originator/sign" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		http.Error(w, "no active platform originator for this session", http.StatusForbidden)
	})}
	go srv.Serve(l)
	defer srv.Close()

	cmd := exec.Command(os.Args[0], "-test.run=^TestOriginatorSignPrintsServerReason$")
	// Drop the test runner's own environment (the machine running it may hold real
	// bot tokens, which the binary refuses to run with) and give the child only
	// what the CLI needs.
	cmd.Env = []string{
		"PATH=" + os.Getenv("PATH"),
		"HOME=" + os.Getenv("HOME"),
		// Already inside the test sandbox: without this marker the child's
		// TestMain would isolate again and clear the CC_* variables below.
		"CONEST_TEST_SANDBOX=" + os.Getenv("CONEST_TEST_SANDBOX"),
		"CONEST_ORIGINATOR_HELPER=1",
		"CONEST_ORIGINATOR_EXPIRES=2099-01-01T00:00:00Z",
		"CC_PROJECT=role",
		"CC_SESSION_KEY=discord:c1",
		"CC_DATA_DIR=" + dir,
	}
	out, err := cmd.CombinedOutput()
	if err == nil {
		t.Fatalf("a denied signing request must fail: %s", out)
	}
	text := string(out)
	if !strings.Contains(text, "no active platform originator for this session") {
		t.Fatalf("the bridge's reason is missing from the CLI output: %q", text)
	}
	if strings.Contains(text, "private") || strings.Contains(text, "seed") {
		t.Fatalf("output leaks key material: %q", text)
	}
}

// `bothouse originator context` prints what the bridge answered, and a refusal
// comes out as an error with the bridge's reason rather than an empty identity.
func TestOriginatorContextPrintsWhatTheBridgeAnswers(t *testing.T) {
	if os.Getenv("CONEST_ORIGINATOR_CONTEXT_HELPER") != "" {
		os.Args = []string{"bothouse", "originator", "context"}
		main()
		os.Exit(0)
	}
	const answer = `{"source":"scheduled","principal":{"platform":"discord","user_id":"alice"},` +
		`"role":"member","project":"role","session":"discord:c1","revoked":true,"reason":"the creator no longer resolves to a role"}`

	newChild := func(t *testing.T, handler http.HandlerFunc) ([]byte, error) {
		t.Helper()
		dir := t.TempDir()
		if err := os.MkdirAll(filepath.Join(dir, "run"), 0o700); err != nil {
			t.Fatal(err)
		}
		l, err := net.Listen("unix", filepath.Join(dir, "run", "api.sock"))
		if err != nil {
			t.Fatal(err)
		}
		srv := &http.Server{Handler: handler}
		go srv.Serve(l)
		t.Cleanup(func() { srv.Close() })
		cmd := exec.Command(os.Args[0], "-test.run=^TestOriginatorContextPrintsWhatTheBridgeAnswers$")
		cmd.Env = []string{
			"PATH=" + os.Getenv("PATH"),
			"HOME=" + os.Getenv("HOME"),
			"CONEST_TEST_SANDBOX=" + os.Getenv("CONEST_TEST_SANDBOX"),
			"CONEST_ORIGINATOR_CONTEXT_HELPER=1",
			"CC_PROJECT=role",
			"CC_SESSION_KEY=discord:c1",
			"CC_DATA_DIR=" + dir,
		}
		out, err := cmd.CombinedOutput()
		return out, err
	}

	t.Run("answer is printed", func(t *testing.T) {
		out, err := newChild(t, func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/originator/context" || r.Method != http.MethodPost {
				t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(answer))
		})
		if err != nil {
			t.Fatalf("a successful query must not fail: %v: %s", err, out)
		}
		text := string(out)
		if !strings.Contains(text, `"user_id":"alice"`) || !strings.Contains(text, `"revoked":true`) {
			t.Fatalf("the bridge's answer did not reach the caller: %q", text)
		}
		if strings.Contains(text, "private") || strings.Contains(text, "signature") || strings.Contains(text, "seed") {
			t.Fatalf("output leaks key material: %q", text)
		}
	})

	t.Run("refusal is an error", func(t *testing.T) {
		out, err := newChild(t, func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "user context is limited to the agent process the bridge started for a turn", http.StatusForbidden)
		})
		if err == nil {
			t.Fatalf("a refused query must fail: %s", out)
		}
		text := string(out)
		if !strings.Contains(text, "user context is limited to the agent process the bridge started for a turn") {
			t.Fatalf("the bridge's reason is missing: %q", text)
		}
		if strings.Contains(text, `"user_id"`) {
			t.Fatalf("a refusal printed an identity: %q", text)
		}
	})
}

// The usage line lists the new subcommand, so `bothouse originator` and the
// help path both tell a caller the read-only query exists.
func TestOriginatorUsageListsContext(t *testing.T) {
	text := captureStdout(t, printOriginatorUsage)
	if !strings.Contains(text, "originator context") {
		t.Fatalf("usage does not list the context command: %q", text)
	}
}
