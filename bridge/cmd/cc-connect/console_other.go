//go:build !windows

package main

// ensureHiddenConsole: only Windows opens a console window for a child of a console-less process.
func ensureHiddenConsole() {}
