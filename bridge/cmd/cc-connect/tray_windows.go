package main

import "os"

func startDesktopTray() bool {
	if !trayInvocation(os.Args[1:]) {
		return false
	}
	runDesktopTray()
	return true
}
