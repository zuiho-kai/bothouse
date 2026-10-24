package main

import (
	ccconnect "github.com/chenhg5/cc-connect"
	"github.com/chenhg5/cc-connect/config"
	"github.com/chenhg5/cc-connect/core"
)

// The gate scripts bothouse releases into <data_dir>/gate and runs (core/gate_proc.go).
func init() { core.GateScriptFS = ccconnect.GateFiles }

// startGate starts the supervisor of the local gate; it runs the gate while some project's
// gate_url points at it, and a wizard run in this process reloads it.
func startGate(cfg *config.Config) *core.GateSupervisor {
	want := false
	for _, p := range cfg.Projects {
		if core.UsesLocalGate(p.GateURL) {
			want = true
		}
	}
	gs := core.NewGateSupervisor(cfg.DataDir)
	core.SetActiveGateSupervisor(gs)
	gs.Run(want)
	return gs
}
