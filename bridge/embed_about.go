package ccconnect

import "embed"

// AboutFiles is the product description the roles read when asked what bothouse is
// (`bothouse about`). Keep it in step with README's comparison section on each release.
//
//go:embed about/*.md
var AboutFiles embed.FS
