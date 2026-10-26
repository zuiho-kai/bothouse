package core

import (
	"log/slog"
	"os"
	"strings"
)

// ParseCmdOpts extracts the command and extra args from agent options.
//
// Priority (first non-empty wins):
//  1. "cmd" (canonical field, no warning). Accepts both:
//     - a string (whitespace-separated, e.g. "my-cli code -t foo")
//     - a TOML array of strings (e.g. ["my-cli", "code", "-t", "foo"])
//  2. "cli_path" (deprecated — logs a warning). String only.
//  3. "command" (deprecated — logs a warning). String only.
//  4. defaultBin (fallback when nothing is configured)
//
// Examples:
//
//	"my-cli code -t foo"             → cmd="my-cli", extraArgs=["code", "-t", "foo"]
//	["my-cli", "code", "-t", "foo"] → cmd="my-cli", extraArgs=["code", "-t", "foo"]
//	"claude"                          → cmd="claude", extraArgs=nil
//	"" (default "pi")                 → cmd="pi", extraArgs=nil
func ParseCmdOpts(opts map[string]any, defaultBin string) (cmd string, extraArgs []string) {
	if v, ok := opts["cmd"]; ok {
		if s, ok := v.(string); ok {
			if parts := splitCmdString(s); parts != nil {
				return parts[0], parts[1:]
			}
		} else if arr, ok := toStringArray(v); ok {
			if parts := filterNonEmpty(arr); len(parts) > 0 {
				return parts[0], parts[1:]
			}
		}
		// Non-string non-array types fall through to deprecated keys / default.
	}

	if v, ok := opts["cli_path"].(string); ok && strings.TrimSpace(v) != "" {
		slog.Warn("DEPRECATED: 'cli_path' is deprecated, use 'cmd' instead",
			"deprecated_key", "cli_path",
			"new_key", "cmd",
			"value", v)
		if parts := splitCmdString(v); parts != nil {
			return parts[0], parts[1:]
		}
	}

	if v, ok := opts["command"].(string); ok && strings.TrimSpace(v) != "" {
		slog.Warn("DEPRECATED: 'command' is deprecated, use 'cmd' instead",
			"deprecated_key", "command",
			"new_key", "cmd",
			"value", v)
		if parts := splitCmdString(v); parts != nil {
			return parts[0], parts[1:]
		}
	}

	return defaultBin, nil
}

// splitCmdString splits a cmd string into ordered parts.
// Returns nil when the string is empty or whitespace-only so the caller can
// fall through to the next priority.
//
// Paths containing spaces are supported in two ways (issue #441 — the setup
// wizard writes a CLI path as a plain string, and Windows paths often contain
// spaces such as `C:\Program Files\...`):
//
//  1. an unquoted string that points at an existing file is kept as a single
//     command (whole string is the executable path);
//  2. otherwise double or single quotes group one argument, e.g.
//     `"C:\Program Files\cli.exe" --flag`.
//
// Anything else keeps the historical whitespace-separated behaviour.
func splitCmdString(s string) []string {
	t := strings.TrimSpace(s)
	if t == "" {
		return nil
	}
	if !strings.ContainsAny(t, `"'`) && isExistingFile(t) {
		return []string{t}
	}
	if parts, ok := splitQuoted(t); ok {
		return parts
	}
	return strings.Fields(t)
}

// isExistingFile reports whether s names an existing regular file. Only
// path-like strings are checked so plain command names (e.g. "claude") keep
// going through the normal PATH lookup instead of a cwd-relative stat.
func isExistingFile(s string) bool {
	if !strings.ContainsAny(s, `/\`) {
		return false
	}
	info, err := os.Stat(s)
	return err == nil && !info.IsDir()
}

// splitQuoted splits s on whitespace while honoring double and single quotes.
// Backslashes are kept literally (Windows paths are common here), and an
// unbalanced quote returns ok=false so the caller can fall back to the old
// whitespace-separated behaviour instead of guessing.
func splitQuoted(s string) ([]string, bool) {
	var parts []string
	var cur strings.Builder
	var quote rune
	started := false
	for _, r := range s {
		switch {
		case quote != 0:
			if r == quote {
				quote = 0
			} else {
				cur.WriteRune(r)
			}
		case r == '"' || r == '\'':
			quote = r
			started = true
		case r == ' ' || r == '\t' || r == '\n' || r == '\r':
			if started || cur.Len() > 0 {
				parts = append(parts, cur.String())
				cur.Reset()
				started = false
			}
		default:
			cur.WriteRune(r)
			started = true
		}
	}
	if quote != 0 {
		return nil, false
	}
	if started || cur.Len() > 0 {
		parts = append(parts, cur.String())
	}
	if len(parts) == 0 {
		return nil, false
	}
	return parts, true
}

// toStringArray accepts the shape TOML produces for inline arrays
// (i.e. []any of strings) as well as the []string shape some callers may
// pass directly. Returns ok=false for any other type so the caller can
// fall through to its next priority without logging a false-positive.
func toStringArray(v any) ([]string, bool) {
	switch arr := v.(type) {
	case []string:
		return arr, true
	case []any:
		out := make([]string, 0, len(arr))
		for _, item := range arr {
			s, ok := item.(string)
			if !ok {
				// Mixed-type or non-string arrays are an invalid cmd
				// shape; let the caller fall through rather than panic
				// or silently drop the user's config.
				return nil, false
			}
			out = append(out, s)
		}
		return out, true
	default:
		return nil, false
	}
}

// filterNonEmpty strips empty / whitespace-only entries from a cmd array.
// TOML allows inline arrays with sparse entries (`["cli", "", "--flag"]`)
// and we want the empty slots treated as if the user had not set them
// rather than spawning the CLI with an empty argv entry.
func filterNonEmpty(parts []string) []string {
	out := parts[:0:0]
	for _, p := range parts {
		if strings.TrimSpace(p) == "" {
			continue
		}
		out = append(out, p)
	}
	return out
}

// ParseConfigEnv parses opts["env"] (set via [projects.agent.options.env]
// in config.toml) into a []string of KEY=VALUE pairs.
//
// Supports both map[string]string and map[string]any (from TOML parser).
// Returns nil when no env is configured.
//
// The returned slice should be stored separately from sessionEnv so that
// SetSessionEnv calls cannot overwrite static config env.
func ParseConfigEnv(opts map[string]any) []string {
	raw, ok := opts["env"]
	if !ok || raw == nil {
		return nil
	}

	switch m := raw.(type) {
	case map[string]string:
		env := make([]string, 0, len(m))
		for k, v := range m {
			env = append(env, k+"="+v)
		}
		return env
	case map[string]any:
		env := make([]string, 0, len(m))
		for k, v := range m {
			if s, ok := v.(string); ok {
				env = append(env, k+"="+s)
			}
		}
		return env
	default:
		return nil
	}
}
