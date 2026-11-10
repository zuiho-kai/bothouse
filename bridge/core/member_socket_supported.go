//go:build darwin || linux

package core

// memberSocketSupported: this platform can tell which local account opened a socket connection
// (peer_uid_*.go), which is what member.sock requires before it runs anything.
//
// A variable instead of a constant only so a test can drive the branch for platforms that cannot tell
// (member_socket_test.go); nothing writes it outside tests, and it is fixed per build tag.
var memberSocketSupported = true
