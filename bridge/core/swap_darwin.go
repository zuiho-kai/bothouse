//go:build darwin

package core

import "golang.org/x/sys/unix"

// swapDirs exchanges the two paths in one atomic renamex_np(RENAME_SWAP) call, so neither path
// is ever missing and a running program keeps serving from the inodes it opened (measured on
// macOS 15: marker files in the swapped directories changed places, the running binary did not).
func swapDirs(a, b string) error {
	return unix.RenamexNp(a, b, unix.RENAME_SWAP)
}
