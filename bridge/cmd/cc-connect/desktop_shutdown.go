package main

import (
	"log/slog"
	"sync"

	"github.com/chenhg5/cc-connect/daemon"
)

// Closing this channel requests normal cleanup on every OS, including Windows,
// where sending SIGTERM to our own process is unsupported.
var desktopShutdown = make(chan struct{})
var desktopShutdownOnce sync.Once

func requestDesktopShutdown() {
	desktopShutdownOnce.Do(func() { close(desktopShutdown) })
}

func stopDesktopService() {
	if err := daemon.StopCurrentService(); err != nil {
		slog.Error("tray exit: could not stop supervising service", "error", err)
	}
}
