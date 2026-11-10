//go:build !windows

package core

import "os"

func renameDSHYAML(oldpath, newpath string) error {
	return os.Rename(oldpath, newpath)
}
