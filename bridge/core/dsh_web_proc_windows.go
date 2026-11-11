//go:build windows

package core

import (
	"context"
	"os/exec"
	"strconv"
	"strings"
	"time"
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

// dshWebParentPIDNow reads pid's parent through CIM (Win32_Process.ParentProcessId), 0 when it cannot.
// Same bound as the command-line lookup above.
func dshWebParentPIDNow(ctx context.Context, pid int) int {
	if pid <= 0 {
		return 0
	}
	ctx, cancel := context.WithTimeout(ctx, dshWebProcLookupTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, "powershell", "-NoProfile", "-NonInteractive", "-Command",
		"(Get-CimInstance Win32_Process -Filter \"ProcessId="+strconv.Itoa(pid)+"\").ParentProcessId").Output()
	if err != nil {
		return 0
	}
	n, err := strconv.Atoi(strings.TrimSpace(string(out)))
	if err != nil {
		return 0
	}
	return n
}
