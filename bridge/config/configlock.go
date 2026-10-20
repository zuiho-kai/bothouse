package config

import (
	"log/slog"
	"path/filepath"
	"sync"
)

// configLock serialises every read-modify-write of config.toml: in this process
// (mutex) and across processes (file lock) — the running service, the web wizard
// and `cc-connect setup apply` all go through configMu, so none of them can
// overwrite another's change.
type configLock struct {
	mu      sync.Mutex
	release func()
}

func (l *configLock) Lock() {
	l.mu.Lock()
	if ConfigPath == "" {
		return
	}
	rel, err := lockConfigFile(ConfigPath)
	if err != nil {
		slog.Warn("config: cross-process lock unavailable, continuing with the in-process lock only", "error", err)
		return
	}
	l.release = rel
}

func (l *configLock) Unlock() {
	if l.release != nil {
		l.release()
		l.release = nil
	}
	l.mu.Unlock()
}

// configLockPath is the lock file next to config.toml (.config.toml.write.lock).
func configLockPath(configPath string) string {
	return filepath.Join(filepath.Dir(configPath), "."+filepath.Base(configPath)+".write.lock")
}
