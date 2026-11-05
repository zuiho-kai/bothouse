//go:build !darwin

package core

// swapDirs reports that this platform cannot exchange two paths in one rename; installUnitFrom
// then moves the old unit aside and renames the new one in.
func swapDirs(string, string) error {
	return errNoAtomicSwap
}
