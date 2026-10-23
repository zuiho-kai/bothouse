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
	// The stall watchdog stops a turn whose agy process writes nothing for
	// stallTimeout while no tool or permission prompt is outstanding (e.g. a
	// model request hung on the network). It never fires mid-tool.
	stallTimeout time.Duration
	stallTimer   *time.Timer
	lastProgress time.Time
	stalled      bool
	activeTools  map[int]bool
	tempFiles    []string
	quota        *nativeQuota
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
		ToolName       string `json:"tool_name"`
		ToolInfo       struct {
			Parameters map[string]any `json:"parameters"`
		} `json:"tool_info"`
	} `json:"step_update"`
	Result struct {
		ConversationID string `json:"conversation_id"`
		Status         string `json:"status"`
		Response       string `json:"response"`
		Error          string `json:"error"`
	} `json:"result"`
}

func newStreamSession(ctx context.Context, cmd string, extraArgs []string, workDir, model, mode, resumeID string, extraEnv []string, timeout, stallTimeout time.Duration) (*streamSession, error) {
	base, err := newAntigravitySession(ctx, cmd, extraArgs, workDir, model, mode, resumeID, extraEnv, timeout)
	if err != nil {
		return nil, err
	}
	processCtx, cancel := context.WithCancel(base.ctx)
	s := &streamSession{antigravitySession: base, cancelProcess: cancel, stallTimeout: stallTimeout}
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
	// buildAntigravityArgs already asks for stream-json output (classic transport reads it too).
	args = append(args[:len(args)-2], "--input-format", "stream-json")
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

// CancelTurn: the stream transport keeps one agy process for the whole
// conversation and agy's stream-json input has no cancel event, so a single turn
// cannot be stopped without stopping the process. Returning an error makes core
// fall back to Close; the next message resumes the saved conversation in a new
// process (as after a turn timeout). Overrides the embedded per-turn CancelTurn,
// which only works for the one-process-per-turn transport.
func (s *streamSession) CancelTurn() error {
	return fmt.Errorf("antigravity: stream transport cannot cancel a single turn")
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
	s.activeTools, s.stalled = nil, false
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
	s.touchLocked()
	return nil
}

// touchLocked records stream progress and arms the stall watchdog for a busy turn.
func (s *streamSession) touchLocked() {
	s.lastProgress = time.Now()
	if s.stallTimeout > 0 && s.busy && s.stallTimer == nil {
		s.stallTimer = time.AfterFunc(s.stallTimeout, s.checkStall)
	}
}

func (s *streamSession) checkStall() {
	s.mu.Lock()
	if !s.busy || s.stallTimer == nil {
		s.mu.Unlock()
		return
	}
	idle := time.Since(s.lastProgress)
	waiting := len(s.activeTools) > 0 || (s.permissionBridge != nil && s.permissionBridge.HasPending())
	if waiting || idle < s.stallTimeout {
		// A running tool or a pending human decision is legitimate silence;
		// the engine's idle and turn limits still bound those.
		wait := s.stallTimeout - idle
		if waiting || wait <= 0 {
			wait = s.stallTimeout
		}
		s.stallTimer.Reset(wait)
		s.mu.Unlock()
		return
	}
	s.stalled = true
	s.mu.Unlock()
	slog.Warn("antigravity: no stream progress, stopping stalled turn", "timeout", s.stallTimeout)
	s.cancelProcess()
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
	if s.stallTimer != nil {
		s.stallTimer.Stop()
		s.stallTimer = nil
	}
	s.activeTools = nil
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
	busy, stalled := s.busy, s.stalled
	s.alive.Store(false)
	s.finishTurnLocked()
	s.mu.Unlock()
	if protocolErr != nil {
		s.emit(core.Event{Type: core.EventError, Error: protocolErr})
	} else if stalled {
		s.emit(core.Event{Type: core.EventError, Error: fmt.Errorf("antigravity: no progress for %s, stopped the stuck turn; the next message resumes this conversation", s.stallTimeout)})
	} else if err != nil || busy {
		s.emit(core.Event{Type: core.EventError, Error: fmt.Errorf("antigravity: stream process stopped before conversation ended (pending=%t, exit=%v)", busy, err)})
	}
}

// trackToolLocked surfaces agy tool steps as progress so a long autonomous
// turn is visible and keeps the engine's idle timer alive. Tool output is not
// forwarded: it may contain credentials and the final answer summarizes it.
func (s *streamSession) trackToolLocked(ev agyStreamEvent) {
	step := ev.Step
	if step.Type != "tool" || step.Index == nil {
		return
	}
	idx := *step.Index
	name := step.ToolName
	if name == "" {
		name = "tool"
	}
	if step.State == "ACTIVE" {
		if s.activeTools[idx] {
			return
		}
		if s.activeTools == nil {
			s.activeTools = make(map[int]bool)
		}
		s.activeTools[idx] = true
		params := step.ToolInfo.Parameters
		if params == nil {
			params = map[string]any{}
		}
		s.emit(core.Event{Type: core.EventToolUse, ToolName: name, ToolInput: formatAgyToolInput(params), ToolInputRaw: params, SessionID: s.CurrentSessionID()})
		return
	}
	wasActive := s.activeTools[idx]
	delete(s.activeTools, idx)
	if wasActive && step.State != "DONE" {
		ok := false
		s.emit(core.Event{Type: core.EventToolResult, ToolName: name, ToolStatus: strings.ToLower(step.State), ToolSuccess: &ok, SessionID: s.CurrentSessionID()})
	}
}

func (s *streamSession) handleStreamEvent(ev agyStreamEvent) {
	if ev.ConversationID != "" {
		s.chatID.Store(ev.ConversationID)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.touchLocked()
	switch ev.Event {
	case "init":
		s.emit(core.Event{Type: core.EventText, SessionID: s.CurrentSessionID()})
	case "step_update":
		if s.busy {
			s.turn.observe(ev)
			s.trackToolLocked(ev)
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
				slog.Warn("antigravity: CLI reported failure but the native turn completed cleanly; treating as success", "turn_start", s.turn.start, "turn_end", s.turn.last)
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
