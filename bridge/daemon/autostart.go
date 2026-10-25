package daemon

import (
	"errors"
	"fmt"
)

// Who supervises the current process.
const (
	// SupervisorSelf: the service `bothouse daemon install` created
	// (launchd label com.bothouse.service, systemd bothouse.service, or the
	// bothouse scheduled task). Only then can the panel switch autostart.
	SupervisorSelf = "self"
	// SupervisorExternal: another service manager entry runs this process
	// (e.g. a hand-written launchd plist with a different label). Its
	// autostart belongs to that entry; never install a second service.
	SupervisorExternal = "external"
	// SupervisorNone: started by hand (terminal, app launch), not a service.
	SupervisorNone = "none"
)

// AutostartState is what the panel shows for "start at login".
type AutostartState struct {
	Supervisor string `json:"supervisor"`         // self | external | none
	Enabled    bool   `json:"enabled"`            // meaningful when Supervisor == self
	Platform   string `json:"platform,omitempty"` // launchd, systemd (user), schtasks
	Label      string `json:"label,omitempty"`    // the supervising job, when known
}

// ErrAutostartNotSelf is returned when the panel tries to switch autostart for
// a process that the bothouse service does not run.
var ErrAutostartNotSelf = errors.New("autostart is managed outside bothouse for this process")

// CurrentAutostart reports the autostart state for the running process.
func CurrentAutostart() (AutostartState, error) {
	sup, label := supervisedBySelf()
	st := AutostartState{Supervisor: sup, Label: label}
	if sup != SupervisorSelf {
		return st, nil
	}
	mgr, err := NewManager()
	if err != nil {
		return st, err
	}
	st.Platform = mgr.Platform()
	on, err := mgr.Autostart()
	if err != nil {
		return st, err
	}
	st.Enabled = on
	return st, nil
}

// SetCurrentAutostart switches autostart for the service that runs this
// process. It refuses when that is not the bothouse service, so the panel of
// an externally managed bridge can never install a second service.
func SetCurrentAutostart(enabled bool) (AutostartState, error) {
	sup, label := supervisedBySelf()
	if sup != SupervisorSelf {
		return AutostartState{Supervisor: sup, Label: label}, ErrAutostartNotSelf
	}
	mgr, err := NewManager()
	if err != nil {
		return AutostartState{Supervisor: sup, Label: label}, err
	}
	if err := mgr.SetAutostart(enabled); err != nil {
		return AutostartState{Supervisor: sup, Label: label, Platform: mgr.Platform()}, fmt.Errorf("set autostart: %w", err)
	}
	return CurrentAutostart()
}
