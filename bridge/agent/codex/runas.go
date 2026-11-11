package codex

// runas.go (#1367): every codex child process goes through core.BuildSpawnCommand so a project
// with run_as_user starts codex as that OS user (sudo -n -iu <user>), the same way Claude Code does.
// Then the kernel, not the prompt, keeps one member's turn out of another member's files.

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// spawnOptsFromOpts reads run_as_user / run_as_env (injected from the project config by
// cmd/cc-connect, or copied to workspace agents by the engine).
func spawnOptsFromOpts(opts map[string]any) core.SpawnOptions {
	so := core.SpawnOptions{}
	so.RunAsUser, _ = opts["run_as_user"].(string)
	so.RunAsUser = strings.TrimSpace(so.RunAsUser)
	switch env := opts["run_as_env"].(type) {
	case []any:
		for _, v := range env {
			if s, ok := v.(string); ok && s != "" {
				so.EnvAllowlist = append(so.EnvAllowlist, s)
			}
		}
	case []string:
		so.EnvAllowlist = append(so.EnvAllowlist, env...)
	}
	return so
}

// codexCommand builds the exec.Cmd for one codex child. Without run_as_user it is the old
// exec.CommandContext with the bridge env plus extraEnv. With run_as_user it re-checks sudo,
// wraps the command in sudo -iu, re-applies workDir inside the spawn (sudo -i starts in the
// target HOME), drops the bridge's own environment down to the allowlist and passes only the
// keys this session sets on purpose (extraEnv: provider keys, CODEX_HOME, session env).
func codexCommand(ctx context.Context, so core.SpawnOptions, bin, workDir string, extraEnv []string, args ...string) (*exec.Cmd, error) {
	if !so.IsolationMode() {
		cmd := exec.CommandContext(ctx, bin, args...)
		cmd.Dir = workDir
		if len(extraEnv) > 0 {
			cmd.Env = core.MergeEnv(os.Environ(), extraEnv)
		}
		return cmd, nil
	}
	verifyCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	err := core.VerifyRunAsUserCheap(verifyCtx, core.ExecSudoRunner{}, so.RunAsUser)
	cancel()
	if err != nil {
		return nil, fmt.Errorf("codex: run_as_user spawn refused: %w", err)
	}
	so.EnvAllowlist = append([]string(nil), so.EnvAllowlist...)
	for _, kv := range extraEnv {
		if i := strings.IndexByte(kv, '='); i > 0 {
			so.EnvAllowlist = append(so.EnvAllowlist, kv[:i])
		}
	}
	so.WorkDir = workDir
	cmd := core.BuildSpawnCommand(ctx, so, bin, args...)
	cmd.Dir = workDir
	env := core.FilterEnvForSpawn(os.Environ(), so)
	env = core.MergeEnv(env, extraEnv)
	if workDir != "" {
		env = core.MergeEnv(env, []string{core.RunAsChdirEnv + "=" + workDir})
	}
	cmd.Env = core.FilterEnvForSpawn(env, so)
	return cmd, nil
}
