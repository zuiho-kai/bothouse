//go:build !windows

package config

import (
	"fmt"
	"os"
	"syscall"
	"time"
)

// configLockWait — 来源：和 filelock_windows.go 一样的 30 秒上限（配置写入是秒级，只防死等）。
var configLockWait = 30 * time.Second

// lockConfigFile takes an exclusive cross-process lock (flock) on a lock file next to
// config.toml, retrying non-blocking until configLockWait.
func lockConfigFile(path string) (func(), error) {
	f, err := os.OpenFile(configLockPath(path), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	deadline := time.Now().Add(configLockWait)
	for {
		err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
		if err == nil {
			break
		}
		if err != syscall.EWOULDBLOCK || time.Now().After(deadline) {
			f.Close()
			return nil, fmt.Errorf("config is locked by another process: %w", err)
		}
		time.Sleep(100 * time.Millisecond)
	}
	return func() {
		_ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
		f.Close()
	}, nil
}
