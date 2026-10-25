package main

import "os"

func startDesktopTray() bool {
	if !desktopTrayEnabled(os.Args[1:]) {
		return false
	}
	runDesktopTray()
	return true
}
