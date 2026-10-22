package ccconnect

import "embed"

// AgentToolFiles: the small tools for agents (contrib/tools: peek, watchvid, websearch) and their persona lines,
// installed by "cc-connect setup tools" and the setup wizard (core/agent_tools.go). contrib/hooks/dshlog.py (the
// DSH session log reader the hooks share) is installed next to them for peek.
//
//go:embed contrib/tools/*.py contrib/tools/rules/*.md contrib/hooks/dshlog.py
var AgentToolFiles embed.FS
