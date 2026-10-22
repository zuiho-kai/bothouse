package ccconnect

import (
	"os"
	"path/filepath"
)

// DataDir selects the home data directory without creating or migrating anything.
// Existing installations keep their data until a new bothouse directory exists.
func DataDir(home string) string {
	preferred := filepath.Join(home, ".bothouse")
	if _, err := os.Stat(preferred); os.IsNotExist(err) {
		legacy := filepath.Join(home, ".cc-connect")
		if info, err := os.Stat(legacy); err == nil && info.IsDir() {
			return legacy
		}
	}
	return preferred
}
