package ccconnect

import (
	"embed"
	_ "embed"
)

//go:embed config.example.toml
var ConfigExampleTOML string

// AgentHookFiles: the Claude Code / DSH hooks (contrib/hooks), the Claude Code subagent type bash-guard pairs with
// (contrib/hooks/agents), the code map directory's README (contrib/hooks/codemaps) and the gate's wiki lookup
// wiki-context reuses, installed by "cc-connect setup hooks" and the setup wizard (core/agent_hooks.go).
//
//go:embed contrib/hooks/*.py contrib/hooks/rules/*.md contrib/hooks/agents/*.md contrib/hooks/codemaps/*.md contrib/gate/ctxsvc.py contrib/gate/wiki_search.py
var AgentHookFiles embed.FS
