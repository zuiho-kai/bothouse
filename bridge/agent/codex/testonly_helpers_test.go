package codex

import (
	"context"

	"github.com/chenhg5/cc-connect/core"
)

// Helpers only tests call. They were product code nothing reached
// (deadcode on darwin, linux and windows), so they live with the tests.

func newAppServerSession(ctx context.Context, bin, url, workDir, model, effort, mode, resumeID, baseURL, modelProvider string, extraEnv []string, codexHome string, permissionProfile string, systemPrompt string, appendPrompt string, baseInstructions string) (*appServerSession, error) {
	return newAppServerSessionAs(ctx, core.SpawnOptions{}, bin, url, workDir, model, effort, mode, resumeID, baseURL, modelProvider, extraEnv, codexHome, permissionProfile, systemPrompt, appendPrompt, baseInstructions)
}
