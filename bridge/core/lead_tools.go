package core

import (
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

var LeadToolFS fs.FS

// InstallLeadTools installs collaboration tools and advertises their absolute paths to one role.
// Gate credentials and service configuration remain user-managed, as described in README.md.
// An installed file whose content differs from the embedded one is left alone and returned in
// skipped (relative to the collaboration dir) unless force is set, so local edits survive reinstall.
func InstallLeadTools(dataDir, workDir, agentType string, force bool) (result map[string]string, skipped []string, err error) {
	if LeadToolFS == nil {
		return nil, nil, errors.New("collaboration tools are not built into this binary")
	}
	if dataDir == "" || workDir == "" {
		return nil, nil, errors.New("data_dir and work_dir are required")
	}
	root := filepath.Join(dataDir, "collaboration")
	err = fs.WalkDir(LeadToolFS, "contrib", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		rel := strings.TrimPrefix(p, "contrib/")
		dst := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
			return err
		}
		b, err := fs.ReadFile(LeadToolFS, p)
		if err != nil {
			return err
		}
		mode := fs.FileMode(0644)
		if strings.HasPrefix(rel, "lead/") && !strings.Contains(filepath.Base(rel), ".") {
			mode = 0755
		}
		if !force {
			if old, err := os.ReadFile(dst); err == nil && !bytes.Equal(old, b) {
				skipped = append(skipped, rel)
				return nil
			}
		}
		return AtomicWriteFile(dst, b, mode)
	})
	if err != nil {
		return nil, nil, fmt.Errorf("install collaboration tools: %w", err)
	}
	persona := PersonaFilePath(agentType, workDir)
	b, err := os.ReadFile(persona)
	if err != nil && !os.IsNotExist(err) {
		return nil, nil, err
	}
	bin := filepath.Join(root, "lead")
	block := fmt.Sprintf("Collaboration tools (requires Python 3; later/safe-restart/t10/iso-check require zsh):\n- Scripts: %s. bothouse already puts this directory on your PATH, so run board, later, d10 etc. by name.\n- Read %s before using board, later, lead, safe-restart, d10, t10, ws-*, iso-check or rehearse-copy.\n- Runtime identity: CC_PROJECT and CC_SESSION_KEY (DSH receives CC_SESSION as a fallback). Never invent a session.\n- GATE_SETUP_DIR, BOTHOUSE_DATA_DIR and CC_BIN are already set for you; do not override them. safe-restart requires CC_LAUNCHD_LABEL on macOS.\n", bin, filepath.Join(bin, "README.md"))
	out := withMarkedBlock(string(b), "<!-- bothouse:lead-tools -->", "<!-- /bothouse:lead-tools -->", block)
	if err := os.MkdirAll(filepath.Dir(persona), 0755); err != nil {
		return nil, nil, err
	}
	if err := AtomicWriteFile(persona, []byte(out), 0644); err != nil {
		return nil, nil, err
	}
	return map[string]string{"tools_dir": bin, "persona_file": persona, "readme": filepath.Join(bin, "README.md")}, skipped, nil
}

// Internal lifecycle commands must match the running binary, including upgrades with locally
// customized collaboration tools. Keep a separate managed copy; never overwrite those tools.
var leadRuntimeMu sync.Mutex

func (e *Engine) leadRuntimeDir() (string, error) {
	if LeadToolFS == nil || e.dataDir == "" {
		return "", nil
	}
	leadRuntimeMu.Lock()
	defer leadRuntimeMu.Unlock()
	root := filepath.Join(e.dataDir, "collaboration", "runtime")
	err := fs.WalkDir(LeadToolFS, "contrib", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel := strings.TrimPrefix(p, "contrib/")
		dst := filepath.Join(root, filepath.FromSlash(rel))
		b, err := fs.ReadFile(LeadToolFS, p)
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
	return root, nil
}
