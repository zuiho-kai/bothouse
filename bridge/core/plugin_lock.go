package core

// 插件 (#150 第 b 项): one writer at a time on the profile's package.json.
//
// DSH serialises every writer of that file through a `package.json.lock` sibling created with
// O_EXCL and holding the holder's pid (`@deepseek-ai/dsh-atomic-write`, withFileLock). Its own
// plugin manager and `dsh plugin` both take that lock, so the panel takes the same one: a switch
// made here and an install started in DSH's page then queue instead of interleaving a read-modify-
// write. The protocol is the same file, the same `wx` create, the same pid record, and a takeover
// only when the recorded process is gone.

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const (
	// pluginLockWait bounds how long a writer waits for the lock.
	// 来源：DSH plugin-manager 的 lockWaitMs 默认 120000（lib/types/index.js），同一个等待上限。
	pluginLockWait = 120 * time.Second
	// pluginLockRetryInitial and pluginLockRetryMax are DSH's own retry cadence.
	// 来源：dsh-atomic-write LOCK_RETRY_INITIAL_MS = 20、LOCK_RETRY_MAX_MS = 200。
	pluginLockRetryInitial = 20 * time.Millisecond
	pluginLockRetryMax     = 200 * time.Millisecond
)

// errPluginLockBusy says another process holds the profile and did not let go in time.
var errPluginLockBusy = errors.New("另一个程序正在改这份 profile")

// withPluginProfileLock runs fn while holding the profile's package.json writer lock.
func withPluginProfileLock(manifestPath string, fn func() error) error {
	lockPath := manifestPath + ".lock"
	deadline := time.Now().Add(pluginLockWait)
	delay := pluginLockRetryInitial
	for {
		f, err := os.OpenFile(lockPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if err == nil {
			_, _ = fmt.Fprintf(f, "%d\n", os.Getpid())
			_ = f.Close()
			break
		}
		if !errors.Is(err, os.ErrExist) {
			return fmt.Errorf("取 profile 写锁失败: %w", err)
		}
		// A lock whose holder is gone can be taken over; one whose holder is alive is waited for.
		if holderGone(lockPath) {
			if rmErr := os.Remove(lockPath); rmErr == nil {
				continue
			}
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("%w（%s）；等它做完再试", errPluginLockBusy, lockPath)
		}
		time.Sleep(delay)
		if delay < pluginLockRetryMax {
			delay *= 2
			if delay > pluginLockRetryMax {
				delay = pluginLockRetryMax
			}
		}
	}
	defer func() { _ = os.Remove(lockPath) }()
	return fn()
}

// holderGone reports whether the pid recorded in the lock no longer exists. An unreadable or
// malformed record is treated as alive: guessing "gone" would let two writers in.
func holderGone(lockPath string) bool {
	raw, err := os.ReadFile(lockPath)
	if err != nil {
		return false
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(raw)))
	if err != nil || pid <= 0 || pid == os.Getpid() {
		return false
	}
	proc, err := os.FindProcess(pid)
	if err != nil {
		return true
	}
	// Signal 0 probes the process without touching it; ESRCH means it is gone. Windows refuses
	// every signal but Kill, and that refusal is read as "alive": waiting is the safe side.
	if err := proc.Signal(syscall.Signal(0)); err != nil {
		return errors.Is(err, os.ErrProcessDone)
	}
	return false
}
