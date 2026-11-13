package core

import (
	"context"
	"log/slog"
	"os"
	"time"
)

type dshWebSupervisor struct {
	dataDir string
	store   WizardStore
	wanted  bool // once a launch is seen, a failed first start must also be retried
}

// StartDSHWebSupervisor keeps a previously opened web host available while a DSH-only
// install stays in setup mode (#1728). Existing ready/starting records survive bridge
// restarts. An unopened install and the desktop app remain outside this supervisor.
// The returned stop waits for recovery to finish but leaves the detached host running.
func StartDSHWebSupervisor(dataDir string, store WizardStore) func() {
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	s := &dshWebSupervisor{dataDir: dataDir, store: store}
	go func() {
		defer close(done)
		timer := time.NewTimer(0)
		defer timer.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
				if err := s.recover(ctx); err != nil && ctx.Err() == nil {
					slog.Warn("dsh web: automatic recovery failed", "error", err)
				}
				// Space attempts after completion, including failures and slow first starts.
				timer.Reset(5 * time.Second)
			}
		}
	}()
	return func() {
		cancel()
		<-done
	}
}

func (s *dshWebSupervisor) recover(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	dshWebMu.Lock()
	web, _, recorded := readDSHWebState()
	// currentDSHWebLaunch removes dead records, so remember one before reading it.
	_, startingErr := os.Stat(dshWebStartingPath())
	launch := currentDSHWebLaunch()
	if isDSHDesktopHost(web) {
		s.wanted = false
		dshWebMu.Unlock()
		return nil
	}
	s.wanted = s.wanted || recorded || startingErr == nil || launch != nil
	if launch != nil && launch.gone() {
		clearDSHWebLaunch()
		launch = nil
	}
	// Do not turn a fresh install into a web install or restart an app-owned host.
	// A live host needs no open call: opening can import roles and deliberately restart it.
	keep := !s.wanted ||
		(launch == nil && web.PID > 0 && processAlive(web.PID))
	dshWebMu.Unlock()
	if keep {
		return nil
	}
	if launch == nil {
		if err := pickGatePortForDSH(s.dataDir, s.store); err != nil {
			return err
		}
	}
	EnsureGateForDSH(s.dataDir)
	// Reuse the panel's serialized launcher, ownership checks and orphan adoption.
	// It claims an in-progress launch rather than spawning a second host.
	_, err := openDSHWeb(ctx, s.dataDir)
	return err
}
