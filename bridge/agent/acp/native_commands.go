package acp

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"sync"

	"github.com/chenhg5/cc-connect/core"
)

// An ACP server advertises its slash commands with an available_commands_update and runs one
// when a session/prompt is exactly that command. Each session keeps the list it was given, so
// sendLocked can leave the model-control instructions off such a prompt, and hands it to its
// agent, which answers the engine's question before a session exists (core.NativeCommandAgent).

var _ core.NativeCommandAgent = (*Agent)(nil)

// nativeCommands is the set of advertised command names, without the leading slash.
type nativeCommands struct {
	mu    sync.RWMutex
	names map[string]bool
}

func (c *nativeCommands) set(names map[string]bool) {
	c.mu.Lock()
	c.names = names
	c.mu.Unlock()
}

// has reports whether text is one of the commands: a leading slash, an advertised name, then
// nothing or arguments on the same line.
func (c *nativeCommands) has(text string) bool {
	name, ok := strings.CutPrefix(strings.TrimSpace(text), "/")
	if !ok {
		return false
	}
	name, _, _ = strings.Cut(name, " ")
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.names[name]
}

func (c *nativeCommands) known() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.names != nil
}

// commandReporter is implemented by *Agent; optional so test callbacks need not implement it.
type commandReporter interface{ reportCommands(names map[string]bool) }

func (a *Agent) reportCommands(names map[string]bool) { a.commands.set(names) }

// absorbAvailableCommands records an available_commands_update and reports whether params was
// one. It is session metadata, not turn output, so it is read ahead of the strict-resume guard.
func (s *acpSession) absorbAvailableCommands(params json.RawMessage) bool {
	var wrap struct {
		Update struct {
			Kind     string `json:"sessionUpdate"`
			Commands []struct {
				Name string `json:"name"`
			} `json:"availableCommands"`
		} `json:"update"`
	}
	if json.Unmarshal(params, &wrap) != nil || wrap.Update.Kind != "available_commands_update" {
		return false
	}
	names := make(map[string]bool, len(wrap.Update.Commands))
	for _, c := range wrap.Update.Commands {
		names[strings.TrimPrefix(c.Name, "/")] = true
	}
	s.commands.set(names)
	if r, ok := s.callbacks.(commandReporter); ok {
		r.reportCommands(names)
	}
	return true
}

// IsNativeCommand answers from what the last handshake advertised. Right after start-up nothing
// has been seen yet, so the first question starts a throwaway session to ask, once (the same
// way AvailableModels does).
func (a *Agent) IsNativeCommand(ctx context.Context, text string) bool {
	if !strings.HasPrefix(strings.TrimSpace(text), "/") {
		return false
	}
	a.commandsProbe.Do(func() {
		if a.commands.known() {
			return
		}
		s, err := a.StartSession(ctx, "")
		if err != nil {
			slog.Warn("acp: could not probe the agent's slash commands", "error", err)
			return
		}
		_ = s.Close()
	})
	return a.commands.has(text)
}
