// Package teamrules holds the two team rule files the bridge cannot run without. They are in git
// here, not in the generated dsh_bundle, so a plain `go build` always has them. The DSH build
// copies the same two files (dsh/scripts/bundle.mjs), so both sides read one text.
package teamrules

import _ "embed"

// ModeRules is team-mode-rules.md: a common part, then one "## <mode>" section per dispatch mode.
//
//go:embed team-mode-rules.md
var ModeRules string

// ExitRules is team-exit-rules.json: the workspace exit ([ask]/[report]) rules.
//
//go:embed team-exit-rules.json
var ExitRules []byte
