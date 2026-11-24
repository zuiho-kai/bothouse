package core

import "errors"

// ErrPlatformNotReady marks a platform call refused because the connection is
// not up yet (startup, reconnect). Background sweeps stop on it instead of
// failing — and logging — once per item until the platform comes back.
var ErrPlatformNotReady = errors.New("platform not ready")
