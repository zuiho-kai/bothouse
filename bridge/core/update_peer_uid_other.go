//go:build !darwin && !linux

package core

import "net"

// unixPeerUID: no peer credentials here (Windows AF_UNIX); the caller counts as the bridge's account
// and the member socket stays closed to other accounts on this platform.
func unixPeerUID(*net.UnixConn) (uint32, bool) { return 0, false }
