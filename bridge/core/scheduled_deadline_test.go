package core

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestScheduledDeadlineHelper(t *testing.T) {
	path := os.Getenv("BOTHOUSE_DEADLINE_FILE")
	if path == "" {
		return
	}
	if err := os.WriteFile(path, []byte(os.Getenv("CC_JOB_DEADLINE")), 0600); err != nil {
		t.Fatal(err)
	}
}

func TestScheduledShellRoundDeadline(t *testing.T) {
	for _, kind := range []string{"cron", "timer"} {
		for _, minutes := range []int{90, 0} {
			t.Run(fmt.Sprintf("%s/%d", kind, minutes), func(t *testing.T) {
				e := newTestEngine()
				defer e.cancel()
				p := &stubPlatformEngine{n: "test"}
				dir, err := os.MkdirTemp("", "scheduled-deadline-")
				if err != nil {
					t.Fatal(err)
				}
				path := filepath.Join(dir, "deadline")
				t.Setenv("BOTHOUSE_DEADLINE_FILE", path)
				t.Setenv("CC_JOB_DEADLINE", "stale-parent-value")
				command := fmt.Sprintf("%q -test.run=^TestScheduledDeadlineHelper$", os.Args[0])
				if runtime.GOOS == "windows" {
					command = "& '" + strings.ReplaceAll(os.Args[0], "'", "''") + "' '-test.run=^TestScheduledDeadlineHelper$'"
				}
				started := time.Now()
				if kind == "cron" {
					err = e.executeCronShell(p, nil, &CronJob{Exec: command, WorkDir: dir, TimeoutMins: &minutes})
				} else {
					err = e.executeTimerShell(p, nil, &TimerJob{Exec: command, WorkDir: dir, TimeoutMins: &minutes})
				}
				if err != nil {
					t.Fatal(err)
				}
				data, err := os.ReadFile(path)
				if err != nil {
					t.Fatal(err)
				}
				if minutes == 0 {
					if string(data) != "" {
						t.Fatalf("unlimited job inherited deadline %q", data)
					}
					return
				}
				deadline, err := strconv.ParseFloat(string(data), 64)
				if err != nil {
					t.Fatalf("child did not receive deadline: %q (%v)", data, err)
				}
				remaining := deadline - float64(started.UnixNano())/float64(time.Second)
				want := (time.Duration(minutes) * time.Minute).Seconds()
				if remaining < want || remaining > want+time.Since(started).Seconds() {
					t.Fatalf("deadline budget %.3fs, want configured %.3fs", remaining, want)
				}
			})
		}
	}
}

func TestScheduledShellDeadlineUsesEarlierParent(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	ctx, stop := scheduledShellContext(ctx, 90*time.Minute)
	defer stop()
	deadline, _ := ctx.Deadline()
	if time.Until(deadline) > time.Second {
		t.Fatal("scheduled context extended its parent deadline")
	}
}

func TestCronDataDirHelper(t *testing.T) {
	path := os.Getenv("BOTHOUSE_CRON_ROOT_FILE")
	if path == "" {
		return
	}
	if err := os.WriteFile(path, []byte(os.Getenv("BOTHOUSE_DATA_DIR")), 0600); err != nil {
		t.Fatal(err)
	}
}

func TestCronShellUsesConfiguredDataDir(t *testing.T) {
	e := newTestEngine()
	defer e.cancel()
	dir := t.TempDir()
	e.dataDir = filepath.Join(dir, "custom data root")
	path := filepath.Join(dir, "root.txt")
	t.Setenv("BOTHOUSE_CRON_ROOT_FILE", path)
	t.Setenv("BOTHOUSE_DATA_DIR", "stale-instance")
	command := shellRun(os.Args[0], cmdQuote("-test.run=^TestCronDataDirHelper$"))
	if err := e.executeCronShell(&stubPlatformEngine{n: "test"}, nil, &CronJob{Exec: command, WorkDir: dir}); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil || string(data) != e.dataDir {
		t.Fatalf("cron data root %q, want %q (err=%v)", data, e.dataDir, err)
	}
}
