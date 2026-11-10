//go:build darwin || linux

package core

// memberSocketSupported: this platform can tell which local account opened a socket connection
// (peer_uid_*.go), which is what member.sock requires before it runs anything.
const memberSocketSupported = true
