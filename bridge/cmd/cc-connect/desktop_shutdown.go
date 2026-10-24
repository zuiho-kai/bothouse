package main

import "sync"

// Closing this channel requests normal cleanup on every OS, including Windows,
// where sending SIGTERM to our own process is unsupported.
var desktopShutdown = make(chan struct{})
var desktopShutdownOnce sync.Once

func requestDesktopShutdown() {
	desktopShutdownOnce.Do(func() { close(desktopShutdown) })
}
