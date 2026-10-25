package core

import (
	"log/slog"
	"os"
	"path/filepath"
	"strings"
)

// roleSessionEnv is the env every role process gets (normal turns and relays alike): its identity for
// `bothouse cron/send …`, the bridge's data dir under both names the gate/lead scripts read (same as
// gate_proc.go: contrib/gate/datadir.py lets lead.json follow BOTHOUSE_DATA_DIR and the rest
// GATE_SETUP_DIR, so they must not diverge), the board dir, CC_BIN, and a PATH that has the product
// Python, the collaboration scripts (board, later, d10, …) and this binary in front.
func (e *Engine) roleSessionEnv(sessionKey string) []string {
	env := []string{
		"CC_PROJECT=" + e.name,
		"CC_SESSION_KEY=" + sessionKey,
	}
	var path []string
	if e.dataDir != "" {
		env = append(env,
			"CC_DATA_DIR="+e.dataDir,
			"GATE_SETUP_DIR="+e.dataDir,
			"BOTHOUSE_DATA_DIR="+e.dataDir,
			"BOARD_DIR="+filepath.Join(e.dataDir, "team"))
		if v := e.productPyBin.Load(); v != nil {
			if dir := v.(string); dir != "" {
				path = append(path, dir)
			}
		}
		if lead := filepath.Join(e.dataDir, "collaboration", "lead"); dirExists(lead) {
			path = append(path, lead)
		}
	}
	if exePath, err := os.Executable(); err == nil {
		env = append(env, "CC_BIN="+exePath)
		path = append(path, filepath.Dir(exePath))
	}
	if cur := os.Getenv("PATH"); cur != "" {
		path = append(path, cur)
	}
	if len(path) > 0 {
		env = append(env, "PATH="+strings.Join(path, string(filepath.ListSeparator)))
	}
	return env
}

// resolveRoleProductPython finds the product Python once, off the reply path (the first lookup may
// download uv / Python 3.12), and keeps its bin dir for roleSessionEnv. On failure the PATH entry is
// simply left out; roles still get the rest of their env.
func (e *Engine) resolveRoleProductPython() {
	if e.dataDir == "" {
		return
	}
	go func() {
		dir, err := ProductPythonBinDir(e.dataDir)
		if err != nil {
			slog.Warn("role env: no product Python for role PATH; lead scripts use the system python3", "project", e.name, "error", err)
			return
		}
		if dirExists(dir) {
			e.productPyBin.Store(dir)
		}
	}()
}

func dirExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.IsDir()
}
