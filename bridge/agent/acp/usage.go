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
	return accountquota.Cursor(ctx, a.UsageEnvironment(), model)
}

// UsageEnvironment returns the credential environment used by the ACP process,
// including project and session overrides. Provider wrappers use the same
// snapshot so quota queries cannot silently read a different signed-in account.
func (a *Agent) UsageEnvironment() []string {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return core.MergeEnv(core.MergeEnv(os.Environ(), a.extraEnv), a.sessionEnv)
}
