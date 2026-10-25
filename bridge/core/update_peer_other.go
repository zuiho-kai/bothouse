//go:build !darwin && !linux

package core

import "net"

// unixPeerExe: no peer credentials here (Windows AF_UNIX); the request must name its exe.
func unixPeerExe(*net.UnixConn) (string, bool) { return "", false }
