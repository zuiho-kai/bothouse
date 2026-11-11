//go:build !windows

package core

import "os"

// bridgeAccountUID is the uid this process (the bridge) runs as: the owner of api.sock (0600).
func bridgeAccountUID() uint32 { return uint32(os.Getuid()) }
