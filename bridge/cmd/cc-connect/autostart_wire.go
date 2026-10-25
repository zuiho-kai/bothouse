package main

import (
	"github.com/chenhg5/cc-connect/core"
	"github.com/chenhg5/cc-connect/daemon"
)

// wireAutostart backs the settings page's "start at login" switch, both in
// normal mode and while the setup wizard runs (a new install lands there).
func wireAutostart(srv *core.ManagementServer) {
	srv.SetAutostartFuncs(
		func() (core.AutostartInfo, error) {
			st, err := daemon.CurrentAutostart()
			return core.AutostartInfo(st), err
		},
		func(on bool) (core.AutostartInfo, error) {
			st, err := daemon.SetCurrentAutostart(on)
			return core.AutostartInfo(st), err
		},
	)
}
