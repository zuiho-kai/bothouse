package ccconnect

import "embed"

// GateFiles: the gate bothouse starts for a team of bots (core/gate_proc.go) and the modules it
// imports (ctxsvc → wiki_search, lead, board, forum_scores; board/memvote → filelock), and memvote.py,
// the vote command the pushed memory items point agents at.
//
//go:embed contrib/gate/gate.py contrib/gate/scorer_remote.py contrib/gate/ctxsvc.py contrib/gate/wiki_search.py contrib/gate/lead.py contrib/gate/board.py contrib/gate/datadir.py contrib/gate/filelock.py contrib/gate/forum_scores.py contrib/gate/memvote.py contrib/gate/score_night.py contrib/gate/team.example.json
var GateFiles embed.FS
