package codex

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"

	"github.com/chenhg5/cc-connect/core"
)

// CompactSession uses a short-lived stdio app-server for both chat backends.
// It resumes exactly the persisted thread; no user prompt or replacement thread
// is created. The engine must hold the conversation lock and close idle readers.
func (a *Agent) CompactSession(ctx context.Context, id string) error {
	return a.compact(ctx, id, nil)
}

func (a *Agent) compact(ctx context.Context, id string, settings *core.SessionSettings) error {
	if id == "" || id == core.ContinueSession {
		return fmt.Errorf("codex compact requires an existing thread")
	}
	snapshot, err := a.startSessionWith(ctx, id, true, settings)
	if err != nil {
		return err
	}
	defer snapshot.Close()
	return snapshot.(*codexSession).compactNative(ctx)
}

type compactEnvelope struct {
	ID     json.RawMessage `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
	Result json.RawMessage `json:"result"`
	Error  *rpcError       `json:"error"`
}

func (cs *codexSession) compactNative(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	args := append([]string(nil), cs.cliExtraArgs...)
	args = append(args, "app-server")
	for _, kv := range [][2]string{{"model", cs.model}, {"model_reasoning_effort", cs.effort}, {"model_provider", cs.modelProvider}, {"openai_base_url", cs.baseURL}} {
		if kv[1] != "" {
			args = append(args, "-c", fmt.Sprintf("%s=%q", kv[0], kv[1]))
		}
	}
	cmd := exec.CommandContext(ctx, cs.cmd, args...)
	cmd.Dir = cs.workDir
	cmd.Env = core.MergeEnv(os.Environ(), cs.extraEnv)
	// Never persist raw stderr: it can contain provider headers and conversation text.
	cmd.Stderr = io.Discard
	in, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		in.Close()
		return err
	}
	if err = cmd.Start(); err != nil {
		in.Close()
		out.Close()
		return fmt.Errorf("codex compact app-server start: %w", err)
	}
	defer func() { cancel(); in.Close(); out.Close(); _ = cmd.Wait() }()
	packets := make(chan compactEnvelope, 32)
	readErr := make(chan error, 1)
	go func() {
		defer close(packets)
		scanner := bufio.NewScanner(out)
		scanner.Buffer(make([]byte, 65536), 16*1024*1024)
		for scanner.Scan() {
			var p compactEnvelope
			if err := json.Unmarshal(scanner.Bytes(), &p); err != nil {
				readErr <- fmt.Errorf("invalid app-server JSON")
				return
			}
			select {
			case packets <- p:
			case <-ctx.Done():
				return
			}
		}
		if err := scanner.Err(); err != nil {
			readErr <- err
		} else {
			readErr <- io.EOF
		}
	}()
	write := func(id int, method string, params any) error {
		p := map[string]any{"method": method, "params": params}
		if id != 0 {
			p["id"] = id
		}
		return json.NewEncoder(in).Encode(p)
	}
	if err = write(1, "initialize", map[string]any{"clientInfo": map[string]any{"name": "cc-connect-compact", "version": "1.0"}}); err != nil {
		return err
	}
	state := compactProgress{thread: cs.CurrentSessionID()}
	expected := 1
	ack := false
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case packet, ok := <-packets:
			if !ok {
				if ctx.Err() != nil {
					return ctx.Err()
				}
				return fmt.Errorf("codex compact connection closed before completion: %w", <-readErr)
			}
			if len(packet.ID) > 0 && string(packet.ID) != "null" {
				if packet.Method != "" {
					return fmt.Errorf("unexpected app-server request during compaction: %s", packet.Method)
				}
				var id int
				if json.Unmarshal(packet.ID, &id) != nil || id != expected {
					return fmt.Errorf("unexpected compaction RPC response")
				}
				if packet.Error != nil {
					return fmt.Errorf("codex compact: %s", packet.Error.Message)
				}
				switch id {
				case 1:
					if err = write(0, "initialized", nil); err != nil {
						return err
					}
					params := map[string]any{"threadId": state.thread, "excludeTurns": true, "cwd": cs.workDir}
					if cs.model != "" {
						params["model"] = cs.model
					}
					cfg := map[string]any{}
					if cs.effort != "" {
						cfg["model_reasoning_effort"] = cs.effort
					}
					if cs.compactInstructions != "" {
						params["baseInstructions"] = cs.compactInstructions
					}
					approval, sandbox := appServerModeSettings(cs.mode)
					params["approvalPolicy"] = approval
					// Same rule as appServerSession.threadRequestParams: an explicit
					// sandbox would override the permission profile.
					if cs.compactPermissionProfile != "" {
						cfg["default_permissions"] = cs.compactPermissionProfile
					} else {
						params["sandbox"] = sandbox
					}
					if len(cfg) > 0 {
						params["config"] = cfg
					}
					if err = write(2, "thread/resume", params); err != nil {
						return err
					}
					expected = 2
				case 2:
					var resp threadResumeResponse
					if json.Unmarshal(packet.Result, &resp) != nil || resp.Thread.ID != state.thread {
						return fmt.Errorf("codex compact resumed a different or missing thread")
					}
					if cs.model != "" && resp.Model != "" && resp.Model != cs.model {
						return fmt.Errorf("codex compact model mismatch: requested %s, got %s", cs.model, resp.Model)
					}
					if err = write(3, "thread/compact/start", map[string]any{"threadId": state.thread}); err != nil {
						return err
					}
					expected = 3
				case 3:
					ack = true
					expected = 0
				}
			} else if expected == 3 || ack {
				// Discard resume-time history/status events; only this operation can finish it.
				if err = state.notification(packet.Method, packet.Params); err != nil {
					return err
				}
			}
			if ack && state.done {
				return nil
			}
		}
	}
}

// compactProgress deliberately ignores thread-idle and the RPC acknowledgement.
// Success requires the compact item and a successful terminal turn on this thread.
type compactProgress struct {
	thread, turn       string
	itemComplete, done bool
}

func (p *compactProgress) notification(method string, raw json.RawMessage) error {
	var target struct {
		ThreadID string `json:"threadId"`
		TurnID   string `json:"turnId"`
	}
	if err := json.Unmarshal(raw, &target); err != nil {
		return fmt.Errorf("invalid compaction notification")
	}
	if target.ThreadID != "" && target.ThreadID != p.thread {
		return nil
	}
	switch method {
	case "turn/started":
		var n turnNotification
		if err := json.Unmarshal(raw, &n); err != nil {
			return err
		}
		if n.ThreadID != p.thread || n.Turn.ID == "" {
			return nil
		}
		if p.turn != "" && p.turn != n.Turn.ID {
			return fmt.Errorf("concurrent turn during compaction")
		}
		p.turn = n.Turn.ID
	case "item/completed":
		var n itemNotification
		if err := json.Unmarshal(raw, &n); err != nil {
			return err
		}
		if n.ThreadID == p.thread && p.turn != "" && n.TurnID == p.turn && n.Item["type"] == "contextCompaction" {
			p.itemComplete = true
		}
	case "turn/completed":
		var n turnNotification
		if err := json.Unmarshal(raw, &n); err != nil {
			return err
		}
		if n.ThreadID != p.thread || p.turn == "" || n.Turn.ID != p.turn {
			return nil
		}
		if n.Turn.Status != "completed" {
			if n.Turn.Error != nil && strings.TrimSpace(n.Turn.Error.Message) != "" {
				return fmt.Errorf("codex compact: %s", n.Turn.Error.Message)
			}
			return fmt.Errorf("codex compact turn ended with status %q", n.Turn.Status)
		}
		if !p.itemComplete {
			return fmt.Errorf("codex compact turn completed without compaction evidence")
		}
		p.done = true
	case "error":
		if target.TurnID != "" && p.turn != "" && target.TurnID != p.turn {
			return nil
		}
		var n errorNotification
		if err := json.Unmarshal(raw, &n); err != nil {
			return err
		}
		if !n.WillRetry && n.text() != "" {
			return fmt.Errorf("codex compact: %s", n.text())
		}
	}
	return nil
}

// CompactSessionWith implements core.SessionScopedCompressor: the compacted
// session's model and base instructions come in as arguments and are never
// written to the agent other sessions share.
func (a *Agent) CompactSessionWith(ctx context.Context, id string, s core.SessionSettings) error {
	return a.compact(ctx, id, &s)
}
