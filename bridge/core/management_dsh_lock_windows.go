//go:build windows

package core

import "context"

// collabLockHolder: Windows has no lsof, and the lock is a SQLite database held open by the other
// DSH. Naming the holder would need a handle-table API; the message still says the lock is in use.
func collabLockHolder(ctx context.Context, path string) string { return "" }
