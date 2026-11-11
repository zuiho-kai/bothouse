//go:build windows

package core

// bridgeAccountUID: run_as_user does not exist on Windows (root path in runas_windows.go), so there is
// no second account to tell apart; the peer check treats every caller as the bridge's own account
// (unixPeerUID reports ok=false there).
func bridgeAccountUID() uint32 { return 0 }
