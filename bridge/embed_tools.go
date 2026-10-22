package ccconnect

import "embed"

// AgentToolFiles: the small tools for agents (contrib/tools: peek, watchvid, websearch) and their persona lines,
// installed by "cc-connect setup tools" and the setup wizard (core/agent_tools.go).
//
//go:embed contrib/tools/*.py contrib/tools/rules/*.md
var AgentToolFiles embed.FS
