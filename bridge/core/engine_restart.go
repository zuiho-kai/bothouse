package core

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"time"
)

// SaveRestartNotify persists restart info so the new process can send
// a "restart successful" message after startup.
func SaveRestartNotify(dataDir string, req RestartRequest) error {
	dir := filepath.Join(dataDir, "run")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		slog.Warn("SaveRestartNotify: mkdir failed", "dir", dir, "error", err)
	}
	data, _ := json.Marshal(req)
	return os.WriteFile(filepath.Join(dir, "restart_notify"), data, 0o644)
}

// ConsumeRestartNotify reads and deletes the restart notification file.
// Returns nil if no notification is pending.
func ConsumeRestartNotify(dataDir string) *RestartRequest {
	p := filepath.Join(dataDir, "run", "restart_notify")
	data, err := os.ReadFile(p)
	if err != nil {
		return nil
	}
	os.Remove(p)
	var req RestartRequest
	if json.Unmarshal(data, &req) != nil {
		return nil
	}
	return &req
}

// SendRestartNotification sends a "restart successful" message to the
// platform/session that initiated the restart. For async-recoverable
// platforms that may not be ready yet at startup, the call is queued
// and dispatched on the first OnPlatformReady for the matching platform
// (see issue #1383).
func (e *Engine) SendRestartNotification(platformName, sessionKey string) {
	req := &RestartRequest{Platform: platformName, SessionKey: sessionKey}
	e.SetPendingRestartNotify(req)
}

// SetPendingRestartNotify queues a restart notification for dispatch
// when the target platform becomes ready. Replaces any previously queued
// notify. If the target platform is already ready, the notify is
// dispatched on a background goroutine with retry on send failure.
func (e *Engine) SetPendingRestartNotify(req *RestartRequest) {
	if req == nil {
		return
	}
	e.pendingRestartMu.Lock()
	e.pendingRestartNotify = req
	e.pendingRestartFiredCh = make(chan struct{})
	firedCh := e.pendingRestartFiredCh
	e.pendingRestartMu.Unlock()

	// If the target platform is already ready, fire the dispatch on a
	// goroutine so the caller (main startup) is not blocked. If not yet
	// ready, OnPlatformReady will pick it up. A safety goroutine drops
	// the notify after a timeout if the platform never reaches ready.
	go e.runPendingRestartNotify(req, firedCh)
}

// ConsumePendingRestartNotify returns the currently queued notify (if any)
// and clears it. Used by tests.
func (e *Engine) ConsumePendingRestartNotify() *RestartRequest {
	e.pendingRestartMu.Lock()
	defer e.pendingRestartMu.Unlock()
	req := e.pendingRestartNotify
	e.pendingRestartNotify = nil
	return req
}

// SetPendingRestartTimeout overrides the safety timeout used by
// runPendingRestartNotify. Production code uses defaultPendingRestartTimeout
// (10s); tests use this to exercise the timeout path quickly.
func (e *Engine) SetPendingRestartTimeout(d time.Duration) {
	e.pendingRestartTimeout = d
}

// runPendingRestartNotify dispatches the notify for a platform that is
// already ready, with bounded retry on transient send failure. The fired
// channel is closed when the notify is fully resolved (success, exhausted
// retries, or platform dropped from engine). This is called from
// SetPendingRestartNotify on a background goroutine and from
// onPlatformReady (also on a goroutine).
func (e *Engine) runPendingRestartNotify(req *RestartRequest, firedCh chan struct{}) {
	defer close(firedCh)

	// Recover from any panic inside dispatch (ReconstructReplyCtx / Send) so a
	// platform-side panic cannot take down the whole cc-connect process.
	// See #1686 P1-A. Without this defer, a panic in the restart-notify
	// goroutine kills the daemon because no higher-level recover exists.
	defer func() {
		if r := recover(); r != nil {
			const maxStackBytes = 8192
			stack := make([]byte, maxStackBytes)
			n := runtime.Stack(stack, false)
			slog.Error("restart notify panic",
				"platform", req.Platform,
				"session", req.SessionKey,
				"panic", r,
				"stack", string(stack[:n]))
		}
	}()

	// Wait briefly for the platform to reach ready if it's not already.
	// Upper bound: matches the typical Telegram 2-3 s connect window
	// with margin (see defaultPendingRestartTimeout), and short enough
	// that a stuck platform does not block startup logging forever.
	timeout := e.pendingRestartTimeout
	if timeout <= 0 {
		timeout = defaultPendingRestartTimeout
	}
	deadline := time.Now().Add(timeout)
	for {
		e.pendingRestartMu.Lock()
		stillQueued := e.pendingRestartNotify == req
		e.pendingRestartMu.Unlock()
		if !stillQueued {
			return
		}
		if e.lookupReadyPlatform(req.Platform) != nil {
			break
		}
		if time.Now().After(deadline) {
			slog.Warn("restart notify: target platform did not reach ready in time, dropping",
				"platform", req.Platform, "session", req.SessionKey, "timeout", timeout)
			e.clearPendingRestart(req)
			return
		}
		time.Sleep(200 * time.Millisecond)
	}

	if err := e.dispatchRestartNotify(req); err != nil {
		slog.Warn("restart notify: dispatch failed after retries",
			"platform", req.Platform, "session", req.SessionKey, "error", err)
	}
	e.clearPendingRestart(req)
}

// lookupReadyPlatform returns the platform with the given name if it has
// reached ready state, otherwise nil.
func (e *Engine) lookupReadyPlatform(platformName string) Platform {
	e.platformLifecycleMu.Lock()
	defer e.platformLifecycleMu.Unlock()
	for p, ready := range e.platformReady {
		if ready && p.Name() == platformName {
			return p
		}
	}
	return nil
}

// clearPendingRestart removes the queued notify if it is still the same
// request (avoids clearing a newer notify that replaced this one).
func (e *Engine) clearPendingRestart(req *RestartRequest) {
	e.pendingRestartMu.Lock()
	if e.pendingRestartNotify == req {
		e.pendingRestartNotify = nil
	}
	e.pendingRestartMu.Unlock()
}

// dispatchRestartNotify sends the notify to the target platform with up
// to 3 attempts (initial + 2 retries) on transient failure. The
// platform must already be ready when this is called.
func (e *Engine) dispatchRestartNotify(req *RestartRequest) error {
	p := e.lookupReadyPlatform(req.Platform)
	if p == nil {
		return fmt.Errorf("platform %q not ready", req.Platform)
	}
	rc, ok := p.(ReplyContextReconstructor)
	if !ok {
		return fmt.Errorf("platform %q does not support ReconstructReplyCtx", req.Platform)
	}
	rctx, err := rc.ReconstructReplyCtx(req.SessionKey)
	if err != nil {
		return fmt.Errorf("reconstruct reply ctx: %w", err)
	}
	text := req.Text
	if text == "" {
		text = e.i18n.T(MsgRestartSuccess)
		if CurrentVersion != "" {
			text += fmt.Sprintf(" (%s)", CurrentVersion)
		}
	}

	backoffs := []time.Duration{0, 500 * time.Millisecond, 1500 * time.Millisecond}
	var lastErr error
	for attempt, wait := range backoffs {
		if wait > 0 {
			time.Sleep(wait)
		}
		if err := e.waitOutgoing(p); err != nil {
			lastErr = fmt.Errorf("wait outgoing: %w", err)
			slog.Warn("restart notify: wait outgoing failed",
				"platform", req.Platform, "attempt", attempt+1, "error", err)
			continue
		}
		if err := p.Send(e.ctx, rctx, text); err != nil {
			lastErr = err
			slog.Warn("restart notify: send failed, will retry",
				"platform", req.Platform, "session", req.SessionKey,
				"attempt", attempt+1, "max_attempts", len(backoffs), "error", err)
			continue
		}
		if attempt > 0 {
			slog.Info("restart notify: send succeeded after retry",
				"platform", req.Platform, "session", req.SessionKey, "attempt", attempt+1)
		}
		return nil
	}
	return lastErr
}

// RestartCh is signaled when /restart is invoked. main listens on it
// to perform a graceful shutdown followed by syscall.Exec.
var RestartCh = make(chan RestartRequest, 1)
