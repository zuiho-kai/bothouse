//go:build windows

package core

import (
	"context"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// dshWebProcLookupTimeout bounds one PowerShell call. It is the cap for a caller with no round of its
// own; a caller inside a round passes its ctx, and the call is cut at whichever comes first, so N
// candidates past the round's deadline no longer cost N×2s (#1255 阻塞三 残余).
// 来源：与本文件里 lsof 那类探活同一量级（setup_dsh_configure.go 记录的实测 0.1–0.3s），PowerShell
// 冷启动再慢也在这个数量级；2s 只留余量，不是新拍的数字。
var dshWebProcLookupTimeout = 2 * time.Second

// dshWebProcLookupNow reads pid's command line through CIM. Windows does not let one process read
// another's environment without a PEB walk, so envKnown is false and dsh_web_owner.go does not use
// the command line as proof on its own: it asks for a record this bridge wrote instead.
// 来源：Win32 docs — Win32_Process.CommandLine 是唯一不注入代码就能拿到的完整命令行。
func dshWebProcLookupNow(ctx context.Context, pid int) (argv []string, env map[string]string, envKnown, ok bool) {
	if pid <= 0 {
		return nil, nil, false, false
	}
	// Native first: one NtQueryInformationProcess, no powershell.exe. The PowerShell/CIM read below
	// failed on the windows-e2e runner for a live node.exe and answered 3s later (run 42952099038:
	// "the command line of pid 6964 cannot be read"), so the bridge refused to stop its own host.
	if line := dshWebCommandLineNative(pid); line != "" {
		return splitWindowsCommandLine(line), nil, false, true
	}
	if ctx.Err() != nil {
		return nil, nil, false, false
	}
	ctx, cancel := context.WithTimeout(ctx, dshWebProcLookupTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, "powershell", "-NoProfile", "-NonInteractive", "-Command",
		"(Get-CimInstance Win32_Process -Filter \"ProcessId="+strconv.Itoa(pid)+"\").CommandLine").Output()
	if err != nil {
		return nil, nil, false, false
	}
	line := strings.TrimSpace(string(out))
	if line == "" {
		return nil, nil, false, false
	}
	return splitWindowsCommandLine(line), nil, false, true
}

// splitWindowsCommandLine splits a CommandLine the way the CRT does: whitespace separates, double
// quotes group (and "" inside a quoted run is a literal quote), and the first token is the exe.
func splitWindowsCommandLine(line string) []string {
	var (
		args    []string
		cur     strings.Builder
		quoted  bool
		started bool
	)
	flush := func() {
		if started {
			args = append(args, cur.String())
			cur.Reset()
			started = false
		}
	}
	for i := 0; i < len(line); i++ {
		c := line[i]
		switch {
		case c == '\\' && i+1 < len(line) && line[i+1] == '"':
			cur.WriteByte('"')
			started = true
			i++
		case c == '"':
			quoted = !quoted
			started = true
		case (c == ' ' || c == '\t') && !quoted:
			flush()
		default:
			cur.WriteByte(c)
			started = true
		}
	}
	flush()
	return args
}

// dshWebParentPIDNow reads pid's parent from a toolhelp process snapshot, 0 when it cannot. No
// PowerShell here: the CIM form (one powershell.exe per ancestor, capped at 2s) returned nothing on
// the windows-e2e runner, so the recorded cmd.exe was never linked to its node.exe listener
// (run 42949763557: "no record of this bridge names it" for pid 8828 / listener 2072).
// 来源：Win32 docs — CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS) / PROCESSENTRY32.th32ParentProcessID.
func dshWebParentPIDNow(_ context.Context, pid int) int {
	if pid <= 0 {
		return 0
	}
	snap, err := syscall.CreateToolhelp32Snapshot(syscall.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return 0
	}
	defer syscall.CloseHandle(snap)
	var e syscall.ProcessEntry32
	e.Size = uint32(unsafe.Sizeof(e))
	for err = syscall.Process32First(snap, &e); err == nil; err = syscall.Process32Next(snap, &e) {
		if int(e.ProcessID) == pid {
			return int(e.ParentProcessID)
		}
	}
	return 0
}

// dshWebCommandLineNative reads pid's command line with NtQueryInformationProcess
// (ProcessCommandLineInformation, Windows 8.1+), "" when it cannot.
// 来源：Win32 docs — NtQueryInformationProcess / ProcessCommandLineInformation 返回 UNICODE_STRING。
func dshWebCommandLineNative(pid int) string {
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return ""
	}
	defer windows.CloseHandle(h)
	var need uint32
	_ = windows.NtQueryInformationProcess(h, windows.ProcessCommandLineInformation, nil, 0, &need)
	if need < uint32(unsafe.Sizeof(windows.NTUnicodeString{})) || need > 1<<20 {
		return ""
	}
	buf := make([]byte, need)
	if windows.NtQueryInformationProcess(h, windows.ProcessCommandLineInformation, unsafe.Pointer(&buf[0]), need, &need) != nil {
		return ""
	}
	return (*windows.NTUnicodeString)(unsafe.Pointer(&buf[0])).String()
}
