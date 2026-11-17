package core

import (
	"context"
	_ "embed"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// acp_presets.json lists agent CLIs that speak ACP and have no adapter of their own here.
// The setup wizard shows one card per entry. Supporting one more CLI is one more entry in that
// file, no code. Any other ACP agent goes through the wizard's "custom agent" card, where the
// user types the command.
//
//go:embed acp_presets.json
var acpPresetsJSON []byte

type ACPPreset struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	// Cmd: in acp_presets.json, the launch command with its arguments. In the answer, the same
	// command with the executable's full path when it was found, and empty when it was not: the
	// wizard never offers a command that cannot start.
	Cmd        string `json:"cmd"`
	Bin        string `json:"bin"` // the executable's name, for "not found" messages
	NoteZH     string `json:"note_zh,omitempty"`
	NoteEN     string `json:"note_en,omitempty"`
	InstallURL string `json:"install_url,omitempty"` // where the install steps are
	Found      bool   `json:"found"`
	Path       string `json:"path,omitempty"`    // where the executable was found
	Version    string `json:"version,omitempty"` // as for the CLI list
	// Running: JiuwenSwarm only. Its ACP command is a connector to the JiuwenSwarm main process, so
	// the card says whether that process is up. Absent = not checked.
	Running *bool `json:"running,omitempty"`
}

// ACPPresets returns the entries of acp_presets.json, each looked for the same way as the CLI
// list (lookSpecBin: PATH, then the common install dirs), with its version.
func ACPPresets(ctx context.Context) []ACPPreset {
	var ps []ACPPreset
	if err := json.Unmarshal(acpPresetsJSON, &ps); err != nil {
		return nil
	}
	home, _ := os.UserHomeDir()
	for i := range ps {
		p := &ps[i]
		bin, args := ParseCmdOpts(map[string]any{"cmd": p.Cmd}, "")
		p.Bin, p.Cmd = bin, ""
		if bin == "" {
			continue
		}
		_, path, _ := lookSpecBin(ctx, []string{bin})
		jiuwen := p.ID == "jiuwenswarm"
		var procs []psProc
		if jiuwen {
			procs = psList(ctx)
			if path == "" {
				path = lookJiuwenSwarm(home, procs)
			}
		}
		if path == "" {
			continue
		}
		p.Found, p.Path = true, path
		if strings.ContainsAny(path, " \t") && len(args) > 0 {
			path = `"` + path + `"`
		}
		p.Cmd = strings.Join(append([]string{path}, args...), " ")
		if jiuwen {
			p.Version = pipVersion(p.Path, "workswarm")
			if runtime.GOOS != "windows" {
				up := jiuwenRunning(home, procs)
				p.Running = &up
			}
		} else {
			p.Version = versionLine(ctx, p.Path)
		}
	}
	return ps
}

// ── JiuwenSwarm ──────────────────────────────────────────────────────
//
// JiuwenSwarm is a Python package (`pip install workswarm`). A pipx or uv install puts its
// commands in ~/.local/bin, which lookPath already searches. Any other install puts them in the
// Python environment it went into, which neither PATH nor the common install dirs know. As
// LookDSH does for the dsh inside the desktop app, look where it actually is.

type psProc struct {
	pid int
	cmd string
}

// psList is the running processes with their command lines; empty where `ps` is missing
// (Windows). Replaceable in tests.
var psList = func(ctx context.Context) []psProc {
	tctx, cancel := context.WithTimeout(ctx, 5*time.Second) // 来源：沿用 setup_detect.go --version 探测的 5 秒
	defer cancel()
	out, err := exec.CommandContext(tctx, "ps", "-axo", "pid=,command=").Output()
	if err != nil {
		return nil
	}
	var ps []psProc
	for _, line := range strings.Split(string(out), "\n") {
		f := strings.Fields(line)
		if len(f) < 2 {
			continue
		}
		if pid, err := strconv.Atoi(f[0]); err == nil {
			ps = append(ps, psProc{pid, strings.Join(f[1:], " ")})
		}
	}
	return ps
}

func isJiuwenProc(cmd string) bool { return strings.Contains(strings.ToLower(cmd), "jiuwenswarm") }

// lookJiuwenSwarm: (1) `pip install --user` on macOS (~/Library/Python/<ver>/bin); (2) the
// Python environment a running JiuwenSwarm was started from, where jiuwenswarm-acp sits next to
// its python. A source checkout run without `pip install` has no such command; its
// scripts/run_gateway_acp.sh does the same job.
func lookJiuwenSwarm(home string, procs []psProc) string {
	if runtime.GOOS == "darwin" {
		if m, _ := filepath.Glob(filepath.Join(home, "Library", "Python", "*", "bin", "jiuwenswarm-acp")); len(m) > 0 {
			return m[len(m)-1]
		}
	}
	for _, p := range procs {
		if !isJiuwenProc(p.cmd) {
			continue
		}
		python := strings.Fields(p.cmd)[0]
		if !filepath.IsAbs(python) {
			continue
		}
		binDir := filepath.Dir(python)
		if c := filepath.Join(binDir, "jiuwenswarm-acp"); fileExists(c) {
			return c
		}
		// <checkout>/.venv/bin/python
		if c := filepath.Join(filepath.Dir(filepath.Dir(binDir)), "scripts", "run_gateway_acp.sh"); fileExists(c) {
			return c
		}
	}
	return ""
}

// jiuwenRunning: JiuwenSwarm's gateway writes its pid into ~/.jiuwenswarm/.gateway.lock and leaves
// the file behind when it stops, so the pid must still be a JiuwenSwarm process.
func jiuwenRunning(home string, procs []psProc) bool {
	b, err := os.ReadFile(filepath.Join(home, ".jiuwenswarm", ".gateway.lock"))
	if err != nil {
		return false
	}
	var lock struct {
		PID int `json:"pid"`
	}
	if json.Unmarshal(b, &lock) != nil || lock.PID == 0 {
		return false
	}
	for _, p := range procs {
		if p.pid == lock.PID {
			return isJiuwenProc(p.cmd)
		}
	}
	return false
}

// pipVersion reads the version of Python package pkg from the environment the command at path
// belongs to (<env>/lib/python*/site-packages/<pkg>-<version>.dist-info), without running anything.
func pipVersion(path, pkg string) string {
	if real, err := filepath.EvalSymlinks(path); err == nil {
		path = real
	}
	env := filepath.Dir(filepath.Dir(path)) // <env>/bin/<command>
	if filepath.Base(path) == "run_gateway_acp.sh" {
		env = filepath.Join(env, ".venv") // <checkout>/scripts/run_gateway_acp.sh
	}
	for _, lib := range []string{filepath.Join("lib", "python*"), "Lib"} {
		m, _ := filepath.Glob(filepath.Join(env, lib, "site-packages", pkg+"-*.dist-info"))
		if len(m) > 0 {
			return strings.TrimSuffix(strings.TrimPrefix(filepath.Base(m[len(m)-1]), pkg+"-"), ".dist-info")
		}
	}
	return ""
}
