//go:build !windows

package core

// savedPathDirs: only Windows keeps a saved PATH apart from the process's own (setup_detect_path_windows.go).
func savedPathDirs() []string { return nil }
