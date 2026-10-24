//go:build darwin

package main

import _ "embed"

// macOS: monochrome template image; the menu bar recolours it for light/dark mode.
//
//go:embed tray-icon.png
var trayIcon []byte
