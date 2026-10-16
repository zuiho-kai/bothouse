package acp

import (
	"context"
	"os"

	"github.com/chenhg5/cc-connect/core"
	"github.com/chenhg5/cc-connect/internal/accountquota"
)

// The generic ACP protocol does not define an account-quota RPC. Only enable
// Cursor's provider API for its explicitly configured login method.
func (a *Agent) SupportsUsageReporting() bool {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.authMethod == "cursor_login"
}

func (a *Agent) GetUsage(ctx context.Context) (*core.UsageReport, error) {
	return a.GetUsageForModel(ctx, a.GetModel())
}

func (a *Agent) GetUsageForModel(ctx context.Context, model string) (*core.UsageReport, error) {
	if !a.SupportsUsageReporting() {
		return nil, accountquota.ErrUnsupportedAuth
	}
	a.mu.RLock()
	env := core.MergeEnv(os.Environ(), a.extraEnv)
	env = core.MergeEnv(env, a.sessionEnv)
	a.mu.RUnlock()
	return accountquota.Cursor(ctx, env, model)
}
