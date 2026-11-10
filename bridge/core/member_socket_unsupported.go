//go:build !darwin && !linux

package core

// memberSocketSupported is false here: without peer credentials a world-connectable member.sock could
// not tell the bridge's account from any other, so it is not started and `bothouse member` keeps using
// api.sock — which only the bridge's account can open anyway (run_as_user does not exist on Windows).
const memberSocketSupported = false
