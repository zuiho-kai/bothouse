package core

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDSHWebRecoveryLeavesUnopenedAndDesktopAlone(t *testing.T) {
	for _, desktop := range []bool{false, true} {
		name := "unopened"
		if desktop {
			name = "desktop"
		}
		t.Run(name, func(t *testing.T) {
			marker := filepath.Join(t.TempDir(), "started")
			fakeSlowDSH(t, "touch '"+marker+"'\nexit 1\n")
			if desktop {
				web := DSHWeb{URL: "http://127.0.0.1:0/?token=fixture", Log: dshDesktopLogPath()}
				b, _ := json.Marshal(web)
				if err := os.MkdirAll(filepath.Dir(dshWebStatePath()), 0o700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(dshWebStatePath(), b, 0o600); err != nil {
					t.Fatal(err)
				}
			}
			s := &dshWebSupervisor{dataDir: t.TempDir()}
			if err := s.recover(context.Background()); err != nil {
				t.Fatal(err)
			}
			if _, err := os.Stat(marker); !os.IsNotExist(err) {
				t.Fatalf("%s started a web host: %v", name, err)
			}
		})
	}
}

func TestDSHWebRecoveryKeepsRunningHost(t *testing.T) {
	fakeSlowDSH(t, "echo 'dsh web: http://127.0.0.1:0/?token=fixture'\nexec sleep 60\n")
	dir := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for {
		web, err := openDSHWeb(ctx, dir)
		if err != nil {
			t.Fatalf("initial open: %+v, %v", web, err)
		}
		if !web.Starting {
			break
		}
	}
	before := readStateRaw(t)
	s := &dshWebSupervisor{dataDir: dir}
	if err := s.recover(context.Background()); err != nil {
		t.Fatal(err)
	}
	if after := readStateRaw(t); string(after) != string(before) {
		t.Fatalf("running host was replaced: %s -> %s", before, after)
	}
}

func TestDSHWebRecoveryClaimsSlowLaunch(t *testing.T) {
	release := filepath.Join(t.TempDir(), "release")
	fakeSlowDSH(t, "while [ ! -f '"+release+"' ]; do sleep 0.02; done\necho 'dsh web: http://127.0.0.1:0/?token=fixture'\nexec sleep 60\n")
	dir := t.TempDir()
	web, err := openDSHWeb(context.Background(), dir)
	if err != nil || !web.Starting {
		t.Fatalf("initial launch: %+v, %v", web, err)
	}
	s := &dshWebSupervisor{dataDir: dir}
	if err := s.recover(context.Background()); err != nil {
		t.Fatal(err)
	}
	dshWebMu.Lock()
	launch := currentDSHWebLaunch()
	dshWebMu.Unlock()
	if launch != nil {
		if launch.PID != web.PID {
			t.Fatalf("launch duplicated: %d -> %d", web.PID, launch.PID)
		}
	} else if got := stateForTest(t); got.PID != web.PID {
		t.Fatalf("launch duplicated: %d -> %+v", web.PID, got)
	}
	if err := os.WriteFile(release, nil, 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestDSHWebRecoveryRestartsFailedFirstLaunch(t *testing.T) {
	marker := filepath.Join(t.TempDir(), "attempted")
	release := filepath.Join(t.TempDir(), "release")
	fakeSlowDSH(t, "if [ ! -f '"+marker+"' ]; then\n touch '"+marker+"'\n while [ ! -f '"+release+"' ]; do sleep 0.02; done\n exit 3\nfi\necho 'dsh web: http://127.0.0.1:0/?token=fixture'\nexec sleep 60\n")
	dir := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	first, err := openDSHWeb(ctx, dir)
	if err != nil || !first.Starting {
		t.Fatalf("first launch: %+v, %v", first, err)
	}
	s := &dshWebSupervisor{dataDir: dir}
	if err := s.recover(ctx); err != nil {
		t.Fatal(err)
	}
	dshWebMu.Lock()
	launch := currentDSHWebLaunch()
	dshWebMu.Unlock()
	if err := os.WriteFile(release, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	select {
	case <-launch.exited:
	case <-ctx.Done():
		t.Fatal("first launch did not exit")
	}
	for {
		if err := s.recover(ctx); err != nil {
			t.Fatal(err)
		}
		if next := stateForTest(t); next.PID > 0 && next.URL != "" {
			if next.PID == first.PID {
				t.Fatal("failed first launch was not replaced")
			}
			break
		}
	}
}

func TestDSHWebRecoveryAdoptsRunningOrphan(t *testing.T) {
	w := newOpenTakeoverWorld(t)
	w.writeLog(t, w.defaultLog(), "dsh web: http://127.0.0.1:"+w.port+"/?token=launch")
	w.writeState(t, DSHWeb{URL: "http://127.0.0.1:" + w.port + "/?token=launch", Log: w.defaultLog()})
	s := &dshWebSupervisor{dataDir: t.TempDir()}
	if err := s.recover(context.Background()); err != nil {
		t.Fatal(err)
	}
	w.assertAdopted(t, stateForTest(t), nil, "launch", w.defaultLog())
}

func TestDSHWebRecoveryHonorsCancellation(t *testing.T) {
	fakeSlowDSH(t, "echo 'unexpected start'\nexec sleep 60\n")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	s := &dshWebSupervisor{dataDir: t.TempDir()}
	if err := s.recover(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("recovery cancellation: %v", err)
	}
	if _, err := openDSHWeb(ctx, t.TempDir()); !errors.Is(err, context.Canceled) {
		t.Fatalf("open cancellation: %v", err)
	}
	if _, err := os.Stat(dshWebStartingPath()); !os.IsNotExist(err) {
		t.Fatalf("cancelled recovery started a child: %v", err)
	}
	stop := StartDSHWebSupervisor(t.TempDir(), nil)
	started := time.Now()
	stop()
	stop()
	if time.Since(started) > time.Second {
		t.Fatal("stopping the idle supervisor blocked")
	}
	if b, err := os.ReadFile(filepath.Join(filepath.Dir(dshWebStatePath()), "dsh-web.log")); err == nil && strings.Contains(string(b), "unexpected start") {
		t.Fatal("stopped supervisor started a host")
	}
}
