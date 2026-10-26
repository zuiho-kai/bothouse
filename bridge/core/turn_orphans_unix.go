//go:build !windows

package core

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// See turn_orphans.go for which agents can orphan and why acp, antigravity
// and the codex app_server backend rely on launchd killing the bridge's group.

type orphanProc struct {
	pid, ppid, pgid int
	started         time.Time
	command         string
}

// psSnapshot lists all processes; a package variable so tests can replace it.
var psSnapshot = func() ([]orphanProc, error) {
	cmd := exec.Command("ps", "-axo", "pid=,ppid=,pgid=,lstart=,command=")
	cmd.Env = append(os.Environ(), "LC_ALL=C")
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	return parsePS(out), nil
}

// parsePS parses `pid ppid pgid <lstart: Dow Mon DD HH:MM:SS YYYY> command`.
func parsePS(out []byte) []orphanProc {
	var procs []orphanProc
	sc := bufio.NewScanner(bytes.NewReader(out))
	sc.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) < 8 {
			continue
		}
		pid, err1 := strconv.Atoi(f[0])
		ppid, err2 := strconv.Atoi(f[1])
		pgid, err3 := strconv.Atoi(f[2])
		if err1 != nil || err2 != nil || err3 != nil {
			continue
		}
		t, err := time.ParseInLocation("Mon Jan 2 15:04:05 2006", strings.Join(f[3:8], " "), time.Local)
		if err != nil {
			continue
		}
		procs = append(procs, orphanProc{pid: pid, ppid: ppid, pgid: pgid, started: t, command: strings.Join(f[8:], " ")})
	}
	return procs
}

// groupAlive reports whether any process is left in group pgid.
func groupAlive(pgid int) bool {
	err := syscall.Kill(-pgid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}

var orphanTermWait = 5 * time.Second

// killGroup sends SIGTERM to the group, waits, then SIGKILL; nil only once
// the group is gone.
func killGroup(pgid int) error {
	if pgid <= 1 || pgid == syscall.Getpgrp() {
		return fmt.Errorf("refusing to signal process group %d", pgid)
	}
	_ = syscall.Kill(-pgid, syscall.SIGTERM)
	if waitGroupGone(pgid, orphanTermWait) {
		return nil
	}
	_ = syscall.Kill(-pgid, syscall.SIGKILL)
	if waitGroupGone(pgid, 2*time.Second) {
		return nil
	}
	return fmt.Errorf("process group %d still alive after SIGKILL", pgid)
}

func waitGroupGone(pgid int, d time.Duration) bool {
	deadline := time.Now().Add(d)
	for {
		if !groupAlive(pgid) {
			return true
		}
		if time.Now().After(deadline) {
			return false
		}
		time.Sleep(100 * time.Millisecond)
	}
}

// reapTurnOrphan makes sure the agent process group the entry recorded is
// gone before the turn resumes. The group is only ours when its leader still
// runs under that pgid, started no later than the turn (+2s) and carries the
// agent's markers; otherwise the pgid was reused and is left alone.
func (e *Engine) reapTurnOrphan(en TurnJournalEntry) error {
	pgid := en.AgentPGID
	if pgid <= 0 || pgid == syscall.Getpgrp() {
		return nil
	}
	if !groupAlive(pgid) {
		return nil
	}
	procs, err := psSnapshot()
	if err != nil {
		return fmt.Errorf("ps: %w", err)
	}
	ref := en.StartedAt
	if en.AgentSeenAt.After(ref) {
		ref = en.AgentSeenAt
	}
	markers := orphanMarkers(en.AgentType, e.dataDir)
	ours := false
	for _, p := range procs {
		if p.pgid != pgid {
			continue
		}
		if p.started.After(ref.Add(2*time.Second)) || !hasAllMarkers(p.command, markers) {
			continue
		}
		ours = true
		break
	}
	if !ours {
		return nil
	}
	slog.Info("turn resume: stopping old agent process group", "turn", en.TurnID, "pgid", pgid)
	return killGroup(pgid)
}

var strayScanned sync.Map // dataDir -> struct{}

// reapStrayAgentProcesses kills agent process groups an earlier bridge left
// behind, journal or not: parent gone (ppid 1), group leader, started before
// this process and carrying the claudecode marker. Once per
// dataDir per process.
func reapStrayAgentProcesses(dataDir string, start time.Time) {
	if dataDir == "" {
		return
	}
	if _, done := strayScanned.LoadOrStore(dataDir, struct{}{}); done {
		return
	}
	procs, err := psSnapshot()
	if err != nil {
		slog.Warn("turn resume: stray scan ps failed", "error", err)
		return
	}
	self := syscall.Getpgrp()
	// Only claudecode: its marker (<dataDir>/agent-prompts) is unique to this
	// bridge. codex exec carries no bridge-specific mark, and gpt/dsx scripts
	// start the same command, so codex is only reaped by its recorded pid.
	claude := orphanMarkers("claudecode", dataDir)
	for _, p := range procs {
		if p.ppid != 1 || p.pid != p.pgid || p.pgid == self || !p.started.Before(start) {
			continue
		}
		if len(claude) == 0 || !hasAllMarkers(p.command, claude) {
			continue
		}
		slog.Info("turn resume: stopping stray agent process", "pid", p.pid, "command", p.command)
		if err := killGroup(p.pgid); err != nil {
			slog.Warn("turn resume: stray agent process not stopped", "pid", p.pid, "error", err)
		}
	}
}
