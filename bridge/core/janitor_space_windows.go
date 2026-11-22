//go:build windows

package core

import "golang.org/x/sys/windows"

// diskFreeSpace: free bytes for this user and total bytes of the disk holding path.
func diskFreeSpace(path string) (free, total uint64, err error) {
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return 0, 0, err
	}
	var all uint64
	err = windows.GetDiskFreeSpaceEx(p, &free, &total, &all)
	return free, total, err
}
