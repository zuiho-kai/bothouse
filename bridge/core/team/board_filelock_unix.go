//go:build !windows

package team

import (
	"fmt"
	"os"
	"syscall"
	"time"
)

// LockBoardFile takes board.py's cross-process lock on <dir>/board.lock (contrib/gate/board.py
// _locked: open the file, fcntl.flock LOCK_EX, held until it is closed) and returns the unlock.
// The same lock file and the same flock, so a bridge write and a concurrent board command cannot
// interleave (_write's tmp + rename only makes each single write atomic).
func LockBoardFile(path string) (func(), error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	deadline := time.Now().Add(BoardLockWait)
	for {
		err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
		if err == nil {
			break
		}
		if err != syscall.EWOULDBLOCK || time.Now().After(deadline) {
			f.Close()
			return nil, fmt.Errorf("board is locked by another process: %w", err)
		}
		time.Sleep(BoardLockPoll)
	}
	return func() {
		_ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
		f.Close()
	}, nil
}
