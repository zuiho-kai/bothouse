package core

import (
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
)

var LeadToolFS fs.FS

// InstallLeadTools advertises the bridge's own copy of the collaboration tools
// (<dataDir>/collaboration/runtime, written by syncLeadRuntime) to one role. There is one copy
// only: the scripts are not copied anywhere else, so an upgrade never leaves an old set behind.
// Gate credentials and service configuration remain user-managed, as described in README.md.
func InstallLeadTools(dataDir, workDir, agentType string) (map[string]string, error) {
	if LeadToolFS == nil {
		return nil, errors.New("collaboration tools are not built into this binary")
	}
	if dataDir == "" || workDir == "" {
		return nil, errors.New("data_dir and work_dir are required")
	}
	root, err := syncLeadRuntime(dataDir)
	if err != nil {
		return nil, err
	}
	persona := PersonaFilePath(agentType, workDir)
	b, err := os.ReadFile(persona)
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	bin := filepath.Join(root, "lead")
	block := fmt.Sprintf("Collaboration tools (requires Python 3; later/safe-restart/t10/iso-check require zsh):\n- Scripts: %s. bothouse already puts this directory on your PATH, so run board, later, d10 etc. by name.\n- ws-handoff: `ws-handoff <handoff file> \"<task>\" --short <name, at most 10 characters>`; to continue a job already on the board, `ws-handoff --resume <number> \"<what is new>\"`. It opens the task card and picks the workspace itself; no need to read README or the scripts' source. When to hand off follows the team rules.\n- Read %s before using later, lead, safe-restart, d10, t10, iso-check or rehearse-copy.\n- Runtime identity: CC_PROJECT and CC_SESSION_KEY (DSH receives CC_SESSION as a fallback). Never invent a session.\n- GATE_SETUP_DIR, BOTHOUSE_DATA_DIR and CC_BIN are already set for you; do not override them. safe-restart requires CC_LAUNCHD_LABEL on macOS.\n", bin, filepath.Join(bin, "README.md"))
	out := withMarkedBlock(string(b), "<!-- bothouse:lead-tools -->", "<!-- /bothouse:lead-tools -->", block)
	if err := os.MkdirAll(filepath.Dir(persona), 0755); err != nil {
		return nil, err
	}
	if err := AtomicWriteFile(persona, []byte(out), 0644); err != nil {
		return nil, err
	}
	return map[string]string{"tools_dir": bin, "persona_file": persona, "readme": filepath.Join(bin, "README.md")}, nil
}

// The collaboration tools always match the running binary: the one copy lives in
// <dataDir>/collaboration/runtime and is rewritten from the embedded files whenever they differ.
var leadRuntimeMu sync.Mutex

func (e *Engine) leadRuntimeDir() (string, error) {
	return syncLeadRuntime(e.dataDir)
}

func syncLeadRuntime(dataDir string) (string, error) {
	tools := LeadToolFS // read once: role sessions call this while tests swap the embedded tools
	if tools == nil || dataDir == "" {
		return "", nil
	}
	leadRuntimeMu.Lock()
	defer leadRuntimeMu.Unlock()
	root := filepath.Join(dataDir, "collaboration", "runtime")
	err := fs.WalkDir(tools, "contrib", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel := strings.TrimPrefix(p, "contrib/")
		dst := filepath.Join(root, filepath.FromSlash(rel))
		b, err := fs.ReadFile(tools, p)
		if err != nil {
			return err
		}
		if old, err := os.ReadFile(dst); err == nil && bytes.Equal(old, b) {
			return nil
		}
		if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
			return err
		}
		mode := fs.FileMode(0644)
		if strings.HasPrefix(rel, "lead/") && !strings.Contains(filepath.Base(rel), ".") {
			mode = 0755
		}
		return AtomicWriteFile(dst, b, mode)
	})
	if err != nil {
		return "", fmt.Errorf("install lifecycle tools: %w", err)
	}
	if runtime.GOOS == "windows" {
		writeLeadShims(filepath.Join(root, "lead"))
	}
	return root, nil
}
