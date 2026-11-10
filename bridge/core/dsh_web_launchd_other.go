//go:build !darwin

package core

// dshWebLaunchdLogPaths: no launchd outside macOS. Windows and Linux supervise the host through
// whatever the user started it with, so the recorded and default logs stay the only candidates.
func dshWebLaunchdLogPaths() []string { return nil }
