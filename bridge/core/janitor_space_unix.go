//go:build !windows

package core

import "golang.org/x/sys/unix"

// diskFreeSpace: free bytes for this user and total bytes of the disk holding path.
func diskFreeSpace(path string) (free, total uint64, err error) {
	var st unix.Statfs_t
	if err = unix.Statfs(path, &st); err != nil {
		return 0, 0, err
	}
	bs := uint64(st.Bsize)
	return uint64(st.Bavail) * bs, uint64(st.Blocks) * bs, nil
}
