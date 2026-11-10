package main

import (
	"os"
	"unsafe"

	"golang.org/x/sys/windows"
)

func startDesktopTray() bool {
	if !desktopTrayEnabled(os.Args[1:]) {
		attachParentConsole()
		return false
	}
	hideOwnConsoleWindow()
	runDesktopTray()
	return true
}

// hideOwnConsoleWindow closes the console window the tray would otherwise show.
//
// The release binary is a console-subsystem program (#1495), so that `bothouse --version` and the
// other subcommands print into the terminal they were typed in; without a console subsystem the
// process has no stdout there and the output is lost. The same subsystem makes Windows open a
// console window when the exe is double-clicked, which the tray must not show.
//
// Only a console this process opened itself is hidden: GetConsoleProcessList returns every process
// attached to the console, so more than one means it belongs to the terminal the user started
// `bothouse` from — hiding that would take their own window away.
func hideOwnConsoleWindow() {
	kernel32 := windows.NewLazySystemDLL("kernel32.dll")
	var procs [2]uint32 // one is all that distinguishes the two cases
	n, _, _ := kernel32.NewProc("GetConsoleProcessList").Call(
		uintptr(unsafe.Pointer(&procs[0])), uintptr(len(procs)))
	if n != 1 {
		return
	}
	hwnd, _, _ := kernel32.NewProc("GetConsoleWindow").Call()
	if hwnd == 0 {
		return
	}
	_, _, _ = windows.NewLazySystemDLL("user32.dll").NewProc("ShowWindow").Call(hwnd, windows.SW_HIDE)
}

// A GUI-subsystem binary has no console at all, and Windows can hand a freshly started process
// std handles that point at nothing. Builds made that way (a local `-H=windowsgui` build, or one
// launched from a shell that left the handles unset) attach to the caller's console here, without
// allocating a new window, and reopen only the streams that do not already work, so redirected
// pipes and files keep working.
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
