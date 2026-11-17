package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/config"
	"github.com/chenhg5/cc-connect/core"
)

// setupModeServer starts runSetupOnly against an empty config (the fresh-install state:
// no [[projects]] at all) and returns its port, token and a stop func. The config file is
// written first so config.ConfigPath points at a real file, exactly as startSetupWizard does.
func setupModeServer(t *testing.T) (int, string, func()) {
	t.Helper()
	dir := t.TempDir()
	// runSetupOnly waits on the package-level desktopShutdown channel; a previous test has
	// already closed it, so reset it here and put it back afterwards.
	previous := desktopShutdown
	desktopShutdown = make(chan struct{})
	desktopShutdownOnce = sync.Once{}
	t.Cleanup(func() {
		desktopShutdown = previous
		desktopShutdownOnce = sync.Once{}
	})
	t.Setenv("CC_LOG_FILE", filepath.Join(dir, "cc.log"))
	// Keep the wizard's DSH route and gate lookups inside the temp dir, away from the real
	// home directory (~/.conest-collab, ~/.bothouse).
	t.Setenv("CONEST_COLLAB_DATA", filepath.Join(dir, "collab"))

	configPath := filepath.Join(dir, "config.toml")
	if err := bootstrapSetupConfig(configPath); err != nil {
		t.Fatalf("write first-run config: %v", err)
	}
	config.ConfigPath = configPath
	t.Cleanup(func() { config.ConfigPath = "" })

	cfg, err := config.LoadForSetup(configPath)
	if err != nil {
		t.Fatalf("load first-run config: %v", err)
	}
	if len(cfg.Projects) != 0 {
		t.Fatalf("first-run config should have no projects, got %d", len(cfg.Projects))
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()

	cfg.DataDir = filepath.Join(dir, "data")
	cfg.Management.Port = port
	cfg.Management.Host = "127.0.0.1"
	cfg.Management.Token = "test-setup-settings"
	// Setup recovery may prepare the gate; keep that probe off a real install's port.
	cfg.Gate.Port = core.PickFreePort(0)

	done := make(chan struct{})
	go func() {
		defer close(done)
		runSetupOnly(cfg, configPath, func() {})
	}()

	client := &http.Client{Timeout: 2 * time.Second}
	endpoint := fmt.Sprintf("http://127.0.0.1:%d/api/v1/version", port)
	ready := false
	for deadline := time.Now().Add(10 * time.Second); time.Now().Before(deadline); {
		res, err := client.Get(endpoint)
		if err == nil {
			res.Body.Close()
			ready = true
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !ready {
		t.Fatal("setup-mode management server did not come up")
	}

	stop := func() {
		requestDesktopShutdown()
		select {
		case <-done:
		case <-time.After(10 * time.Second):
			t.Error("setup-mode server did not stop")
		}
	}
	return port, cfg.Management.Token, stop
}

// TestSetupModeGlobalSettings: on a fresh install (#1370) the 系统 page's endpoints must answer
// instead of 503, and a save must land in config.toml and read back.
func TestSetupModeGlobalSettings(t *testing.T) {
	port, token, stop := setupModeServer(t)
	defer stop()

	base := fmt.Sprintf("http://127.0.0.1:%d/api/v1/settings", port)
	client := &http.Client{Timeout: 5 * time.Second}

	do := func(method, body string) (int, map[string]any) {
		t.Helper()
		var req *http.Request
		var err error
		if body == "" {
			req, err = http.NewRequest(method, base, nil)
		} else {
			req, err = http.NewRequest(method, base, bytes.NewBufferString(body))
		}
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		res, err := client.Do(req)
		if err != nil {
			t.Fatalf("%s %s: %v", method, base, err)
		}
		defer res.Body.Close()
		var out map[string]any
		_ = json.NewDecoder(res.Body).Decode(&out)
		return res.StatusCode, out
	}

	// ① Read: 200, not the old 503 "global settings not available".
	code, body := do(http.MethodGet, "")
	if code != http.StatusOK {
		t.Fatalf("GET /settings in setup mode = %d (%v), want 200", code, body)
	}
	data, _ := body["data"].(map[string]any)
	if data == nil {
		t.Fatalf("GET /settings in setup mode returned no data: %v", body)
	}
	if _, ok := data["language"]; !ok {
		t.Fatalf("GET /settings in setup mode is missing language: %v", data)
	}

	// ② Write: 200 and the value survives a re-read from disk.
	code, body = do(http.MethodPatch, `{"language":"ja","log_level":"warn","idle_timeout_mins":45}`)
	if code != http.StatusOK {
		t.Fatalf("PATCH /settings in setup mode = %d (%v), want 200", code, body)
	}
	code, body = do(http.MethodGet, "")
	if code != http.StatusOK {
		t.Fatalf("GET /settings after save = %d (%v), want 200", code, body)
	}
	data, _ = body["data"].(map[string]any)
	if data["language"] != "ja" || data["log_level"] != "warn" {
		t.Fatalf("saved settings did not read back: %v", data)
	}
	if v, ok := data["idle_timeout_mins"].(float64); !ok || int(v) != 45 {
		t.Fatalf("idle_timeout_mins = %v, want 45", data["idle_timeout_mins"])
	}

	// ③ On disk, not just in memory: a second reader of the same config file sees the values.
	onDisk := config.GetGlobalSettings()
	if onDisk["language"] != "ja" || onDisk["log_level"] != "warn" {
		t.Fatalf("config.toml did not persist the save: %v", onDisk)
	}
	raw, err := os.ReadFile(config.ConfigPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(raw, []byte(`language = "ja"`)) {
		t.Fatalf("config.toml has no language = \"ja\":\n%s", raw)
	}
}

// TestSetupModeGlobalSettings_Unauthorized: the same endpoint still refuses a request without
// the token, so reaching settings during setup is not a hole.
func TestSetupModeGlobalSettings_Unauthorized(t *testing.T) {
	port, _, stop := setupModeServer(t)
	defer stop()

	res, err := (&http.Client{Timeout: 5 * time.Second}).Get(fmt.Sprintf("http://127.0.0.1:%d/api/v1/settings", port))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("GET /settings without a token = %d, want 401", res.StatusCode)
	}
}
