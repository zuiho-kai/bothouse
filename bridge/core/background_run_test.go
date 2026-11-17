package core

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/tests/testutil"
)

// Run the installed CLI with the exact role env, then read it through the watcher.
func TestBackgroundRunUsesRoleDirectory(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("bgrun is a POSIX collaboration helper")
	}
	if _, err := testutil.LookPathReal("python3"); err != nil {
		t.Skip("no real python3")
	}
	e := NewEngine("isolated", &stubAgent{}, nil, "", LangEnglish)
	data, _ := roleEnvFixture(t, e)
	cmd := exec.Command(filepath.Join(data, "collaboration", "lead", "bgrun"), "watch-path", "5",
		"/bin/sh", "-c", "sleep 1; echo watcher-visible")
	cmd.Env = MergeEnv(os.Environ(), e.roleSessionEnv("test:workspace"))
	cmd.Env = MergeEnv(cmd.Env, []string{"HOME=" + t.TempDir(), "CC_BIN=/usr/bin/true"})
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("bgrun: %v: %s", err, out)
	}
	run := e.watchBackgroundRun("test:workspace")
	if run == "" {
		t.Fatalf("watcher cannot see CLI run: %s", out)
	}
	dir := filepath.Join(e.backgroundRunsDir(), run)
	deadline := time.Now().Add(5 * time.Second)
	for {
		if raw, err := os.ReadFile(filepath.Join(dir, "wake")); err == nil && strings.Contains(string(raw), "叫醒成功") {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("missing wake receipt")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if raw, err := os.ReadFile(filepath.Join(dir, "exit")); err != nil || strings.TrimSpace(string(raw)) != "0" {
		t.Fatalf("exit = %q, err = %v", raw, err)
	}
	if got := e.watchBackgroundRun("test:workspace"); got != "" {
		t.Fatalf("completed run still blocks watcher: %s", got)
	}
}

// Use the installed runner and its real role environment; only the external
// completion notification is replaced. Exercise both watch entries on its files.
func TestBackgroundRunWatchEntries(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("bgrun is a POSIX collaboration helper")
	}
	python, err := testutil.LookPathReal("python3")
	if err != nil {
		t.Skip("no real python3")
	}
	previous := watchCheckAfter()
	SetTeamWatchCheckAfter(time.Second)
	defer SetTeamWatchCheckAfter(previous)
	for _, tc := range []struct {
		name, timeout string
		output        bool
	}{
		{"silent-unlimited", "0", false},
		{"output-long", "5", true},
		{"silent-timeout", "1", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e, _, p := exitFixture(t, nil)
			data, _ := roleEnvFixture(t, e)
			e.SetTeam(data, "isolated", true)
			e.markPlatformReady(p)
			e.handoffWatchOn.Store(true)
			if err := e.ClaimTeamWorkspaceTask("discord:chatA", "ws1", "工作区1", "", tc.name, 0); err != nil {
				t.Fatal(err)
			}
			stop := filepath.Join(data, "stop")
			program := "import os,sys,time\nwhile not os.path.exists(sys.argv[1]):\n if sys.argv[2] == 'true': print('progress', flush=True)\n time.sleep(0.05)\n"
			cmd := exec.Command(filepath.Join(data, "collaboration", "lead", "bgrun"), tc.name, tc.timeout,
				python, "-u", "-c", program, stop, strconv.FormatBool(tc.output))
			cmd.Env = MergeEnv(os.Environ(), e.roleSessionEnv("discord:ws1"))
			cmd.Env = MergeEnv(cmd.Env, []string{"CC_BIN=/usr/bin/true"})
			out, err := cmd.CombinedOutput()
			if err != nil {
				t.Fatalf("bgrun: %v: %s", err, out)
			}
			runs, err := os.ReadDir(e.backgroundRunsDir())
			if err != nil || len(runs) != 1 {
				t.Fatalf("run receipt: %v, %v", runs, err)
			}
			dir := filepath.Join(e.backgroundRunsDir(), runs[0].Name())
			defer func() {
				if err := os.WriteFile(stop, nil, 0o600); err != nil {
					t.Error(err)
				}
				deadline := time.Now().Add(5 * time.Second)
				for {
					if raw, err := os.ReadFile(filepath.Join(dir, "wake")); err == nil && strings.Count(string(raw), "叫醒成功") == 1 {
						break
					}
					if time.Now().After(deadline) {
						t.Error("missing single completion wake receipt")
						break
					}
					time.Sleep(10 * time.Millisecond)
				}
				if e.watchBackgroundRun("discord:ws1") != "" {
					t.Error("completed command still suppresses watch")
				}
			}()
			// Cross the real configured progress window without faking log timestamps.
			time.Sleep(watchCheckAfter() + 200*time.Millisecond)
			w := newHandoffWatch(e)
			w.tick(time.Now())
			got := handoffsOf(e, "discord:ws1")[0]
			if got.Nudged == tc.output {
				t.Fatalf("output=%v: nudged=%v", tc.output, got.Nudged)
			}
			got.Idle.Ended = time.Now()
			e.updateIdle(idleAssignment{"discord:ws1", got, false}, func(row *TeamHandoff) { row.Idle = got.Idle })
			e.fireIdleWake(idleAssignment{"discord:ws1", got, false})
			idle := handoffsOf(e, "discord:ws1")[0].Idle
			if (idle.Wakes == 0) != tc.output {
				t.Fatalf("output=%v: idle=%+v", tc.output, idle)
			}
			if tc.name == "silent-timeout" {
				if raw, err := os.ReadFile(filepath.Join(dir, "exit")); err != nil || strings.TrimSpace(string(raw)) != "142" {
					t.Fatalf("timeout receipt: %q, %v", raw, err)
				}
			}
			t.Logf("installed bgrun %s: periodic nudge=%v idle wakes=%d", tc.name, got.Nudged, idle.Wakes)
		})
	}
}
