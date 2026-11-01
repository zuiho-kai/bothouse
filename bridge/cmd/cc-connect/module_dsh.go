package main

import (
	"context"
	"os"

	"github.com/chenhg5/cc-connect/core"
)

// runDSHModule keeps DSH's profile separate from config.toml while exposing the
// same noninteractive JSON contract as the other module add commands (#812).
func runDSHModule(cmd string, f moduleFlags) {
	result := core.ApplyDSHModule(context.Background(), cmd == "disable", f.dryRun, f.lang)
	printJSON(result)
	if !result.OK {
		os.Exit(1)
	}
}
