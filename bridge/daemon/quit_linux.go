package daemon

// Linux has no desktop tray.
func StopCurrentService() error { return nil }
