//go:build windows

package core

import (
	"errors"
	"fmt"
	"io"
	"os/exec"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Keep the helper and every pnpm descendant in a Windows job. taskkill /T is the existing tree
// stopper (stopProcess), but its return alone is not an exit barrier, and a parent can exit before
// taskkill enumerates its descendants. The job retains those descendants and reports when all
// have exited. No profile writer may pass the caller's lock before that point.
func runPluginUninstallCommand(cmd *exec.Cmd) (runErr error) {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return fmt.Errorf("create uninstall process job: %w", err)
	}
	defer windows.CloseHandle(job)
	var limits windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION
	limits.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err := windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&limits)), uint32(unsafe.Sizeof(limits))); err != nil {
		return fmt.Errorf("configure uninstall process job: %w", err)
	}

	// Node reads the module from stdin. Withhold the entire script until job assignment, so the
	// helper cannot spawn pnpm in the Start -> AssignProcessToJobObject window.
	script := cmd.Stdin
	cmd.Stdin = nil
	input, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	defer input.Close()
	cmd.Cancel = func() error {
		stopProcess(cmd.Process.Pid) // Existing synchronous taskkill /T /F; never just Process.Kill.
		return windows.TerminateJobObject(job, 1)
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	process, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(cmd.Process.Pid))
	if err == nil {
		err = windows.AssignProcessToJobObject(job, process)
		windows.CloseHandle(process)
	}
	if err != nil {
		// No script has reached Node, so no pnpm descendants can exist yet.
		_ = cmd.Process.Kill()
		_ = input.Close()
		_ = cmd.Wait()
		return fmt.Errorf("assign uninstall helper to process job: %w", err)
	}
	defer func() {
		// Also collect children if the helper exits on its own before the context expires.
		if err := finishPluginUninstallJob(job); err != nil {
			runErr = errors.Join(runErr, pluginUninstallCleanupError(err))
		}
	}()
	_, writeErr := io.Copy(input, script)
	closeErr := input.Close()
	if writeErr != nil || closeErr != nil {
		_ = cmd.Cancel()
	}
	return errors.Join(cmd.Wait(), writeErr, closeErr)
}

// pluginUninstallJobIdleWait bounds the wait for the job to report zero live processes. It runs
// inside the caller's profile lock and after the handler's ctx has expired (the deferred cleanup
// is not part of the 30s timeout), so it needs its own bound; without one a process pinned by a
// driver would hold both the request and the write lock forever.
// 来源：与同一次卸载的 pluginUninstallWaitDelay = 5s 同量级（core/management_plugin_uninstall.go:60）。
const pluginUninstallJobIdleWait = pluginUninstallWaitDelay

func finishPluginUninstallJob(job windows.Handle) error {
	if err := windows.TerminateJobObject(job, 1); err != nil {
		return fmt.Errorf("terminate uninstall job: %w", err)
	}
	return waitPluginUninstallIdle(func() (uint32, error) { return pluginUninstallJobActive(job) }, pluginUninstallJobIdleWait)
}

// pluginUninstallJobActive is how many processes are still alive in the job. It is a var so the
// Windows test can prove the bound above without a process the kernel refuses to end.
var pluginUninstallJobActive = func(job windows.Handle) (uint32, error) {
	// 来源：Win32 JOBOBJECT_BASIC_ACCOUNTING_INFORMATION layout. x/sys exposes the
	// information class but not this struct; ActiveProcesses counts nested-job descendants too.
	var accounting struct {
		TotalUserTime, TotalKernelTime                     int64
		ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime int64
		TotalPageFaultCount, TotalProcesses                uint32
		ActiveProcesses, TotalTerminatedProcesses          uint32
	}
	if err := windows.QueryInformationJobObject(job, windows.JobObjectBasicAccountingInformation, uintptr(unsafe.Pointer(&accounting)), uint32(unsafe.Sizeof(accounting)), nil); err != nil {
		return 0, err
	}
	return accounting.ActiveProcesses, nil
}
