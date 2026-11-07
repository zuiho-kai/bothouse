//go:build windows

package core

import (
	"fmt"
	"os"
	"time"

	"golang.org/x/sys/windows"
)

// lockBoardFile takes board.py's cross-process lock on <dir>/board.lock (contrib/gate/filelock.py:
// on Windows it locks byte 0 with msvcrt.locking LK_NBLCK and retries every 0.2s) and returns the
// unlock. msvcrt.locking is LockFile underneath; LockFileEx on the same single byte at offset 0 is
// the same kernel byte-range lock, so a bridge write and a concurrent board command conflict the
// same way they do between two board commands.
func lockBoardFile(path string) (func(), error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	deadline := time.Now().Add(boardProgressLockWait)
	for {
		err := windows.LockFileEx(windows.Handle(f.Fd()),
			windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, new(windows.Overlapped))
		if err == nil {
			break
		}
		if time.Now().After(deadline) {
			f.Close()
			return nil, fmt.Errorf("board is locked by another process: %w", err)
		}
		time.Sleep(boardProgressLockPoll)
	}
	return func() {
		_ = windows.UnlockFileEx(windows.Handle(f.Fd()), 0, 1, 0, new(windows.Overlapped))
		f.Close()
	}, nil
}
