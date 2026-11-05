//go:build darwin || windows

package main

import (
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

// A DSH-only install has no [[projects]]; the tray must still read [management] and poll it
// (main.go then serves the setup wizard, whose management API is always on).
func TestTrayManagementAcceptsConfigWithoutProjects(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.toml")
	cfg := "data_dir = " + strconv.Quote(dir) + "\n[management]\nport = 9911\ntoken = \"tk\"\n\n[dsh]\nenabled = true\n"
	if err := os.WriteFile(path, []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	c, on, err := trayManagement(path)
	if err != nil {
		t.Fatalf("config without projects rejected: %v", err)
	}
	if !on || c.base != "http://127.0.0.1:9911" || c.token != "tk" {
		t.Fatalf("got on=%v client=%+v", on, c)
	}
}

func TestTrayManagementKeepsDisabledSwitchWithProjects(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.toml")
	cfg := "data_dir = " + strconv.Quote(dir) + "\n[management]\nenabled = false\n\n[[projects]]\nname = \"a\"\n[projects.agent]\ntype = \"claudecode\"\n"
	if err := os.WriteFile(path, []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, on, err := trayManagement(path); err != nil || on {
		t.Fatalf("want management off, got on=%v err=%v", on, err)
	}
}
