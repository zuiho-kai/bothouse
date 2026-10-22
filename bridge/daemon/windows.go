//go:build windows

package daemon

import (
	"encoding/base64"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"
)

const (
	windowsTaskName   = ServiceName
	windowsScriptName = "bothouse-daemon.ps1"
)

var runPowerShell = func(script string) (string, error) {
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", strictPowerShell(script))
	out, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

func strictPowerShell(script string) string {
	return "$ErrorActionPreference = 'Stop'\n" + script
}

type schtasksManager struct{}

func newPlatformManager() (Manager, error) {
	if _, err := exec.LookPath("powershell.exe"); err != nil {
		return nil, fmt.Errorf("powershell.exe not found: Windows Task Scheduler management requires PowerShell")
	}
	return &schtasksManager{}, nil
}

func (*schtasksManager) Platform() string { return "schtasks" }

func (m *schtasksManager) Install(cfg Config) error {
	if err := os.MkdirAll(DefaultDataDir(), 0755); err != nil {
		return fmt.Errorf("create data dir: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(cfg.LogFile), 0755); err != nil {
		return fmt.Errorf("create log dir: %w", err)
	}

	scriptPath := windowsTaskScriptPath()
	// 0644 has weak semantics on Windows; the file ACL is what matters.
	// We still write 0600 so the file's POSIX bits do not advertise read
	// access, and rely on the user's own profile ACLs for primary defense
	// (the script lives under %USERPROFILE%\.cc-connect by default).
	// WriteFile only applies perm on create, so Chmod the existing file
	// after writing to harden reinstalls of pre-existing 0644 scripts.
	if err := os.WriteFile(scriptPath, []byte(buildWindowsTaskScript(cfg)), 0600); err != nil {
		return fmt.Errorf("write task script: %w", err)
	}
	if err := os.Chmod(scriptPath, 0600); err != nil {
		return fmt.Errorf("chmod task script: %w", err)
	}

	handedOff, err := stopOrHandOff("install", windowsDeleteTaskPS()+windowsCreateTaskPS(scriptPath)+windowsStartTaskPS())
	if err != nil {
		slog.Warn("schtasks: stop existing task failed", "error", err)
	}
	if handedOff {
		return nil
	}
	if err := deleteWindowsTask(); err != nil {
		if windowsTaskMatchesAction(scriptPath) {
			if err := m.Start(); err != nil {
				return fmt.Errorf("start existing task: %w", err)
			}
			return nil
		}
		return err
	}

	if err := createWindowsTask(scriptPath); err != nil {
		return err
	}

	if err := m.Start(); err != nil {
		return fmt.Errorf("start task: %w", err)
	}
	return nil
}

func (*schtasksManager) Uninstall() error {
	handedOff, err := stopOrHandOff("uninstall", windowsDeleteTaskPS()+
		fmt.Sprintf("Remove-Item -LiteralPath %s -Force -ErrorAction SilentlyContinue\n", powerShellLiteral(windowsTaskScriptPath())))
	if err != nil {
		slog.Warn("schtasks: stop task failed", "error", err)
	}
	if handedOff {
		return nil
	}
	if err := deleteWindowsTask(); err != nil {
		return err
	}
	if err := os.Remove(windowsTaskScriptPath()); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("remove task script: %w", err)
	}
	return nil
}

func (*schtasksManager) Start() error {
	return startWindowsTask()
}

func (*schtasksManager) Stop() error {
	if err := stopWindowsTask(); err != nil {
		return err
	}
	return nil
}

func (*schtasksManager) Restart() error {
	handedOff, err := stopOrHandOff("restart", windowsStartTaskPS())
	if err != nil {
		slog.Warn("schtasks: stop before restart failed", "error", err)
	}
	if handedOff {
		return nil
	}
	return startWindowsTask()
}

func (*schtasksManager) Status() (*Status, error) {
	st := &Status{Platform: "schtasks"}

	out, err := runPowerShell(fmt.Sprintf(`
$task = Get-ScheduledTask -TaskName %s -ErrorAction SilentlyContinue
if ($null -eq $task) { exit 1 }
Write-Output $task.State
`, powerShellLiteral(windowsTaskName)))
	if err != nil {
		return st, nil
	}
	st.Installed = true

	taskStatus := strings.TrimSpace(out)
	if strings.EqualFold(taskStatus, "Running") {
		st.Running = true
	}
	return st, nil
}

func windowsTaskScriptPath() string {
	return filepath.Join(DefaultDataDir(), windowsScriptName)
}

func windowsTaskAction(scriptPath string) string {
	return fmt.Sprintf(`powershell.exe %s`, windowsTaskActionArgs(scriptPath))
}

func windowsTaskActionArgs(scriptPath string) string {
	return fmt.Sprintf(`-WindowStyle Hidden -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%s"`, scriptPath)
}

func createWindowsTask(scriptPath string) error {
	out, err := runPowerShell(windowsCreateTaskPS(scriptPath))
	if err != nil {
		return fmt.Errorf("register scheduled task: %s (%w)", out, err)
	}
	return nil
}

func windowsTaskMatchesAction(scriptPath string) bool {
	out, err := runPowerShell(fmt.Sprintf(`
$task = Get-ScheduledTask -TaskName %s -ErrorAction SilentlyContinue
if ($null -eq $task) { exit 1 }
$expectedArgs = %s
foreach ($action in $task.Actions) {
	if (($action.Execute -ieq 'powershell.exe') -and ($action.Arguments -eq $expectedArgs)) {
		Write-Output 'true'
		exit 0
	}
}
exit 1
`, powerShellLiteral(windowsTaskName), powerShellLiteral(windowsTaskActionArgs(scriptPath))))
	return err == nil && strings.EqualFold(strings.TrimSpace(out), "true")
}

func buildWindowsTaskScript(cfg Config) string {
	var sb strings.Builder
	sb.WriteString("$ErrorActionPreference = 'Stop'\r\n")
	writePowerShellEnv(&sb, "CC_LOG_FILE", cfg.LogFile)
	writePowerShellEnv(&sb, "CC_LOG_MAX_SIZE", strconv.FormatInt(cfg.LogMaxSize, 10))
	writePowerShellEnv(&sb, "CC_LOG_MAX_BACKUPS", strconv.Itoa(cfg.LogMaxBackups))
	if cfg.EnvPATH != "" {
		writePowerShellEnv(&sb, "PATH", cfg.EnvPATH)
	}
	if len(cfg.EnvExtra) > 0 {
		keys := make([]string, 0, len(cfg.EnvExtra))
		for key := range cfg.EnvExtra {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			if !isValidEnvName(key) {
				slog.Warn("daemon: windows: dropping invalid env name from EnvExtra",
					"key", key)
				continue
			}
			value := cfg.EnvExtra[key]
			if value == "" {
				continue
			}
			writePowerShellEnv(&sb, key, value)
		}
	}
	// cc-connect restarts itself under the service by exiting with 75 (cmd/cc-connect/restart_windows.go):
	// start it again at once instead of leaving a parent process behind.
	writePowerShellEnv(&sb, "CC_SUPERVISED", "1")
	fmt.Fprintf(&sb, "Set-Location -LiteralPath %s\r\n", powerShellLiteral(cfg.WorkDir))
	sb.WriteString("while ($true) {\r\n")
	fmt.Fprintf(&sb, "  & %s\r\n", powerShellLiteral(cfg.BinaryPath))
	sb.WriteString("  $exitCode = $LASTEXITCODE\r\n")
	sb.WriteString("  if ($exitCode -eq 0) { exit 0 }\r\n")
	sb.WriteString("  if ($exitCode -eq 75) { continue }\r\n")
	sb.WriteString("  Start-Sleep -Seconds 10\r\n")
	sb.WriteString("}\r\n")
	return sb.String()
}

func writePowerShellEnv(sb *strings.Builder, key, value string) {
	fmt.Fprintf(sb, "$env:%s = %s\r\n", key, powerShellLiteral(value))
}

func powerShellLiteral(value string) string {
	value = strings.ReplaceAll(value, "\r", " ")
	value = strings.ReplaceAll(value, "\n", " ")
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}

// stopWindowsTask stops the service: the task and everything its wrapper script started.
func stopWindowsTask() error {
	_, err := stopOrHandOff("stop", "")
	return err
}

// windowsProcessTreePS collects the wrapper's process tree into $tree and this PowerShell's
// ancestors into $anc. The wrapper is found by its command line (-File "<task script>", see
// windowsTaskActionArgs; $needle) — not this PowerShell, whose own command line names the
// script too. A child only counts when it was created after its parent, so a recycled PID
// whose old parent is gone is not mistaken for part of the tree.
const windowsProcessTreePS = `
$all = @(Get-CimInstance Win32_Process)
$byId = @{}
foreach ($p in $all) { $byId[[int]$p.ProcessId] = $p }
$tree = @($all | Where-Object { $_.ProcessId -ne $PID -and $_.Name -ieq 'powershell.exe' -and $_.CommandLine -and $_.CommandLine.Contains($needle) } | ForEach-Object { [int]$_.ProcessId })
for ($i = 0; $i -lt $tree.Count; $i++) {
	$parent = $byId[$tree[$i]]
	$tree += @($all | Where-Object { $_.ParentProcessId -eq $tree[$i] -and $tree -notcontains [int]$_.ProcessId -and $_.CreationDate -ge $parent.CreationDate } | ForEach-Object { [int]$_.ProcessId })
}
$anc = @()
$cur = $byId[[int]$PID]
for ($d = 0; $d -lt 64 -and $null -ne $cur; $d++) {
	$anc += [int]$cur.ProcessId
	$up = $byId[[int]$cur.ParentProcessId]
	if ($null -eq $up -or $up.CreationDate -gt $cur.CreationDate) { break }
	$cur = $up
}
`

// windowsStopPS ends the task and the wrapper's whole process tree. Stop-ScheduledTask alone only
// ends the wrapper powershell.exe: the cc-connect it runs, and that one's agent CLIs, kept running
// as orphans and the bot stayed online. Errors throw (no exit), so it can be followed by more steps.
func windowsStopPS() string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "$needle = '-File \"' + %s + '\"'\n", powerShellLiteral(windowsTaskScriptPath()))
	sb.WriteString(windowsProcessTreePS)
	fmt.Fprintf(&sb, `
$task = Get-ScheduledTask -TaskName %[1]s -ErrorAction SilentlyContinue
if ($null -ne $task -and $task.State -eq 'Running') { Stop-ScheduledTask -TaskName %[1]s }
foreach ($id in $tree) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
$stopped = $false
for ($i = 0; $i -lt 20; $i++) {
	$task = Get-ScheduledTask -TaskName %[1]s -ErrorAction SilentlyContinue
	if ($null -eq $task -or $task.State -ne 'Running') { $stopped = $true; break }
	Start-Sleep -Milliseconds 500
}
if (-not $stopped) { throw 'scheduled task did not stop within timeout' }
`, powerShellLiteral(windowsTaskName))
	return sb.String()
}

func windowsStartTaskPS() string {
	return fmt.Sprintf(`
$task = Get-ScheduledTask -TaskName %[1]s -ErrorAction SilentlyContinue
if ($null -eq $task) { throw 'scheduled task not found' }
if ($task.State -ne 'Running') { Start-ScheduledTask -TaskName %[1]s }
`, powerShellLiteral(windowsTaskName))
}

func windowsDeleteTaskPS() string {
	return fmt.Sprintf(`
if ($null -ne (Get-ScheduledTask -TaskName %[1]s -ErrorAction SilentlyContinue)) { Unregister-ScheduledTask -TaskName %[1]s -Confirm:$false }
`, powerShellLiteral(windowsTaskName))
}

func windowsCreateTaskPS(scriptPath string) string {
	return fmt.Sprintf(`
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument %s
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName %s -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
`, powerShellLiteral(windowsTaskActionArgs(scriptPath)), powerShellLiteral(windowsTaskName))
}

// windowsHandOffLog is where a detached stop / restart / install / uninstall writes how it went.
func windowsHandOffLog() string { return filepath.Join(DefaultDataDir(), "logs", "daemon-handoff.log") }

// stopOrHandOff stops the service, unless the caller is itself inside the service's process tree:
// an agent the bot started runs `cc-connect daemon restart` / `stop` / `install --force` /
// `uninstall` (setup apply's next_steps suggest restart). Ending the tree would then kill the
// caller (and this PowerShell) halfway, and the steps after the stop would never run or would
// race with it — the service ends up gone or stopped while the command reported success. So in
// that case the stop and everything after it (after: PowerShell for the rest of the operation)
// run in a new process created through WMI (Win32_Process.Create), whose parent is the WMI
// service, outside the tree; the result goes to windowsHandOffLog. handedOff = true means the
// caller must not do the rest itself. Otherwise only the stop runs here and the caller goes on.
func stopOrHandOff(op, after string) (handedOff bool, err error) {
	logPath := windowsHandOffLog()
	var d strings.Builder
	fmt.Fprintf(&d, "$log = %s\n", powerShellLiteral(logPath))
	fmt.Fprintf(&d, "function Write-HandOff($m) { New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null; Add-Content -LiteralPath $log -Encoding utf8 -Value ((Get-Date -Format o) + ' daemon %s: ' + $m) }\n", op)
	d.WriteString("Write-HandOff 'started outside the service (the command was run from inside it)'\n")
	d.WriteString("try {\n")
	d.WriteString(windowsStopPS())
	d.WriteString(after)
	d.WriteString("\nWrite-HandOff 'done'\n} catch { Write-HandOff ('failed: ' + $_); exit 1 }\nexit 0\n")
	enc := base64.StdEncoding.EncodeToString(utf16LE(strictPowerShell(d.String())))

	var sb strings.Builder
	fmt.Fprintf(&sb, "$needle = '-File \"' + %s + '\"'\n", powerShellLiteral(windowsTaskScriptPath()))
	sb.WriteString(windowsProcessTreePS)
	fmt.Fprintf(&sb, `
if (@($tree | Where-Object { $anc -contains $_ }).Count -gt 0) {
	$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = 'powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand %s' }
	if ($r.ReturnValue -ne 0) { Write-Error ('could not start the detached process: Win32_Process.Create returned ' + $r.ReturnValue); exit 1 }
	Write-Output 'detached'
	exit 0
}
`, enc)
	sb.WriteString(windowsStopPS())
	sb.WriteString("exit 0\n")
	out, err := runPowerShell(sb.String())
	if err != nil {
		return false, fmt.Errorf("stop scheduled task: %s (%w)", out, err)
	}
	if strings.TrimSpace(out) == "detached" {
		fmt.Fprintf(os.Stderr, "Run from inside the service: daemon %s continues in a separate process (this command and the bot's current run end). Result: %s\n", op, logPath)
		return true, nil
	}
	return false, nil
}

func utf16LE(s string) []byte {
	u := utf16.Encode([]rune(s))
	b := make([]byte, 2*len(u))
	for i, c := range u {
		b[2*i], b[2*i+1] = byte(c), byte(c>>8)
	}
	return b
}

func startWindowsTask() error {
	out, err := runPowerShell(windowsStartTaskPS())
	if err != nil {
		return fmt.Errorf("start scheduled task: %s (%w)", out, err)
	}
	return nil
}

func deleteWindowsTask() error {
	out, err := runPowerShell(windowsDeleteTaskPS())
	if err != nil {
		return fmt.Errorf("delete scheduled task: %s (%w)", out, err)
	}
	return nil
}

// CheckLinger is a no-op on Windows (always returns false).
func CheckLinger() (enabled bool, user string) {
	return false, ""
}
