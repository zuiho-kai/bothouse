//go:build windows

package main

import _ "embed"

// Windows: getlantern/systray loads the tray icon via LoadImage(IMAGE_ICON),
// so it must be ICO. Uses the white-background app icon so it stays visible
// on both dark and light taskbars.
//
//go:embed tray-icon.ico
var trayIcon []byte
