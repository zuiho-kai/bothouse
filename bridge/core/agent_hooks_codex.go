package core

import (
	"bytes"
	"fmt"
	"github.com/BurntSushi/toml"
	"os"
	"path/filepath"
)

// Codex reads hooks alongside active config layers. Only write the role's project
// layer; never mutate CODEX_HOME, credentials or persisted hook trust. The owner
// must trust this project and review new hooks with /hooks before normal use.
func enableCodexHookFeature(workDir string) error {
	path := filepath.Join(workDir, ".codex", "config.toml")
	config := map[string]any{}
	if b, err := os.ReadFile(path); err == nil {
		if _, err := toml.Decode(string(b), &config); err != nil {
			return fmt.Errorf("Codex config left unchanged: %w", err)
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	features, _ := config["features"].(map[string]any)
	if features == nil {
		features = map[string]any{}
	}
	features["hooks"] = true
	config["features"] = features
	var buf bytes.Buffer
	if err := toml.NewEncoder(&buf).Encode(config); err != nil {
		return err
	}
	return AtomicWriteFile(path, buf.Bytes(), 0o600)
}
