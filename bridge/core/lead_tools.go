package core

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

var LeadToolFS fs.FS

// InstallLeadTools installs collaboration tools and advertises their absolute paths to one role.
// Gate credentials and service configuration remain user-managed, as described in README.md.
func InstallLeadTools(dataDir, workDir, agentType string) (map[string]string, error) {
	if LeadToolFS == nil {
		return nil, errors.New("collaboration tools are not built into this binary")
	}
	if dataDir == "" || workDir == "" {
		return nil, errors.New("data_dir and work_dir are required")
	}
	root := filepath.Join(dataDir, "collaboration")
	err := fs.WalkDir(LeadToolFS, "contrib", func(p string, d fs.DirEntry, err error) error {
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
		return AtomicWriteFile(dst, b, mode)
	})
	if err != nil {
		return nil, fmt.Errorf("install collaboration tools: %w", err)
	}
	persona := PersonaFilePath(agentType, workDir)
	b, err := os.ReadFile(persona)
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	bin := filepath.Join(root, "lead")
	block := fmt.Sprintf("Collaboration tools (requires Python 3; later/safe-restart/t10 require zsh):\n- Scripts: %s (add this directory to PATH when needed).\n- Read %s before using board, later, lead, safe-restart, d10, t10 or ws-*.\n- Runtime identity: CC_PROJECT and CC_SESSION_KEY (DSH receives CC_SESSION as a fallback). Never invent a session.\n- Configure GATE_SETUP_DIR/GATE_TEAM, BOARD_DIR and CC_BIN for your installation; safe-restart requires CC_LAUNCHD_LABEL on macOS.\n", bin, filepath.Join(bin, "README.md"))
	out := withMarkedBlock(string(b), "<!-- bothouse:lead-tools -->", "<!-- /bothouse:lead-tools -->", block)
	if err := os.MkdirAll(filepath.Dir(persona), 0755); err != nil {
		return nil, err
	}
	if err := AtomicWriteFile(persona, []byte(out), 0644); err != nil {
		return nil, err
	}
	return map[string]string{"tools_dir": bin, "persona_file": persona, "readme": filepath.Join(bin, "README.md")}, nil
}
