package ccconnect

import "embed"

// LeadToolFiles preserves the sibling lead/gate layout used by the collaboration scripts.
//
//go:embed contrib/lead/[^_]* contrib/lead/_*.py contrib/gate/board.py contrib/gate/lead.py contrib/gate/datadir.py contrib/gate/team.example.json
var LeadToolFiles embed.FS
