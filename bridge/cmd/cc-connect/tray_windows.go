package main

import (
	"os"

	"golang.org/x/sys/windows"
)

func startDesktopTray() bool {
	if !trayInvocation(os.Args[1:]) {
		attachParentConsole()
		return false
	}
	runDesktopTray()
	return true
}

// A GUI-subsystem binary has no console on double-click. CLI invocations reuse
// the caller's console without allocating a new window. Preserve redirected
// pipes/files so commands also work in scripts.
func attachParentConsole() {
	attach := windows.NewLazySystemDLL("kernel32.dll").NewProc("AttachConsole")
	_, _, _ = attach.Call(uintptr(^uint32(0))) // ATTACH_PARENT_PROCESS
	for _, stream := range []struct {
		file **os.File
		id   uint32
		name string
		mode int
	}{
		{&os.Stdin, windows.STD_INPUT_HANDLE, "CONIN$", os.O_RDONLY},
		{&os.Stdout, windows.STD_OUTPUT_HANDLE, "CONOUT$", os.O_WRONLY},
		{&os.Stderr, windows.STD_ERROR_HANDLE, "CONOUT$", os.O_WRONLY},
	} {
		if *stream.file != nil {
			kind, err := windows.GetFileType(windows.Handle((*stream.file).Fd()))
			if err == nil && kind != windows.FILE_TYPE_UNKNOWN {
				continue
			}
		}
		f, err := os.OpenFile(stream.name, stream.mode, 0)
		if err == nil {
			*stream.file = f
			_ = windows.SetStdHandle(stream.id, windows.Handle(f.Fd()))
		}
	}
}
