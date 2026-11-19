package dsh

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/agent/acp"
)

// The transport is real; only the external desktop ACP server is replaced.
func TestDesktopACPProcess(t *testing.T) {
	record := os.Getenv("DSH_DESKTOP_TEST_RECORD")
	if record == "" {
		t.Skip("helper process")
	}
	f, err := os.Create(record)
	if err != nil {
		os.Exit(2)
	}
	dec, enc := json.NewDecoder(os.Stdin), json.NewEncoder(os.Stdout)
	for {
		var req struct {
			ID     json.RawMessage `json:"id"`
			Method string          `json:"method"`
			Params struct {
				SessionID string `json:"sessionId"`
			} `json:"params"`
		}
		if dec.Decode(&req) != nil {
			os.Exit(0)
		}
		if len(req.ID) == 0 {
			continue
		}
		f.WriteString(req.Method + " " + req.Params.SessionID + "\n")
		var result any = map[string]any{}
		switch req.Method {
		case "initialize":
			result = map[string]any{"protocolVersion": 1, "agentCapabilities": map[string]any{"sessionCapabilities": map[string]any{"resume": map[string]any{}}}}
		case "session/new":
			result = map[string]any{"sessionId": "desktop-test"}
		}
		enc.Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": result})
	}
}

func TestDesktopASARStartAndResumeWarn(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "dsh-home")
	profile := filepath.Join(home, "profiles", "acp")
	if err := os.MkdirAll(profile, 0755); err != nil {
		t.Fatal(err)
	}
	// This profile intentionally has no local dsh-acp package.
	if err := os.WriteFile(filepath.Join(profile, "package.json"), []byte(`{"bundles":["@deepseek-ai/dsh-base","@deepseek-ai/dsh-acp-app"]}`), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("DSH_HOME", home)
	archive := filepath.Join(root, "resources", "app.asar")
	if err := os.MkdirAll(filepath.Dir(archive), 0755); err != nil {
		t.Fatal(err)
	}
	// The archive is a regular file, not an unpacked directory. No member read
	// is possible through os.ReadFile; the healer must leave it untouched.
	packed := []byte("packed desktop archive fixture")
	if err := os.WriteFile(archive, packed, 0600); err != nil {
		t.Fatal(err)
	}
	shim := filepath.Join(root, "dsh.cmd")
	if err := os.WriteFile(shim, []byte("@echo off\r\n\"%~dp0DSH NEXT.exe\" \"%~dp0resources\\app.asar\\bin.js\" %*\r\n"), 0755); err != nil {
		t.Fatal(err)
	}
	entry := filepath.Join(archive, "bin.js")
	if got := dshShimScript(shim); got != entry {
		t.Fatalf("dshShimScript(%q) = %q, want %q", shim, got, entry)
	}
	if got := dshEntryScript(filepath.Join(root, "DSH NEXT.exe"), []string{entry, "--profile", "acp"}); got != entry {
		t.Fatalf("direct entry = %q", got)
	}
	for _, id := range []string{"", "desktop-test"} {
		t.Run("session="+id, func(t *testing.T) {
			record := filepath.Join(root, "requests-"+id+".log")
			opts := map[string]any{}
			if config := os.Getenv("DSH_TEST_OPTIONS"); config != "" {
				data, err := os.ReadFile(config)
				if err != nil {
					t.Fatal(err)
				}
				if err := json.Unmarshal(data, &opts); err != nil {
					t.Fatal(err)
				}
			}
			opts["cmd"] = os.Args[0]
			opts["args"] = []string{"-test.run=^TestDesktopACPProcess$"}
			opts["work_dir"] = root
			opts["env"] = map[string]any{"DSH_DESKTOP_TEST_RECORD": record}
			base, err := acp.New(opts)
			if err != nil {
				t.Fatal(err)
			}
			a := &Agent{Agent: base.(*acp.Agent), home: home, cmd: shim}
			var logs bytes.Buffer
			old := slog.Default()
			slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
			defer slog.SetDefault(old)
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			session, err := a.StartSession(ctx, id)
			if err != nil {
				t.Fatal(err)
			}
			defer session.Close()
			got := logs.String()
			for _, want := range []string{"cannot apply steer patch inside desktop ASAR", "app.asar", "busy messages will queue", "packed desktop component"} {
				if !strings.Contains(got, want) {
					t.Fatalf("missing %q in logs: %s", want, got)
				}
			}
			if strings.Contains(got, "patched it back") {
				t.Fatal("false patch success")
			}
			requests, err := os.ReadFile(record)
			if err != nil {
				t.Fatal(err)
			}
			want := "session/new "
			if id != "" {
				want = "session/resume " + id
			}
			if !strings.Contains(string(requests), want) {
				t.Fatalf("requests: %s", requests)
			}
			if id != "" && strings.Contains(string(requests), "session/new") {
				t.Fatal("resume created a new session")
			}
			t.Logf("%srequests:\n%s", got, requests)
		})
	}
	after, err := os.ReadFile(archive)
	if err != nil || !bytes.Equal(after, packed) {
		t.Fatal("desktop archive modified")
	}
}

func TestMissingACPWarns(t *testing.T) {
	var logs bytes.Buffer
	old := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	defer slog.SetDefault(old)
	healSteer(filepath.Join(t.TempDir(), "missing-dsh"), nil)
	if !strings.Contains(logs.String(), "cannot locate dsh-acp for steer patch") {
		t.Fatal(logs.String())
	}
}
