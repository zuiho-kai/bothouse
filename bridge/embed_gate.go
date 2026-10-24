package ccconnect

import "embed"

// GateFiles: the gate bothouse starts for a team of bots (core/gate_proc.go) and the modules it
// imports (ctxsvc → wiki_search, lead, board; board is optional where fcntl is missing).
//
//go:embed contrib/gate/gate.py contrib/gate/scorer_remote.py contrib/gate/ctxsvc.py contrib/gate/wiki_search.py contrib/gate/lead.py contrib/gate/board.py contrib/gate/team.example.json
var GateFiles embed.FS
