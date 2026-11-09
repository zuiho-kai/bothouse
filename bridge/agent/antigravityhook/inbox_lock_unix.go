//go:build !windows

package antigravityhook

import (
	"os"
	"path/filepath"
	"syscall"
)

const lockSupported = true

// lockDir takes an exclusive flock on <dir>/.lock (bridge and hook processes share it).
func lockDir(dir string) (func(), error) {
	f, err := os.OpenFile(filepath.Join(dir, inboxLock), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX); err != nil {
		f.Close()
		return nil, err
	}
	return func() {
		_ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
		f.Close()
	}, nil
}
