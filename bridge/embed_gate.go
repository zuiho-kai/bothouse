package ccconnect

import "embed"

// GateFiles: the gate bothouse starts for a team of bots (core/gate_proc.go) and the modules it
// imports (ctxsvc → wiki_search, lead, board, forum_scores; board, memvote, score_night and reflector lock through
// filelock.py), standing_limits.json (ctxsvc's STANDING.md limits; the read-frequency report reads it too), the vote command pushed memory items point agents at, and forum_page/forum_threads.
//
//go:embed contrib/gate/gate.py contrib/gate/scorer_remote.py contrib/gate/ctxsvc.py contrib/gate/standing_limits.json contrib/gate/wiki_search.py contrib/gate/lead.py contrib/gate/board.py contrib/gate/datadir.py contrib/gate/filelock.py contrib/gate/forum_scores.py contrib/gate/forum_page.py contrib/gate/forum_threads.py contrib/gate/memvote.py contrib/gate/score_night.py contrib/gate/dshcat.js contrib/gate/reflector.py contrib/gate/team.example.json
var GateFiles embed.FS

// StandingLimitsJSON: STANDING.md's line and character limits; ctxsvc.py and core/read_frequency.go both read this file.
//
//go:embed contrib/gate/standing_limits.json
var StandingLimitsJSON []byte
