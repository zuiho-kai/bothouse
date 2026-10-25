package core

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/tests/testutil"
)

func writeLegacyFixture(t *testing.T, root, rel string, data []byte) {
	t.Helper()
	path := filepath.Join(root, rel)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestMigrateLegacyDataDir(t *testing.T) {
	home := t.TempDir()
	testutil.SetHome(t, home)
	old, dst := filepath.Join(home, ".cc-connect"), filepath.Join(home, ".bothouse")
	cron := []byte(`[{"id":"outing","project":"dragon","cron_expr":"0 9 * * *","session_key":"test:room","prompt":"walk","enabled":true}]`)
	writeLegacyFixture(t, old, "crons/jobs.json", cron)
	writeLegacyFixture(t, old, "usage/2026-10-24.json", []byte(`{"tokens":123}`))
	now := time.Now()
	jobs := []*TimerJob{
		{ID: "recent", ScheduledAt: now.Add(-time.Minute)},
		{ID: "stale", ScheduledAt: now.Add(-time.Hour)},
		{ID: "future", ScheduledAt: now.Add(time.Hour)},
		{ID: "fired", ScheduledAt: now.Add(-time.Hour), Fired: true, LastError: "original"},
	}
	timers, err := json.Marshal(jobs)
	if err != nil {
		t.Fatal(err)
	}
	writeLegacyFixture(t, old, "timers/jobs.json", timers)

	if err := MigrateLegacyDataDir(dst); err != nil {
		t.Fatal(err)
	}
	cs, err := NewCronStore(dst)
	if err != nil || len(cs.List()) != 1 || cs.List()[0].ID != "outing" {
		t.Fatalf("restored cron: store=%v err=%v", cs, err)
	}
	ts, err := NewTimerStore(dst)
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"recent", "stale"} {
		job := ts.Get(id)
		if !job.Fired || job.LastError != "skipped overdue timer during legacy data migration" {
			t.Fatalf("overdue timer can replay: %+v", job)
		}
	}
	if ts.Get("future").Fired || ts.Get("fired").LastError != "original" {
		t.Fatal("changed future or already-fired timer")
	}
	for _, rel := range []string{"crons/jobs.json", "timers/jobs.json", "usage/2026-10-24.json"} {
		source, err := os.ReadFile(filepath.Join(old, rel))
		if err != nil {
			t.Fatal(err)
		}
		if rel == "timers/jobs.json" && !bytes.Equal(source, timers) {
			t.Fatal("legacy timers modified")
		}
		dest, err := os.ReadFile(filepath.Join(dst, rel))
		if err != nil {
			t.Fatal(err)
		}
		if rel != "timers/jobs.json" && !bytes.Equal(source, dest) {
			t.Fatalf("copy differs: %s", rel)
		}
	}
	// Repeated startups must preserve the new stores, including edits made there.
	writeLegacyFixture(t, dst, "crons/jobs.json", []byte("[]"))
	if err := MigrateLegacyDataDir(dst); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(filepath.Join(dst, "crons/jobs.json"))
	if string(data) != "[]" {
		t.Fatal("existing cron overwritten")
	}
}

func TestMigrateLegacyDataDirExistingStores(t *testing.T) {
	home := t.TempDir()
	testutil.SetHome(t, home)
	old, dst := filepath.Join(home, ".cc-connect"), filepath.Join(home, ".bothouse")
	for _, rel := range []string{"crons/jobs.json", "timers/jobs.json", "usage/2026-10-25.json", "usage/import-state.json"} {
		writeLegacyFixture(t, dst, rel, []byte("[]"))
	}
	for _, rel := range []string{"crons/jobs.json", "timers/jobs.json", "usage/2026-10-24.json", "usage/2026-10-25.json", "usage/import-state.json"} {
		writeLegacyFixture(t, old, rel, []byte("legacy"))
	}
	if err := MigrateLegacyDataDir(dst); err != nil {
		t.Fatal(err)
	}
	for _, rel := range []string{"crons/jobs.json", "timers/jobs.json", "usage/2026-10-25.json", "usage/import-state.json"} {
		data, err := os.ReadFile(filepath.Join(dst, rel))
		if err != nil || string(data) != "[]" {
			t.Fatalf("%s overwritten: %q %v", rel, data, err)
		}
	}
	data, err := os.ReadFile(filepath.Join(dst, "usage/2026-10-24.json"))
	if err != nil || string(data) != "legacy" {
		t.Fatalf("missing historical usage: %q %v", data, err)
	}
}

func TestMigrateLegacyDataDirWriteFailureContinues(t *testing.T) {
	home := t.TempDir()
	testutil.SetHome(t, home)
	old, dst := filepath.Join(home, ".cc-connect"), filepath.Join(home, ".bothouse")
	for _, rel := range []string{"crons/jobs.json", "timers/jobs.json", "usage/2026-10-24.json"} {
		writeLegacyFixture(t, old, rel, []byte("[]"))
	}
	readonly := filepath.Join(dst, "crons")
	if err := os.MkdirAll(readonly, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(readonly, 0o500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(readonly, 0o700) })
	// Root and Windows may ignore directory write permissions.
	if probe, err := os.CreateTemp(readonly, "probe"); err == nil {
		probe.Close()
		os.Remove(probe.Name())
		t.Skip("filesystem does not enforce read-only directory permissions")
	}
	if err := MigrateLegacyDataDir(dst); err == nil {
		t.Fatal("write failure was not reported")
	}
	if _, err := os.Stat(filepath.Join(dst, "crons/jobs.json")); !os.IsNotExist(err) {
		t.Fatal("failed cron copy unexpectedly exists")
	}
	for _, rel := range []string{"timers/jobs.json", "usage/2026-10-24.json"} {
		data, err := os.ReadFile(filepath.Join(dst, rel))
		if err != nil || string(data) != "[]" {
			t.Fatalf("write failure prevented %s migration: %q %v", rel, data, err)
		}
	}
}

func TestMigrateLegacyDataDirMissingCustomAndInvalid(t *testing.T) {
	home := t.TempDir()
	testutil.SetHome(t, home)
	old, dst := filepath.Join(home, ".cc-connect"), filepath.Join(home, ".bothouse")
	if err := MigrateLegacyDataDir(dst); err != nil {
		t.Fatal(err)
	}
	writeLegacyFixture(t, old, "crons/jobs.json", []byte("[]"))
	custom := filepath.Join(home, "custom")
	if err := MigrateLegacyDataDir(custom); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(custom); !os.IsNotExist(err) {
		t.Fatal("custom directory modified")
	}
	writeLegacyFixture(t, old, "timers/jobs.json", []byte("{bad"))
	writeLegacyFixture(t, old, "usage/2026-10-24.json", []byte("[]"))
	if err := MigrateLegacyDataDir(dst); err == nil {
		t.Fatal("invalid legacy timers silently accepted")
	}
	if _, err := os.Stat(filepath.Join(dst, "timers/jobs.json")); !os.IsNotExist(err) {
		t.Fatal("invalid timer destination created")
	}
	if _, err := os.Stat(filepath.Join(dst, "usage/2026-10-24.json")); err != nil {
		t.Fatalf("invalid timer blocked usage migration: %v", err)
	}
}
