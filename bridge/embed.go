package ccconnect

import (
	"embed"
	_ "embed"
)

//go:embed config.example.toml
var ConfigExampleTOML string

// AgentHookFiles: the Claude Code / DSH hooks (contrib/hooks) and the gate's wiki lookup wiki-context reuses,
// installed by "cc-connect setup hooks" and the setup wizard (core/agent_hooks.go).
//
//go:embed contrib/hooks/*.py contrib/hooks/rules/*.md contrib/gate/ctxsvc.py contrib/gate/wiki_search.py
var AgentHookFiles embed.FS

// RoleWikiFiles: the per-role wiki engine (contrib/wiki), installed into <data_dir>/rolewiki by the setup wizard and
// refreshed by cc-connect at start (core/rolewiki.go).
//
//go:embed contrib/wiki/rolewiki.py contrib/wiki/wikilint.py contrib/wiki/template/*/CLAUDE.md
var RoleWikiFiles embed.FS
