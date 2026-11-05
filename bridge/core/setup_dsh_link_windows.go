//go:build windows

package core

import (
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"
	"unicode/utf16"
	"unsafe"

	"golang.org/x/sys/windows"
)

// linkDir makes link a directory junction to target, the link pnpm itself makes on Windows
// (junctions need no admin rights or Developer Mode, unlike symlinks).
func linkDir(target, link string) error {
	target, err := filepath.Abs(target)
	if err != nil {
		return err
	}
	if err := os.Mkdir(link, 0o755); err != nil {
		return err
	}
	if err := setMountPoint(link, target); err != nil {
		_ = os.Remove(link)
		return err
	}
	return nil
}

// setMountPoint turns the empty directory link into a junction to target with
// FSCTL_SET_REPARSE_POINT (REPARSE_DATA_BUFFER, MountPointReparseBuffer layout, Win32 docs).
func setMountPoint(link, target string) error {
	sub := utf16.Encode([]rune(`\??\` + target))
	print := utf16.Encode([]rune(target))
	pathBytes := (len(sub) + 1 + len(print) + 1) * 2
	buf := make([]byte, 8+8+pathBytes)
	le := binary.LittleEndian
	le.PutUint32(buf[0:], windows.IO_REPARSE_TAG_MOUNT_POINT)
	le.PutUint16(buf[4:], uint16(8+pathBytes))     // ReparseDataLength
	le.PutUint16(buf[8:], 0)                       // SubstituteNameOffset
	le.PutUint16(buf[10:], uint16(len(sub)*2))     // SubstituteNameLength
	le.PutUint16(buf[12:], uint16((len(sub)+1)*2)) // PrintNameOffset
	le.PutUint16(buf[14:], uint16(len(print)*2))   // PrintNameLength
	off := 16
	for _, c := range sub {
		le.PutUint16(buf[off:], c)
		off += 2
	}
	off += 2
	for _, c := range print {
		le.PutUint16(buf[off:], c)
		off += 2
	}
	name, err := windows.UTF16PtrFromString(link)
	if err != nil {
		return err
	}
	h, err := windows.CreateFile(name, windows.GENERIC_WRITE, 0, nil, windows.OPEN_EXISTING,
		windows.FILE_FLAG_OPEN_REPARSE_POINT|windows.FILE_FLAG_BACKUP_SEMANTICS, 0)
	if err != nil {
		return fmt.Errorf("open %s: %w", link, err)
	}
	defer windows.CloseHandle(h)
	var ret uint32
	if err := windows.DeviceIoControl(h, windows.FSCTL_SET_REPARSE_POINT, (*byte)(unsafe.Pointer(&buf[0])), uint32(len(buf)), nil, 0, &ret, nil); err != nil {
		return fmt.Errorf("make junction %s → %s: %w", link, target, err)
	}
	return nil
}
