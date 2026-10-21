package core

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"
)

// Self-update moves the running binary aside before putting the new one in place. On Windows a
// running .exe cannot be deleted, and a cc-connect that keeps running (a restart supervisor, a
// second copy) holds its backup open, so a fixed name like "cc-connect.exe.old" would make the
// next update fail. Each update therefore gets its own backup name, and old backups are removed
// when possible.

var backupSeq atomic.Int64

// BinaryBackupPath returns a fresh backup name for target: "<target>.old-<n>", n = Unix
// microseconds × 1000 + a per-process sequence (macOS clocks stop at microseconds, so the time
// alone repeats), moved on while a file of that name exists.
func BinaryBackupPath(target string) string {
	n := time.Now().UnixMicro()*1000 + backupSeq.Add(1)%1000
	for {
		p := fmt.Sprintf("%s.old-%d", target, n)
		if _, err := os.Lstat(p); err != nil {
			return p // not there (or not checkable: the rename that follows reports it)
		}
		n++
	}
}

func isBinaryBackupOf(name, base string) bool {
	return name == base+".old" || strings.HasPrefix(name, base+".old-")
}

// RemoveBinaryBackups removes earlier backups of target ("<target>.old", "<target>.old-*"), one
// file at a time. Ones still in use (Windows) and the running process's own file are left alone.
func RemoveBinaryBackups(target string) {
	dir, base := filepath.Dir(target), filepath.Base(target)
	self, _ := os.Executable()
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if e.IsDir() || !isBinaryBackupOf(e.Name(), base) {
			continue
		}
		p := filepath.Join(dir, e.Name())
		if self != "" && strings.EqualFold(filepath.Clean(self), filepath.Clean(p)) {
			continue
		}
		_ = os.Remove(p)
	}
}

// BinaryFromBackupPath maps a backup path back to the installed binary when that exists: after a
// self-update os.Executable() of the still-running process reports the backup.
func BinaryFromBackupPath(p string) string {
	dir, name := filepath.Dir(p), filepath.Base(p)
	i := strings.LastIndex(name, ".old")
	if i <= 0 {
		return p
	}
	rest := name[i+len(".old"):]
	if rest != "" {
		if rest[0] != '-' || len(rest) == 1 || strings.Trim(rest[1:], "0123456789") != "" {
			return p
		}
	}
	target := filepath.Join(dir, name[:i])
	if _, err := os.Stat(target); err == nil {
		return target
	}
	return p
}
