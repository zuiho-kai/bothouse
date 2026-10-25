package core

import (
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// roleSessionEnv is the env every role process gets (normal turns and relays alike): its identity for
// `bothouse cron/send …`, CC_BIN, and a PATH that has the product Python, the collaboration scripts
// (board, later, d10, …) and this binary in front.
//
// GATE_SETUP_DIR / BOTHOUSE_DATA_DIR (the data dir under both names the gate/lead scripts read, same as
// gate_proc.go: contrib/gate/datadir.py lets lead.json follow BOTHOUSE_DATA_DIR and the rest
// GATE_SETUP_DIR, so they must not diverge) are set only when the product collaboration tools are
// installed (<dataDir>/collaboration/lead, the same check as the PATH entry). Without them a role may be
// running private scripts that find their board through their own defaults; forcing these would move
// that board to an empty dir. BOARD_DIR is never set: contrib/gate/board.py defaults to
// <GATE_SETUP_DIR>/team, the same place.
func (e *Engine) roleSessionEnv(sessionKey string) []string {
	env := []string{
		"CC_PROJECT=" + e.name,
		"CC_SESSION_KEY=" + sessionKey,
	}
	var path []string
	if e.dataDir != "" {
		env = append(env, "CC_DATA_DIR="+e.dataDir)
		if v := e.productPyBin.Load(); v != nil {
			if dir := v.(string); dir != "" {
				path = append(path, dir)
			}
		}
		if lead := filepath.Join(e.dataDir, "collaboration", "lead"); dirExists(lead) {
			env = append(env, "GATE_SETUP_DIR="+e.dataDir, "BOTHOUSE_DATA_DIR="+e.dataDir)
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

// resolveRoleProductPython keeps the product Python's bin dir for roleSessionEnv. A python3 link left in
// <dataDir>/tools/bin by an earlier run is taken at once (no lookup, no download), so sessions created
// right after start already have it. Otherwise it is found once, off the reply path (the first lookup
// may download uv / Python 3.12). Until that finishes, roles fall back to the system python3; a session's
// env is fixed when the session is created, so sessions created before then keep that fallback until
// they are reset. On failure the PATH entry is left out and not retried until restart; roles still get
// the rest of their env.
func (e *Engine) resolveRoleProductPython() {
	if e.dataDir == "" {
		return
	}
	if runtime.GOOS != "windows" {
		dir := filepath.Join(AgentToolsDir(e.dataDir), "bin")
		if _, err := os.Stat(filepath.Join(dir, "python3")); err == nil { // follows the link: target must exist
			e.productPyBin.Store(dir)
		}
	}
	// The lookup is shared by the whole process (the gate waits on the same one) and cannot be cancelled,
	// so it runs on its own; the engine only waits for it while running. The link into the data dir is
	// written by the tracked goroutine, which Stop cancels (e.ctx) and joins, so nothing of this engine
	// writes into the data dir after Stop returns.
	ctx, dataDir := e.ctx, e.dataDir
	found := make(chan productPythonResult, 1)
	go func() {
		py, err := ProductPython(dataDir)
		found <- productPythonResult{py, err}
	}()
	e.productPyWG.Add(1)
	go func() {
		defer e.productPyWG.Done()
		var r productPythonResult
		select {
		case <-ctx.Done():
			return
		case r = <-found:
		}
		if r.err == nil && ctx.Err() == nil {
			var dir string
			if dir, r.err = productPythonLink(dataDir, r.py); r.err == nil && dirExists(dir) {
				e.productPyBin.Store(dir)
			}
		}
		if r.err != nil && ctx.Err() == nil {
			slog.Warn("role env: no product Python for role PATH; lead scripts use the system python3", "project", e.name, "error", r.err)
		}
	}()
}

type productPythonResult struct {
	py  string
	err error
}

func dirExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.IsDir()
}
