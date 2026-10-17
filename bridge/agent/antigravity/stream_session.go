package antigravity

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// streamSession keeps one agy process for a conversation. Permissions still go
// through the same isolated permission bridge as the legacy print transport.
type streamSession struct {
	*antigravitySession
	mu            sync.Mutex
	stdin         io.WriteCloser
	cancelProcess context.CancelFunc
	busy          bool
	streamed      bool
	turnTimer     *time.Timer
	turn          streamTurnEvidence
	tempFiles     []string
	quota         *nativeQuota
}

type agyStreamEvent struct {
	Event          string `json:"event"`
	ConversationID string `json:"conversation_id"`
	Step           struct {
		ConversationID string `json:"conversation_id"`
		Index          *int   `json:"step_index"`
		State          string `json:"state"`
		Type           string `json:"step_type"`
		TextDelta      string `json:"text_delta"`
	} `json:"step_update"`
	Result struct {
		ConversationID string `json:"conversation_id"`
		Status         string `json:"status"`
		Response       string `json:"response"`
		Error          string `json:"error"`
	} `json:"result"`
}

func newStreamSession(ctx context.Context, cmd string, extraArgs []string, workDir, model, mode, resumeID string, extraEnv []string, timeout time.Duration) (*streamSession, error) {
	base, err := newAntigravitySession(ctx, cmd, extraArgs, workDir, model, mode, resumeID, extraEnv, timeout)
	if err != nil {
		return nil, err
	}
	processCtx, cancel := context.WithCancel(base.ctx)
	s := &streamSession{antigravitySession: base, cancelProcess: cancel}
	s.quota, err = newNativeQuota()
	if err != nil {
		cancel()
		_ = base.Close()
		return nil, fmt.Errorf("antigravity: initialize quota authentication: %w", err)
	}
	configDir := ""
	if base.permissionBridge != nil {
		configDir = base.permissionBridge.AgyConfigDir()
	}
	args := base.buildAntigravityArgs(base.CurrentSessionID(), base.CurrentSessionID() != "", mode, configDir, "")
	// Stream input supplies each prompt; no -p argument and no EOF between turns.
	args = append(args[:len(args)-2], "--input-format", "stream-json", "--output-format", "stream-json")
	args = append(args, "--csrf_token="+s.quota.csrf)
	proc := exec.CommandContext(processCtx, cmd, args...)
	proc.WaitDelay = time.Second
	proc.Dir = workDir
	proc.Env = core.MergeEnv(os.Environ(), extraEnv)
	if base.permissionBridge != nil {
		proc.Env = core.MergeEnv(proc.Env, base.permissionBridge.Env())
	}
	// Errors are surfaced by structured result events or the process exit status;
	// unstructured stderr may contain credentials from CLI/provider diagnostics.
	proc.Stderr = io.Discard
	stdout, err := proc.StdoutPipe()
	if err == nil {
		s.stdin, err = proc.StdinPipe()
	}
	if err == nil {
		err = proc.Start()
	}
	if err != nil {
		cancel()
		if stdout != nil {
			_ = stdout.Close()
		}
		if s.stdin != nil {
			_ = s.stdin.Close()
		}
		_ = base.Close()
		return nil, fmt.Errorf("antigravity: start stream transport: %w", err)
	}
	s.quota.pid = proc.Process.Pid
	base.wg.Add(1)
	go s.readStream(proc, stdout)
	return s, nil
}

func (s *streamSession) Send(prompt, _ string, images []core.ImageAttachment, files []core.FileAttachment) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.Alive() {
		return fmt.Errorf("antigravity: stream session is closed")
	}
	if s.busy {
		return fmt.Errorf("antigravity: previous stream turn is still running")
	}
	fullPrompt, tempFiles := s.preparePrompt(prompt, images, files)
	s.tempFiles = tempFiles
	s.busy, s.streamed = true, false
	s.turn = streamTurnEvidence{}
	input := struct {
		Event   string            `json:"event"`
		Message map[string]string `json:"message"`
	}{Event: "user", Message: map[string]string{"content": fullPrompt}}
	if err := json.NewEncoder(s.stdin).Encode(input); err != nil {
		s.busy = false
		s.alive.Store(false)
		s.cancelProcess()
		return fmt.Errorf("antigravity: write stream prompt: %w", err)
	}
	if s.timeout > 0 {
		// Expiring a turn kills this process; the engine resumes the saved
		// conversation in a new process on the next message.
		s.turnTimer = time.AfterFunc(s.timeout, s.cancelProcess)
	}
	return nil
}

func (s *streamSession) emit(ev core.Event) {
	select {
	case s.events <- ev:
	case <-s.ctx.Done():
	}
}

func (s *streamSession) finishTurnLocked() {
	if s.turnTimer != nil {
		s.turnTimer.Stop()
		s.turnTimer = nil
	}
	for _, path := range s.tempFiles {
		_ = os.Remove(path)
	}
	s.tempFiles = nil
	s.busy = false
}

func (s *streamSession) readStream(proc *exec.Cmd, stdout io.ReadCloser) {
	defer s.wg.Done()
	defer s.quota.close()
	defer s.cancelProcess()
	defer s.stdin.Close()
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 64*1024), 4*1024*1024)
	var protocolErr error
	for scanner.Scan() {
		var ev agyStreamEvent
		if err := json.Unmarshal(scanner.Bytes(), &ev); err != nil {
			protocolErr = fmt.Errorf("antigravity: invalid stream event: %w", err)
			s.cancelProcess()
			break
		}
		s.handleStreamEvent(ev)
	}
	if err := scanner.Err(); err != nil {
		protocolErr = fmt.Errorf("antigravity: read stream: %w", err)
		s.cancelProcess()
	}
	err := proc.Wait()
	s.mu.Lock()
	busy := s.busy
	s.alive.Store(false)
	s.finishTurnLocked()
	s.mu.Unlock()
	if protocolErr != nil {
		s.emit(core.Event{Type: core.EventError, Error: protocolErr})
	} else if err != nil || busy {
		s.emit(core.Event{Type: core.EventError, Error: fmt.Errorf("antigravity: stream process stopped before conversation ended (pending=%t, exit=%v)", busy, err)})
	}
}

func (s *streamSession) handleStreamEvent(ev agyStreamEvent) {
	if ev.ConversationID != "" {
		s.chatID.Store(ev.ConversationID)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	switch ev.Event {
	case "init":
		s.emit(core.Event{Type: core.EventText, SessionID: s.CurrentSessionID()})
	case "step_update":
		if s.busy {
			s.turn.observe(ev)
		}
		if s.busy && ev.Step.Type == "agent_response" && ev.Step.TextDelta != "" {
			if strings.TrimSpace(ev.Step.TextDelta) != "" {
				s.streamed = true
			}
			s.emit(core.Event{Type: core.EventText, Content: ev.Step.TextDelta, SessionID: s.CurrentSessionID()})
		}
	case "result":
		if !s.busy {
			return
		}
		if ev.Result.ConversationID != "" {
			s.chatID.Store(ev.Result.ConversationID)
		}
		content := ev.Result.Response
		if s.streamed {
			content = "" // the result repeats the streamed answer
		}
		succeeded := ev.Result.Status == "SUCCESS"
		var failure error
		if !succeeded {
			succeeded, failure = s.verifyFailedTurn(ev)
			if succeeded {
				slog.Warn("antigravity: ignored historical CLI error after current-turn verification", "turn_start", s.turn.start, "turn_end", s.turn.last)
			}
		}
		s.finishTurnLocked()
		if !succeeded {
			s.emit(core.Event{Type: core.EventError, Error: failure, Content: ev.Result.Response, SessionID: s.CurrentSessionID()})
			return
		}
		if !s.streamed && strings.TrimSpace(content) == "" {
			s.emit(core.Event{Type: core.EventError, Error: core.ErrEmptyAgentResponse, SessionID: s.CurrentSessionID()})
			return
		}
		s.emit(core.Event{Type: core.EventResult, Content: content, SessionID: s.CurrentSessionID(), Done: true})
	}
}
