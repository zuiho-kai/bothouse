package core

import (
	"os"
	"strings"
)

// DefaultClaudeEntrypoint is the CLAUDE_CODE_ENTRYPOINT the bridge gives the
// Claude Code CLI it spawns. The CLI otherwise reports headless runs as
// "sdk-cli", which anthropics/claude-code#97074 shows draws the 5-hour
// subscription window ~1.8-2.5x faster per token than other entrypoints for
// the same work. The bridge names itself instead of impersonating "cli".
const DefaultClaudeEntrypoint = "bothouse"

// ClaudeEntrypointEnv overrides the entrypoint name. Set it to "sdk-cli" to go
// back to the CLI default. Names of Anthropic's own clients ("cli",
// "claude-vscode", "claude-desktop") are refused: the bridge does not pose as
// them.
const ClaudeEntrypointEnv = "BOTHOUSE_CLAUDE_ENTRYPOINT"

// ClaudeEntrypoint returns the entrypoint name for spawned Claude Code CLIs.
func ClaudeEntrypoint() string {
	return claudeEntrypoint(false)
}

// ClaudeEntrypointForEnv returns the entrypoint for a CLI spawned with env.
// The bothouse name only exists to keep subscription logins off the sdk-cli
// 5-hour-window path; an API key has no such window, and Anthropic answers
// API-key requests carrying an unknown entrypoint with billing_error
// ("Credit balance is too low", #2334). So with a non-empty
// ANTHROPIC_API_KEY the CLI keeps its own sdk-cli unless the user set
// BOTHOUSE_CLAUDE_ENTRYPOINT.
func ClaudeEntrypointForEnv(env []string) string {
	apiKey := false
	for _, e := range env {
		if v, ok := strings.CutPrefix(e, "ANTHROPIC_API_KEY="); ok {
			apiKey = strings.TrimSpace(v) != ""
		}
	}
	return claudeEntrypoint(apiKey)
}

func claudeEntrypoint(apiKey bool) string {
	v := strings.TrimSpace(os.Getenv(ClaudeEntrypointEnv))
	if v == "" && apiKey {
		return "sdk-cli"
	}
	switch v {
	case "", "cli", "claude-vscode", "claude-desktop":
		return DefaultClaudeEntrypoint
	}
	return v
}

// IsBridgeEntrypoint reports whether a session-log entrypoint belongs to a
// session the bridge itself spawned (so the observer must not mirror it).
func IsBridgeEntrypoint(ep string) bool {
	return ep == "sdk-cli" || ep == DefaultClaudeEntrypoint || (ep != "" && ep == ClaudeEntrypoint())
}
