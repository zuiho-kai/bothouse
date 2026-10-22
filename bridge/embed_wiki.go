package ccconnect

import "embed"

// RoleWikiFiles: the per-role memory wiki programs (contrib/wiki, its template, and contrib/hooks/dshlog.py that
// export.py reads DSH logs with), installed by the setup wizard (core/rolewiki.go).
//
//go:embed contrib/wiki/*.py contrib/wiki/sub-wiki.sh contrib/wiki/bots.example.json contrib/wiki/llmwiki/*.py contrib/wiki/llmwiki/teammate/*.py contrib/wiki/template contrib/hooks/dshlog.py
var RoleWikiFiles embed.FS
