package core

import (
	"embed"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

//go:embed all:dsh_bundle
var embeddedDSH embed.FS

// ExtractEmbeddedDSH extracts the embedded DSH files into targetDir (default ~/.bothouse/dsh).
// It respects os.UserHomeDir() so HOME overrides in tests or isolated environments work.
func ExtractEmbeddedDSH(targetDir string) (string, error) {
	if targetDir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("resolve user home dir: %w", err)
		}
		targetDir = filepath.Join(home, ".bothouse", "dsh")
	}

	sub, err := fs.Sub(embeddedDSH, "dsh_bundle")
	if err != nil {
		return "", fmt.Errorf("get embedded dsh_bundle sub fs: %w", err)
	}

	err = fs.WalkDir(sub, ".", func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		dest := filepath.Join(targetDir, path)
		if d.IsDir() {
			return os.MkdirAll(dest, 0755)
		}
		data, err := fs.ReadFile(sub, path)
		if err != nil {
			return fmt.Errorf("read embedded file %s: %w", path, err)
		}
		mode := os.FileMode(0644)
		if filepath.Ext(path) == ".sh" || d.Name() == "install.sh" {
			mode = 0755
		}
		if err := os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
			return err
		}
		return os.WriteFile(dest, data, mode)
	})
	if err != nil {
		return "", fmt.Errorf("unpack embedded dsh to %s: %w", targetDir, err)
	}

	scriptPath := filepath.Join(targetDir, "install.sh")
	_ = os.Chmod(scriptPath, 0755)
	return scriptPath, nil
}
