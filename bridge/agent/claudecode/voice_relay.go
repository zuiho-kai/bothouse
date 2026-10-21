package claudecode

import (
	"context"
	"fmt"

	"github.com/chenhg5/cc-connect/core"
)

func (a *Agent) StartVoiceRelay(ctx context.Context, id string, env []string) (core.AgentSession, error) {
	if id == core.ContinueSession || (id != "" && !a.ValidateSessionID(ctx, id)) {
		return nil, fmt.Errorf("claude voice requires an existing concrete resume identity")
	}
	s, err := a.startSessionWithEnv(ctx, id, env)
	if err != nil {
		return nil, err
	}
	s.(*claudeSession).voiceOnly.Store(true)
	return s, nil
}

var _ core.VoiceRelayAgent = (*Agent)(nil)
