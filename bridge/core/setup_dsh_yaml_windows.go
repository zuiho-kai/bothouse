package core

import (
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"os"
	"time"

	"golang.org/x/sys/windows"
)

// Source: Go cmd/internal/robustio uses a 2000ms retry budget and an initial
// 1ms jittered backoff for Windows rename failures. Keep this local to DSH YAML
// saves: a running profile reader may briefly deny replacement of its file.
const dshYAMLRenameTimeout = 2 * time.Second

func renameDSHYAML(oldpath, newpath string) error {
	started := time.Now()
	delay := time.Millisecond
	for attempt := 1; ; attempt++ {
		err := os.Rename(oldpath, newpath)
		if err == nil {
			if attempt > 1 {
				slog.Info("dsh YAML rename recovered", "path", newpath, "attempts", attempt, "elapsed", time.Since(started))
			}
			return nil
		}
		if !errors.Is(err, windows.ERROR_ACCESS_DENIED) && !errors.Is(err, windows.ERROR_SHARING_VIOLATION) {
			return err
		}
		remaining := dshYAMLRenameTimeout - time.Since(started)
		if remaining <= 0 {
			slog.Warn("dsh YAML rename retry exhausted", "path", newpath, "attempts", attempt, "elapsed", time.Since(started), "error", err)
			return fmt.Errorf("YAML rename failed after %d attempts: %w", attempt, err)
		}
		if attempt == 1 {
			slog.Warn("dsh YAML rename blocked; retrying", "path", newpath, "attempts", attempt, "timeout", dshYAMLRenameTimeout, "error", err)
		}
		wait := delay
		if wait > remaining {
			wait = remaining
		}
		time.Sleep(wait)
		delay += time.Duration(rand.Int64N(int64(delay)))
	}
}
