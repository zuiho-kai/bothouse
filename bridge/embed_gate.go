package ccconnect

import "embed"

// GateFiles: the gate bothouse starts for a team of bots (core/gate_proc.go) and the modules it
// imports (ctxsvc → wiki_search, lead, board, forum_scores; board, memvote and lead/ws-handoff lock through filelock.py: fcntl on Mac/Linux, msvcrt on Windows), and memvote.py,
// the vote command the pushed memory items point agents at; forum_page.py (GET /forum) and forum_threads.py (thread/floor tags at the end of wiki lines: new memories join a same-question thread).
//
//go:embed contrib/gate/gate.py contrib/gate/scorer_remote.py contrib/gate/ctxsvc.py contrib/gate/wiki_search.py contrib/gate/lead.py contrib/gate/board.py contrib/gate/datadir.py contrib/gate/filelock.py contrib/gate/forum_scores.py contrib/gate/forum_page.py contrib/gate/forum_threads.py contrib/gate/memvote.py contrib/gate/score_night.py contrib/gate/team.example.json
var GateFiles embed.FS
