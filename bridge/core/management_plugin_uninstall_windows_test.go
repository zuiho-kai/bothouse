//go:build windows

package core

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/tests/testutil"
	"golang.org/x/sys/windows"
)

// A real Node helper starts a pnpm stand-in and a grandchild. Both keep writing until killed,
// including after their parent exits. Injecting timedOut=true cannot exercise this failure.
func TestPluginsUninstallWindowsTimeoutStopsTreeBeforeUnlock(t *testing.T) {
	node, err := testutil.LookPathReal("node")
	if err != nil {
		t.Skip("requires Node for the real uninstall helper")
	}
	dir := t.TempDir()
	anchor := filepath.Join(dir, "package.json")
	manager := filepath.Join(dir, "node_modules", "@deepseek-ai", "dsh-plugin-manager")
	if err := os.MkdirAll(manager, 0o700); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{
		anchor:                                 `{"name":"isolated-timeout-regression","private":true}`,
		filepath.Join(manager, "package.json"): `{"name":"@deepseek-ai/dsh-plugin-manager","type":"module","exports":{"./operations":"./operations.mjs"}}`,
		filepath.Join(manager, "operations.mjs"): `
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
export async function runProfilePnpm({dir}) {
  writeFileSync(dir + '/helper.pid', String(process.pid));
  const child = spawn(process.execPath, [dir + '/writer.cjs', dir, 'pnpm'], {stdio:'inherit', detached:true});
  await new Promise(resolve => child.on('exit', resolve));
  return {exitCode:0};
}`,
		filepath.Join(dir, "writer.cjs"): `
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const [dir, role] = process.argv.slice(2);
fs.writeFileSync(dir + '/' + role + '.pid', String(process.pid));
// Detached lifecycle children survive Node's own kill-on-close job on Windows.
if (role === 'pnpm') spawn(process.execPath, [__filename, dir, 'grandchild'], {stdio:'inherit', detached:true});
setInterval(() => {
  fs.appendFileSync(dir + '/' + role + '.writes', 'x');
  if (!fs.existsSync(dir + '/package.json.lock')) fs.writeFileSync(dir + '/wrote-after-unlock', role);
}, 20);
// Test safety bound, independent of the production timeout under test.
setTimeout(() => process.exit(0), 20000);
`,
	}
	for path, content := range files {
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	// Safety cleanup must also run on the unfixed code, where the helper has already died.
	t.Cleanup(func() {
		for _, role := range []string{"grandchild", "pnpm", "helper"} {
			if pid := uninstallTestPID(t, dir, role); pid > 0 && processAlive(pid) {
				stopProcess(pid)
			}
		}
	})
	// Long enough for the three Node processes to start; the production default is unchanged.
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	err = withPluginProfileLock(anchor, func() error {
		run, err := runPluginUninstallRemoval(ctx, pluginUninstallPlan{dir: dir, anchor: anchor, node: node}, "fixture")
		if err != nil || !run.timedOut {
			t.Fatalf("run=%+v err=%v, want an actual helper timeout", run, err)
		}
		t.Logf("helper output: %s", run.output)
		for _, role := range []string{"helper", "pnpm", "grandchild"} {
			pid := uninstallTestPID(t, dir, role)
			if pid <= 0 {
				t.Fatalf("%s did not start: %s", role, run.output)
			}
			if processAlive(pid) {
				t.Errorf("%s pid=%d still alive when removal returned, before profile unlock", role, pid)
			}
			raw, _ := os.ReadFile(filepath.Join(dir, role+".writes"))
			t.Logf("%s pid=%d alive=%v writerTicks=%d", role, pid, processAlive(pid), len(raw))
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	// Observe several writer ticks after unlocking, not just a successful taskkill invocation.
	time.Sleep(100 * time.Millisecond)
	if raw, err := os.ReadFile(filepath.Join(dir, "wrote-after-unlock")); err == nil {
		t.Errorf("descendant wrote after profile unlock: %s", raw)
	}
}

func uninstallTestPID(t *testing.T, dir, role string) int {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(dir, role+".pid"))
	if err != nil {
		return 0
	}
	var pid int
	if err := json.Unmarshal(raw, &pid); err != nil {
		t.Fatal(err)
	}
	return pid
}

// TestPluginsUninstallWindowsJobWaitGivesUp: a job that keeps reporting live processes must end in
// a retained-lock error within pluginUninstallJobIdleWait, not in an endless poll that holds the
// request and the profile lock. The real job object is created here; only the count is stubbed,
// because a process the kernel refuses to end cannot be produced on demand.
func TestPluginsUninstallWindowsJobWaitGivesUp(t *testing.T) {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer windows.CloseHandle(job)
	restore := pluginUninstallJobActive
	pluginUninstallJobActive = func(windows.Handle) (uint32, error) { return 1, nil }
	t.Cleanup(func() { pluginUninstallJobActive = restore })

	start := time.Now()
	err = finishPluginUninstallJob(job)
	elapsed := time.Since(start)
	if err == nil {
		t.Fatal("a job with live processes reported a confirmed cleanup")
	}
	if elapsed > pluginUninstallJobIdleWait+3*time.Second {
		t.Fatalf("cleanup wait took %s, want it bounded by %s", elapsed, pluginUninstallJobIdleWait)
	}
}
