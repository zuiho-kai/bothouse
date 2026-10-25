package core

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"
)

// MigrateLegacyDataDir restores stores missing from the default .bothouse
// directory. Custom data directories and the legacy directory itself are left
// alone. Each existing store wins in full; usage history is never merged.
func MigrateLegacyDataDir(dataDir string) error {
	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("legacy data migration: home directory: %w", err)
	}
	if filepath.Clean(dataDir) != filepath.Join(home, ".bothouse") {
		return nil
	}
	legacy := filepath.Join(home, ".cc-connect")
	files := []string{"crons/jobs.json", "timers/jobs.json"}
	usage, err := filepath.Glob(filepath.Join(legacy, "usage", "*.json"))
	var failures []error
	if err != nil {
		failures = append(failures, fmt.Errorf("legacy data migration: list legacy usage: %w", err))
	}
	for _, path := range usage {
		files = append(files, filepath.Join("usage", filepath.Base(path)))
	}

	now := time.Now()
	for _, rel := range files {
		if err := migrateLegacyDataFile(legacy, dataDir, rel, now); err != nil {
			failures = append(failures, err)
		}
	}
	return errors.Join(failures...)
}

// Keep each file independent so a damaged or unwritable store cannot prevent
// migration of the remaining history. The caller reports accumulated failures.
func migrateLegacyDataFile(legacy, dataDir, rel string, now time.Time) error {
	src, dst := filepath.Join(legacy, rel), filepath.Join(dataDir, rel)
	if _, err := os.Stat(dst); err == nil {
		return nil
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("legacy data migration: inspect %s: %w", dst, err)
	}
	data, err := os.ReadFile(src)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("legacy data migration: read %s: %w", src, err)
	}
	skipped := 0
	if rel == "timers/jobs.json" {
		var jobs []*TimerJob
		if err := json.Unmarshal(data, &jobs); err != nil {
			return fmt.Errorf("legacy data migration: decode %s: %w", src, err)
		}
		for _, job := range jobs {
			if job == nil || (!job.Fired && job.ScheduledAt.IsZero()) {
				return fmt.Errorf("legacy data migration: invalid timer in %s", src)
			}
			if !job.Fired && !job.ScheduledAt.After(now) {
				// Normal restarts replay recently missed timers. An upgrade
				// must not replay old work from the legacy directory.
				job.Fired = true
				job.FiredAt = now
				job.LastError = "skipped overdue timer during legacy data migration"
				skipped++
			}
		}
		data, err = json.MarshalIndent(jobs, "", "  ")
		if err != nil {
			return fmt.Errorf("legacy data migration: encode timers: %w", err)
		}
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o700); err != nil {
		return fmt.Errorf("legacy data migration: create destination: %w", err)
	}
	if err := AtomicWriteFile(dst, data, 0o600); err != nil {
		return fmt.Errorf("legacy data migration: copy %s: %w", rel, err)
	}
	slog.Info("legacy data migrated", "source", src, "destination", dst, "overdue_timers_skipped", skipped)
	return nil
}
