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
