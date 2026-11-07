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
	"bytes"
	"crypto/sha256"
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
		removed, err := takeOverExitedPluginLock(lockPath)
		if err != nil {
			return fmt.Errorf("接管 profile 写锁失败: %w", err)
		}
		if removed {
			continue
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

// takeOverExitedPluginLock shares DSH atomic-write's record-specific claim. Re-read under the
// claim before removing: a contender may already have replaced the dead holder's record.
func takeOverExitedPluginLock(lockPath string) (bool, error) {
	raw, err := os.ReadFile(lockPath)
	if err != nil || !pluginLockHolderGone(raw) {
		return false, nil
	}
	digest := sha256.Sum256(raw)
	// 来源：dsh-atomic-write takeOverExitedLock uses 16 SHA256 hex characters (8 bytes).
	claim := fmt.Sprintf("%s.takeover-%x", lockPath, digest[:8])
	f, err := os.OpenFile(claim, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if errors.Is(err, os.ErrExist) || errors.Is(err, syscall.EPERM) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	defer func() { _ = os.Remove(claim) }()
	_, writeErr := fmt.Fprintf(f, "%d\n", os.Getpid())
	closeErr := f.Close()
	if err := errors.Join(writeErr, closeErr); err != nil {
		return false, err
	}
	if pluginLockAfterClaim != nil {
		pluginLockAfterClaim()
	}
	current, err := os.ReadFile(lockPath)
	if err != nil || !bytes.Equal(current, raw) || !pluginLockHolderGone(current) {
		// 记录已经换了（别人抢先用同一份哈希拿了 claim 并写上了自己的活记录），
		// 或者写进来的人不是 DSH 的格式：都不是我们该删的那一条。
		return false, nil
	}
	return os.Remove(lockPath) == nil, nil
}

// pluginLockAfterClaim is nil in production; a test sets it to act as the contender that
// replaces the dead holder's record in the window between taking the claim and re-reading it.
// Without this seam that window only opens under a real race, and the branch that decides
// whether a live record survives would stay untested.
var pluginLockAfterClaim func()

// pluginLockHolderGone accepts only DSH's complete PID record. Unreadable, partial and
// malformed records never prove that the holder exited.
func pluginLockHolderGone(raw []byte) bool {
	record := string(raw)
	if !strings.HasSuffix(record, "\n") {
		return false
	}
	digits := strings.TrimSuffix(record, "\n")
	for _, c := range digits {
		if c < '0' || c > '9' {
			return false
		}
	}
	// 来源：DSH holderExited accepts only positive signed 32-bit PIDs.
	parsed, err := strconv.ParseInt(digits, 10, 32)
	pid := int(parsed)
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
		return errors.Is(err, os.ErrProcessDone) || errors.Is(err, syscall.ESRCH)
	}
	return false
}
