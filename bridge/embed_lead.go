package ccconnect

import "embed"

// LeadToolFiles preserves the sibling lead/gate layout used by the collaboration scripts.
// The two lead patterns together are every file of contrib/lead; they leave out a
// __pycache__ directory, which Python writes there when a script or a test imports a
// sibling module, and which used to fail every later build ("contains no embeddable files").
//
//go:embed contrib/lead/[^_]* contrib/lead/_*.py contrib/gate/board.py contrib/gate/deliver.py contrib/gate/lead.py contrib/gate/datadir.py contrib/gate/filelock.py contrib/gate/team.example.json
var LeadToolFiles embed.FS
