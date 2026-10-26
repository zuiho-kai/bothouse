package core

import (
	"log/slog"
	"strings"
)

// #618 K4 orphan reaping, shared parts. Only agents whose turn process leaves
// the bridge's process group can orphan: claudecode (own group) and the codex
// exec backend (Setpgid). acp, antigravity and the codex app_server backend
// start their children without Setpgid, so they stay in the bridge's group;
// the bridge runs under launchd (com.zuiho.cc-connect) and launchd kills the
// whole group when the bridge dies (AbandonProcessGroup is off). That relies
// on launchd: run the bridge some other way and those children can survive.

// orphanMarkers returns the command-line substrings a process of agentType
// must all carry to be ours; nil means no check.
func orphanMarkers(agentType, dataDir string) []string {
	switch agentType {
	case "claudecode":
		if dataDir == "" {
			return nil
		}
		return []string{strings.TrimRight(dataDir, "/") + "/agent-prompts"}
	case "codex":
		// Fixed args of the bridge's codex exec turn (agent/codex/session.go).
		return []string{"exec", "--skip-git-repo-check"}
	}
	return nil
}

func hasAllMarkers(command string, markers []string) bool {
	for _, m := range markers {
		if !strings.Contains(command, m) {
			return false
		}
	}
	return true
}

// journalAgentProcess re-records the running turn's agent process on
// interactiveKey. Codex starts its exec cmd inside Send, after
// journalTurnAgent ran, so the pid is written back once the cmd reports in.
func (e *Engine) journalAgentProcess(interactiveKey string, state *interactiveState) {
	j := e.turnJournalStore()
	if j == nil || state == nil {
		return
	}
	state.mu.Lock()
	as := state.agentSession
	state.mu.Unlock()
	if _, ok := as.(AgentProcessInfo); !ok {
		return
	}
	id := j.Active(interactiveKey)
	if id == "" {
		return
	}
	if _, err := j.Update(id, func(en *TurnJournalEntry) { journalAgentFields(en, as) }); err != nil {
		slog.Warn("turn journal: process update failed", "turn", id, "error", err)
	}
}
