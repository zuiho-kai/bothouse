//go:build windows

package core

import (
	"syscall"
	"unsafe"
)

// osLocaleName returns the user's default locale name, e.g. "zh-CN" (GetUserDefaultLocaleName).
func osLocaleName() string {
	proc := syscall.NewLazyDLL("kernel32.dll").NewProc("GetUserDefaultLocaleName")
	if proc.Find() != nil {
		return ""
	}
	buf := make([]uint16, 85) // LOCALE_NAME_MAX_LENGTH (winnls.h)
	n, _, _ := proc.Call(uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	if n == 0 {
		return ""
	}
	return syscall.UTF16ToString(buf)
}
