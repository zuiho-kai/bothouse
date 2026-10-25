package ccconnect

import (
	"os"
	"path/filepath"
	"strings"
)

// DataDirEnv names the product data directory explicitly. contrib/gate/datadir.py reads the
// same variable, so the bridge, setup commands, the gate and the lead scripts agree on one place.
const DataDirEnv = "BOTHOUSE_DATA_DIR"

// DataDir selects the home data directory without creating or migrating anything.
// BOTHOUSE_DATA_DIR wins when set. Otherwise existing installations keep their data
// until a new bothouse directory exists.
func DataDir(home string) string {
	if dir := os.Getenv(DataDirEnv); dir != "" {
		if dir == "~" || strings.HasPrefix(dir, "~/") {
			dir = filepath.Join(home, dir[1:])
		}
		return filepath.Clean(dir)
	}
	preferred := filepath.Join(home, ".bothouse")
	if _, err := os.Stat(preferred); os.IsNotExist(err) {
		legacy := filepath.Join(home, ".cc-connect")
		if info, err := os.Stat(legacy); err == nil && info.IsDir() {
			return legacy
		}
	}
	return preferred
}
