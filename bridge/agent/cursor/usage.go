package cursor

import (
	"context"
	"os"

	"github.com/chenhg5/cc-connect/core"
	"github.com/chenhg5/cc-connect/internal/accountquota"
)

func (a *Agent) GetUsage(ctx context.Context) (*core.UsageReport, error) {
	return a.GetUsageForModel(ctx, a.GetModel())
}

func (a *Agent) GetUsageForModel(ctx context.Context, model string) (*core.UsageReport, error) {
	a.mu.RLock()
	env := core.MergeEnv(os.Environ(), a.configEnv)
	env = core.MergeEnv(env, a.providerEnvLocked())
	env = core.MergeEnv(env, a.sessionEnv)
	a.mu.RUnlock()
	return accountquota.Cursor(ctx, env, model)
}
