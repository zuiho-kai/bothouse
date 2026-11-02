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
	v := strings.TrimSpace(os.Getenv(ClaudeEntrypointEnv))
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
