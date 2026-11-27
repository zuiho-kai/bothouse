package ccconnect

import "embed"

// LeadToolFiles preserves the sibling lead/gate layout used by the collaboration scripts.
// The lead patterns together are every file of contrib/lead except the tests: they leave out
// test_* and fixtures/ (#2047 item 7: 36 test files went into every install) and a __pycache__
// directory, which Python writes there when a script or a test imports a sibling module, and which
// used to fail every later build ("contains no embeddable files"). A tool whose name starts with
// t or f must be listed here by name, like t10 (TestLeadEmbedSkipsOnlyTests fails until it is).
//
//go:embed contrib/lead/[^_tf]* contrib/lead/t10 contrib/lead/_*.py contrib/gate/board.py contrib/gate/deliver.py contrib/gate/lead.py contrib/gate/datadir.py contrib/gate/filelock.py contrib/gate/team.example.json
var LeadToolFiles embed.FS
