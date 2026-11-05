//go:build !linux && !darwin

package core

import "net"

// No peer credentials on this platform (Windows AF_UNIX): the caller cannot be
// identified, so a signing request is refused rather than trusted.
func peerProcessID(*net.UnixConn) (int, bool) { return 0, false }

func processEnvironment(int) ([]byte, bool) { return nil, false }

func parentProcessID(int) int { return 0 }
