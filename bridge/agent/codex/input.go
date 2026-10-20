package codex

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// Both exec and app_server can resume an exact thread without falling back:
// app_server's thread/resume errors instead of starting a new thread.
func (a *Agent) SupportsStrictResume() bool {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.backend == "exec" || a.backend == "" || a.backend == "app_server"
}

func (a *Agent) StartSessionStrict(ctx context.Context, id string) (core.AgentSession, error) {
	if !a.SupportsStrictResume() {
		return nil, fmt.Errorf("strict input requires codex exec or app_server backend")
	}
	a.mu.RLock()
	home := a.codexHome
	if home == "" {
		env := append([]string(nil), a.configEnv...)
		env = append(env, a.providerEnvLocked()...)
		env = append(env, a.sessionEnv...)
		home = getenvFromList(env, "CODEX_HOME")
	}
	a.mu.RUnlock()
	if err := validateInputResume(id, home); err != nil {
		return nil, err
	}
	as, err := a.StartSession(ctx, id)
	if err != nil {
		return nil, err
	}
	if got := as.CurrentSessionID(); got != id {
		_ = as.Close()
		return nil, fmt.Errorf("codex resumed thread %q, want %q", got, id)
	}
	return as, nil
}

// Check the saved rollout's actual metadata, not just a filename substring.
// Only the session header is read; credentials/config are not part of this check.
func validateInputResume(id, home string) error {
	if id == "" || id == core.ContinueSession {
		return fmt.Errorf("concrete resume ID required")
	}
	path := findSessionFile(id, home)
	if path == "" {
		return fmt.Errorf("original codex session record not found")
	}
	f, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open original codex session: %w", err)
	}
	defer f.Close()
	scanner := bufio.NewScanner(io.LimitReader(f, 1<<20))
	scanner.Buffer(make([]byte, 4096), 1<<20)
	if scanner.Scan() {
		var meta struct {
			Type    string `json:"type"`
			Payload struct {
				ID string `json:"id"`
			} `json:"payload"`
		}
		if json.Unmarshal(scanner.Bytes(), &meta) == nil && meta.Type == "session_meta" && meta.Payload.ID == id {
			return nil
		}
	}
	return fmt.Errorf("original codex session metadata does not match resume ID")
}

var codexInputQuiesceTimeout = 5 * time.Second

func (cs *codexSession) PrepareResumed(expectedID string) error {
	// Wait for all reader cleanup before touching per-turn buffers.
	cs.cmdMu.Lock()
	done := cs.readerDone
	cs.cmdMu.Unlock()
	if done != nil {
		timer := time.NewTimer(codexInputQuiesceTimeout)
		defer timer.Stop()
		select {
		case <-done:
		case <-cs.ctx.Done():
			return fmt.Errorf("codex resume cancelled while waiting for previous turn")
		case <-timer.C:
			cs.alive.Store(false)
			cs.cancel()
			_ = forceKillAllCmds(cs.activeCmds())
			return fmt.Errorf("previous codex process did not finish; resume refused")
		}
	}
	if expectedID == "" || cs.CurrentSessionID() != expectedID {
		return fmt.Errorf("codex live session binding changed")
	}
	return validateInputResume(expectedID, getenvFromList(cs.extraEnv, "CODEX_HOME"))
}

func (cs *codexSession) SendResumed(prompt, messageID string, images []core.ImageAttachment, files []core.FileAttachment, expectedID string) error {
	if err := cs.PrepareResumed(expectedID); err != nil {
		return err
	}
	return cs.send(prompt, messageID, images, files, expectedID)
}

// Strict input must not publish success until the CLI both identifies the
// original thread and exits successfully after a terminal turn.completed.
// Normal Discord sends also wait for exit, but do not require strict ID confirmation.
func (cs *codexSession) readStrictLoop(cmd *exec.Cmd, stdout io.ReadCloser, stderrBuf *bytes.Buffer, expectedID string) {
	defer cs.wg.Done()
	defer cs.removeCmd(cmd)
	confirmed := false
	var terminal map[string]any
	cs.pendingMsgs = nil
	err := readJSONLines(stdout, func(line []byte) error {
		var raw map[string]any
		if err := json.Unmarshal(line, &raw); err != nil {
			return fmt.Errorf("invalid codex event JSON: %w", err)
		}
		kind, _ := raw["type"].(string)
		if terminal != nil {
			return fmt.Errorf("unexpected codex event after turn.completed")
		}
		if kind == "thread.started" {
			id, _ := raw["thread_id"].(string)
			if confirmed || id != expectedID {
				return fmt.Errorf("codex did not resume the original thread")
			}
			confirmed = true
			return nil // Never adopt a new thread ID.
		}
		if kind == "error" {
			message, _ := raw["message"].(string)
			if strings.Contains(message, "Reconnecting") || strings.Contains(message, "Falling back") {
				return nil
			}
			return fmt.Errorf("codex error: %s", message)
		}
		if !confirmed {
			return fmt.Errorf("codex event arrived before original thread confirmation")
		}
		if kind == "turn.failed" {
			detail, _ := json.Marshal(raw["error"])
			return fmt.Errorf("codex turn failed: %s", detail)
		}
		if kind == "turn.completed" {
			terminal = raw
			return nil
		}
		cs.handleEvent(raw)
		return nil
	})
	if err != nil {
		_ = forceKillAllCmds([]*exec.Cmd{cmd})
	}
	waitErr := cmd.Wait()
	if err == nil && waitErr != nil {
		err = fmt.Errorf("codex resume process: %w: %s", waitErr, strings.TrimSpace(stderrBuf.String()))
	}
	if err == nil && (!confirmed || terminal == nil) {
		err = fmt.Errorf("codex resume exited without a completed turn")
	}
	if err != nil {
		cs.pendingMsgs = nil
		select {
		case cs.events <- core.Event{Type: core.EventError, Error: err}:
		case <-cs.ctx.Done():
		}
		return
	}
	cs.handleEvent(terminal)
}
