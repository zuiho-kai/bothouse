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
// when a session/prompt is exactly that command. Each session keeps the list it was given and
// hands it to its
// agent, which answers the engine's question before a session exists (core.NativeCommandAgent).

var _ core.NativeCommandAgent = (*Agent)(nil)

// nativeCommands is the set of advertised command names, without the leading slash; the value
// is whether the command declared an input.
type nativeCommands struct {
	mu    sync.RWMutex
	names map[string]bool
}

func (c *nativeCommands) set(names map[string]bool) {
	c.mu.Lock()
	c.names = names
	c.mu.Unlock()
}

// name returns the advertised command that text invokes, "" when it is not one: a leading slash
// and an advertised name, spelled as advertised (the server matches case), then nothing, or
// arguments when the command declared an input. The server runs a command without an input
// whatever follows it, so "/context why is it so big" is a sentence, not that command.
func (c *nativeCommands) name(text string) string {
	rest, ok := strings.CutPrefix(strings.TrimSpace(text), "/")
	if !ok {
		return ""
	}
	name, args, _ := strings.Cut(rest, " ")
	c.mu.RLock()
	defer c.mu.RUnlock()
	takesInput, advertised := c.names[name]
	if !advertised || (args != "" && !takesInput) {
		return ""
	}
	return name
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
				Name  string    `json:"name"`
				Input *struct{} `json:"input"`
			} `json:"availableCommands"`
		} `json:"update"`
	}
	if json.Unmarshal(params, &wrap) != nil || wrap.Update.Kind != "available_commands_update" {
		return false
	}
	names := make(map[string]bool, len(wrap.Update.Commands))
	for _, c := range wrap.Update.Commands {
		names[strings.TrimPrefix(c.Name, "/")] = c.Input != nil
	}
	s.commands.set(names)
	if r, ok := s.callbacks.(commandReporter); ok {
		r.reportCommands(names)
	}
	return true
}

// NativeCommand answers from what the last handshake advertised. Right after start-up nothing
// has been seen yet, so the first question starts a throwaway session to ask, once (the same
// way AvailableModels does). ACP does not say what a command does, so none is reported as
// read-only here; a wrapper that knows its server's commands says which are (agent/devin).
func (a *Agent) NativeCommand(ctx context.Context, text string) (name string, readOnly bool) {
	if !strings.HasPrefix(strings.TrimSpace(text), "/") {
		return "", false
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
	return a.commands.name(text), false
}
