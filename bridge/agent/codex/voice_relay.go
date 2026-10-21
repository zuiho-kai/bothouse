package codex

import (
	"context"
	"fmt"

	"github.com/chenhg5/cc-connect/core"
)

// Voice owns a distinct native thread. It never mutates a channel's session
// environment or falls back from a missing persisted thread to thread/start.
func (a *Agent) StartVoiceRelay(ctx context.Context, id string, env []string) (core.AgentSession, error) {
	a.mu.RLock()
	backend := a.backend
	home := a.codexHome
	if home == "" {
		runtimeEnv := core.MergeEnv(a.configEnv, a.providerEnvLocked())
		runtimeEnv = core.MergeEnv(runtimeEnv, a.sessionEnv)
		runtimeEnv = core.MergeEnv(runtimeEnv, env)
		home = getenvFromList(runtimeEnv, "CODEX_HOME")
	}
	a.mu.RUnlock()
	if backend != "app_server" || id == core.ContinueSession {
		return nil, fmt.Errorf("codex voice requires app_server and a concrete identity")
	}
	if id != "" {
		if err := validateInputResume(id, home); err != nil {
			return nil, err
		}
	}
	s, err := a.startSessionWith(ctx, id, false, nil, env)
	if err != nil {
		return nil, err
	}
	as := s.(*appServerSession)
	if as.CurrentSessionID() == "" || (id != "" && as.CurrentSessionID() != id) {
		_ = as.Close()
		return nil, fmt.Errorf("codex voice thread identity mismatch")
	}
	as.voiceFresh.Store(id == "")
	return as, nil
}

var _ core.VoiceRelayAgent = (*Agent)(nil)
