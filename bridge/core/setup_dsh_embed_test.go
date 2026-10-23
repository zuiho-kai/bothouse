package core

import (
	"os"
	"path/filepath"
	"testing"
)

func TestExtractEmbeddedDSH(t *testing.T) {
	tempDir := t.TempDir()
	scriptPath, err := ExtractEmbeddedDSH(tempDir)
	if err != nil {
		t.Fatalf("ExtractEmbeddedDSH failed: %v", err)
	}

	expectedScript := filepath.Join(tempDir, "install.sh")
	if scriptPath != expectedScript {
		t.Errorf("expected script path %s, got %s", expectedScript, scriptPath)
	}

	info, err := os.Stat(scriptPath)
	if err != nil {
		t.Fatalf("stat install.sh failed: %v", err)
	}
	if info.Mode().Perm() != 0755 {
		t.Errorf("install.sh should have 0755 permissions, got %o", info.Mode().Perm())
	}

	requiredFiles := []string{
		"install.sh",
		filepath.Join("collab", "package.json"),
		filepath.Join("collab", "plugin.mjs"),
		filepath.Join("packages", "client-ui-discord", "package.json"),
		filepath.Join("packages", "client-ui-discord", "lib", "client.js"),
		filepath.Join("packages", "client-ui-discord", "lib", "style.css"),
	}

	for _, f := range requiredFiles {
		p := filepath.Join(tempDir, f)
		if !fileExists(p) {
			t.Errorf("required file %s missing after extraction", f)
		}
	}
}
