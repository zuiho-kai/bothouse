//go:build windows

package core

import "time"

// No process groups to reap on Windows (#618 K4).
func (e *Engine) reapTurnOrphan(en TurnJournalEntry) error { return nil }

func reapStrayAgentProcesses(dataDir string, start time.Time) {}
