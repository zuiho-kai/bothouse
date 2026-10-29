package main

import (
	"bytes"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/config"
	"github.com/chenhg5/cc-connect/core"
)

func TestColdCacheFreshSettings(t *testing.T) {
	bp := func(b bool) *bool { return &b }
	ip := func(i int) *int { return &i }
	cases := []struct {
		name           string
		in             config.ColdCacheFreshConfig
		on             bool
		idle, min, max int
	}{
		{"unset defaults on", config.ColdCacheFreshConfig{}, true, 60, 80000, 300000},
		{"explicit true defaults", config.ColdCacheFreshConfig{Enabled: bp(true)}, true, 60, 80000, 300000},
		{"explicit false off", config.ColdCacheFreshConfig{Enabled: bp(false), IdleMins: ip(30)}, false, 0, 0, 0},
		{"explicit values", config.ColdCacheFreshConfig{IdleMins: ip(90), MinTokens: ip(120000), MaxContextTokens: ip(500000)}, true, 90, 120000, 500000},
		{"non-positive values ignored", config.ColdCacheFreshConfig{IdleMins: ip(0), MinTokens: ip(-1), MaxContextTokens: ip(0)}, true, 60, 80000, 300000},
	}
	for _, c := range cases {
		on, idle, min, max := coldCacheFreshSettings(c.in)
		if on != c.on || idle != c.idle || min != c.min || max != c.max {
			t.Errorf("%s: got (%v,%d,%d,%d), want (%v,%d,%d,%d)", c.name, on, idle, min, max, c.on, c.idle, c.min, c.max)
		}
	}
}

// fakeAgentBins puts a do-nothing executable for each agent CLI on PATH, so
// every registered agent type can be built without the real tools.
func fakeAgentBins(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	for _, n := range []string{"claude", "codex", "agy", "pi", "dsh", "gemini", "cursor-agent", "agent", "copilot", "devin", "iflow", "kimi", "opencode", "qodercli", "reasonix", "tmux", "acp-agent"} {
		if err := os.WriteFile(filepath.Join(dir, n), []byte("#!/bin/sh\n"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", dir)
	return dir
}

// cold_cache_fresh (and image_fresh) only work for agents that read their own
// session logs. A new agent type, or a backend change that drops the reader,
// must show up here instead of silently resuming idle sessions (jingyu lost it
// for 5 days after 2026-10-21; ~/.claude/reviews/idle-fresh-plan-1026.md).
func TestRegisteredAgentsSessionHandoffReader(t *testing.T) {
	dir := fakeAgentBins(t)
	want := map[string]bool{
		"claudecode": true, "codex": true, "antigravity": true, "pi": true, "dsh": true,
		"acp":     false, // generic ACP; a DSH launcher under acp is checked below
		"copilot": false, "cursor": false, "devin": false, "gemini": false, "iflow": false,
		"kimi": false, "opencode": false, "qoder": false, "reasonix": false, "tmux": false,
	}
	extra := map[string]map[string]any{
		"reasonix": {"serve_url": "http://127.0.0.1:1"},
		"tmux":     {"session": "x"},
	}
	names := core.ListRegisteredAgents()
	sort.Strings(names)
	for _, name := range names {
		exp, known := want[name]
		if !known {
			t.Errorf("agent type %q is new: decide whether it implements core.SessionHandoffReader (cold_cache_fresh) and add it to this table", name)
			continue
		}
		opts := map[string]any{"cmd": filepath.Join(dir, "acp-agent"), "work_dir": dir}
		for k, v := range extra[name] {
			opts[k] = v
		}
		a, err := core.CreateAgent(name, opts)
		if err != nil {
			t.Errorf("%s: create: %v", name, err)
			continue
		}
		if _, ok := a.(core.SessionHandoffReader); ok != exp {
			t.Errorf("%s (%T): SessionHandoffReader = %v, want %v", name, a, ok, exp)
		}
	}

	// jingyu's shape: type = "acp", cmd = a launcher that exports DSH_HOME.
	launcher := filepath.Join(dir, "jingyu-dsh")
	if err := os.WriteFile(launcher, []byte("#!/bin/sh\nexport DSH_HOME="+filepath.Join(dir, "home")+"\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	a, err := core.CreateAgent("acp", map[string]any{"cmd": launcher, "work_dir": dir})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := a.(core.SessionHandoffReader); !ok || a.Name() != "acp" {
		t.Fatalf("acp + DSH launcher (%T, Name %q): want a SessionHandoffReader named acp", a, a.Name())
	}
}

func TestWireColdCacheFreshWarnsWithoutReader(t *testing.T) {
	dir := fakeAgentBins(t)
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelWarn})))
	defer slog.SetDefault(prev)

	build := func(name, typ string, on bool) {
		a, err := core.CreateAgent(typ, map[string]any{"cmd": filepath.Join(dir, "acp-agent"), "work_dir": dir})
		if err != nil {
			t.Fatal(err)
		}
		proj := config.ProjectConfig{Name: name, Agent: config.AgentConfig{Type: typ}}
		proj.ColdCacheFresh.Enabled = &on
		wireColdCacheFresh(core.NewEngine(name, a, nil, "", core.LangEnglish), proj)
	}
	build("cursorrole", "cursor", true)
	build("plainacp", "acp", true)
	build("claude", "claudecode", true)
	build("offrole", "cursor", false)
	out := buf.String()
	for _, s := range []string{"project=cursorrole agent=cursor", "project=plainacp agent=acp"} {
		if !strings.Contains(out, "cold_cache_fresh: this agent cannot read its session logs") || !strings.Contains(out, s) {
			t.Errorf("missing WARN for %q in:\n%s", s, out)
		}
	}
	for _, s := range []string{"project=claude ", "project=offrole "} {
		if strings.Contains(out, s) {
			t.Errorf("unexpected WARN for %q in:\n%s", s, out)
		}
	}
}
