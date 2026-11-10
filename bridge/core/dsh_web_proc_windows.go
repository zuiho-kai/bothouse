//go:build windows

package core

import (
	"context"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// dshWebProcLookupTimeout bounds one PowerShell call. The caller's round has its own deadline, but a
// PowerShell that never returns must not outlive it: the check runs once per candidate.
// 来源：与本文件里 lsof 那类探活同一量级（setup_dsh_configure.go 记录的实测 0.1–0.3s），PowerShell
// 冷启动再慢也在这个数量级；2s 只留余量，不是新拍的数字。
var dshWebProcLookupTimeout = 2 * time.Second

// dshWebProcLookupNow reads pid's command line through CIM. Windows does not let one process read
// another's environment without a PEB walk, so envKnown is false and dsh_web_owner.go falls back to
// the command line alone — which still carries the profile, the part that says whose host it is.
// 来源：Win32 docs — Win32_Process.CommandLine 是唯一不注入代码就能拿到的完整命令行。
func dshWebProcLookupNow(pid int) (argv []string, env map[string]string, envKnown, ok bool) {
	if pid <= 0 {
		return nil, nil, false, false
	}
	ctx, cancel := context.WithTimeout(context.Background(), dshWebProcLookupTimeout)
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
