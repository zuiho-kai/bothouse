package ccconnect

import (
	"os"
	"os/user"
	"path/filepath"
	"strings"
	"testing"
)

// DataDirEnv names the product data directory explicitly. contrib/gate/datadir.py reads the
// same variable, so the bridge, setup commands, the gate and the lead scripts agree on one place.
const DataDirEnv = "BOTHOUSE_DATA_DIR"

// DataDir selects the home data directory without creating or migrating anything.
// BOTHOUSE_DATA_DIR wins when set. Otherwise existing installations keep their data
// until a new bothouse directory exists.
func DataDir(home string) string {
	return GuardTestDataDir(dataDir(home))
}

func dataDir(home string) string {
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

// GuardTestDataDir stops a test binary that resolved the account's live data directory.
// 2026-11-01: a `go test ./...` run from an agent session set HOME to a temp dir but kept the
// BOTHOUSE_DATA_DIR the bridge gives every agent, so a setup test rewrote the live team files,
// hooks and tools. A live directory is the real account's ~/.bothouse or ~/.cc-connect holding
// a config.toml; CI homes have none, so ordinary test runs are unaffected.
func GuardTestDataDir(dir string) string {
	if dir == "" || !testing.Testing() {
		return dir
	}
	u, err := user.Current()
	if err != nil || u.HomeDir == "" {
		return dir
	}
	clean := filepath.Clean(dir)
	if abs, err := filepath.Abs(clean); err == nil {
		clean = abs
	}
	for _, name := range []string{".bothouse", ".cc-connect"} {
		live := filepath.Join(u.HomeDir, name)
		if clean != live && !strings.HasPrefix(clean, live+string(filepath.Separator)) {
			continue
		}
		if _, err := os.Stat(filepath.Join(live, "config.toml")); err == nil {
			panic("test run reached the live data directory " + clean + " (unset " + DataDirEnv + " / CC_DATA_DIR and use a temp HOME, e.g. iso-check)")
		}
	}
	return dir
}
