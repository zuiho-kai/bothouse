package core

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"
)

// Identity comes from the platform envelope, never from prompt text. Automated
// turns and role handoffs deliberately have no member attribution.
func usageMemberOf(msg Message) *UsageMember {
	if msg.FromBot || msg.UserID == "" || msg.Platform == "" || (scheduledTurnUser(msg.UserID) || msg.UserID == "handoff") || turnTriggerOf(&msg) != TurnTriggerUser || msg.resumedFrom != "" {
		return nil
	}
	return &UsageMember{Platform: msg.Platform, Account: msg.UserID, Name: msg.UserName}
}

type usageTurn struct {
	Role      string       `json:"role"`
	SessionID string       `json:"session_id"`
	Start     time.Time    `json:"start"`
	End       time.Time    `json:"end"`
	Member    *UsageMember `json:"member,omitempty"`
}

// Retain only attribution metadata after the recovery journal removes a turn.
// Completed intervals prevent unsolicited/background output after a reply from
// being charged to the last person who spoke. In-flight usage stays unassigned
// until completion. Old turns have no metadata and are never reconstructed.
func (j *TurnJournal) saveUsageTurn(en TurnJournalEntry, end time.Time) {
	if en.AgentSessionID == "" || en.AgentSessionID == ContinueSession {
		return
	}
	if en.Interrupted && !en.InterruptedAt.IsZero() {
		end = en.InterruptedAt
	}
	dir := filepath.Join(filepath.Dir(filepath.Dir(j.path)), "usage-turns", sanitizeJournalName(en.Project))
	turn := usageTurn{Role: en.Project, SessionID: en.AgentSessionID, Start: en.StartedAt, End: end, Member: en.UsageMember}
	b, err := json.Marshal(turn)
	if err == nil {
		err = os.MkdirAll(dir, 0700)
	}
	path := filepath.Join(dir, fmt.Sprintf("%s-%d.json", en.TurnID, en.StartedAt.UnixNano()))
	if err == nil {
		err = os.WriteFile(path+".tmp", b, 0600)
	}
	if err == nil {
		err = os.Rename(path+".tmp", path)
	}
	if err != nil {
		slog.Warn("usage attribution: save turn", "error", err)
	}
}

func readUsageTurns(dataDir string) (map[string][]usageTurn, error) {
	out := map[string][]usageTurn{}
	paths, err := filepath.Glob(filepath.Join(dataDir, "usage-turns", "*", "*.json"))
	if err != nil {
		return nil, err
	}
	for _, path := range paths {
		b, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("read usage attribution: %w", err)
		}
		var t usageTurn
		if err := json.Unmarshal(b, &t); err != nil {
			return nil, fmt.Errorf("decode usage attribution: %w", err)
		}
		out[t.SessionID] = append(out[t.SessionID], t)
	}
	return out, nil
}

func attributeUsage(r *UsageRecord, turns map[string][]usageTurn) {
	if r.Member != nil || r.SessionID == "" {
		return
	}
	for _, t := range turns[r.SessionID] {
		if t.Role == r.Role && !r.Time.Before(t.Start) && r.Time.Before(t.End) {
			r.Member = t.Member
			return
		}
	}
}
