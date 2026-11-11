//go:build !darwin && !linux

package core

// memberSocketSupported is false here: without peer credentials a world-connectable member.sock could
// not tell the bridge's account from any other, so it is not started and `bothouse member` keeps using
// api.sock — which only the bridge's account can open anyway (run_as_user does not exist on Windows).
// The caller check follows that: with no member.sock, a /member request on api.sock is the bridge's own
// account and is let through as before (#638).
//
// A variable instead of a constant only so a test can drive the other platforms' branch; nothing writes
// it outside tests, and it is fixed per build tag.
var memberSocketSupported = false
