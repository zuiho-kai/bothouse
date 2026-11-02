package main

import (
	"encoding/json"
	"flag"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestWSClaimCLI(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "run"), 0o700); err != nil {
		t.Fatal(err)
	}
	ln, err := net.Listen("unix", resolveSocketPath(dir))
	if err != nil {
		t.Fatal(err)
	}
	requests := make(chan map[string]string, 1)
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/team/workspace/claim" {
			t.Errorf("unexpected route %s", r.URL.Path)
		}
		var body map[string]string
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		requests <- body
		_, _ = w.Write([]byte("{}"))
	})}
	go func() { _ = srv.Serve(ln) }()
	t.Cleanup(func() { _ = srv.Close() })
	// This is the deployed board/ws-handoff argument order: positional ID first.
	runWorkspace([]string{"claim", "ws1", "--data-dir", dir, "--session-key", "discord:chat", "--owner", "123456789", "--title", "recovery"})
	got := <-requests
	if got["session_key"] != "discord:chat" || got["workspace_id"] != "ws1" || got["owner"] != "123456789" || got["title"] != "recovery" {
		t.Fatalf("CLI sent the wrong claim: %v", got)
	}
}

func TestWorkspaceClaimFlagsAfterID(t *testing.T) {
	fs := flag.NewFlagSet("workspace claim", flag.ContinueOnError)
	owner := fs.String("owner", "", "")
	session := fs.String("session-key", "discord:ws1", "")
	title := fs.String("title", "", "")
	jsonOut := fs.Bool("json", false, "")
	if err := parseWorkspaceFlags(fs, []string{"ws1", "--owner", "123456789", "--session-key", "discord:chat", "--title", "two words", "--json"}); err != nil {
		t.Fatal(err)
	}
	if *owner != "123456789" || *session != "discord:chat" || *title != "two words" || !*jsonOut || !reflect.DeepEqual(fs.Args(), []string{"ws1"}) {
		t.Fatalf("trailing flags lost: owner=%q session=%q title=%q json=%v args=%v", *owner, *session, *title, *jsonOut, fs.Args())
	}
}

func TestWorkspaceFlagsTerminatorAndUnknown(t *testing.T) {
	fs := flag.NewFlagSet("workspace", flag.ContinueOnError)
	owner := fs.String("owner", "", "")
	if err := parseWorkspaceFlags(fs, []string{"--owner=123", "--", "--literal"}); err != nil {
		t.Fatal(err)
	}
	if *owner != "123" || !reflect.DeepEqual(fs.Args(), []string{"--literal"}) {
		t.Fatalf("terminator lost: %q %v", *owner, fs.Args())
	}
	if err := parseWorkspaceFlags(fs, []string{"ws1", "--unknown"}); err == nil {
		t.Fatal("unknown trailing option must be rejected")
	}
}
