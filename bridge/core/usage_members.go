package core

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"
)

const usageUnassigned = "system"

// Usage attribution is separate from token ingestion: CLI logs remain the only
// source of token counts. Only completed bridge turns have bounded ownership;
// background output, old logs and interrupted turns stay unassigned.
type usageTurn struct {
	Role      string    `json:"role"`
	SessionID string    `json:"session_id"`
	Member    string    `json:"member"`
	Start     time.Time `json:"start"`
	End       time.Time `json:"end"`
}

func (e *Engine) recordUsageTurn(msg *Message, sid string, start, end time.Time) {
	if e.dataDir == "" || sid == "" || msg == nil {
		return
	}
	member := usageUnassigned
	if callerKindOf(msg.UserID, msg.FromBot, msg.timerJobID != "" || msg.cronJobID != "", msg.inputTurn != nil) == CallerHuman && msg.Platform != "" && msg.UserID != "" {
		member = msg.Platform + ":" + msg.UserID
	}
	turn := usageTurn{Role: e.name, SessionID: sid, Member: member, Start: start, End: end}
	if err := writeUsageTurn(filepath.Join(e.dataDir, "usage", "turns"), turn); err != nil {
		slog.Warn("usage attribution: write turn", "error", err)
	}
}

func writeUsageTurn(dir string, turn usageTurn) error {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	b, err := json.Marshal(turn)
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(dir, ".turn-")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	_, err = f.Write(b)
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(f.Name(), f.Name()+".json")
}

func readUsageTurns(dir string) (map[string][]usageTurn, error) {
	paths, err := filepath.Glob(filepath.Join(dir, "*.json"))
	if err != nil {
		return nil, err
	}
	turns := map[string][]usageTurn{}
	for _, path := range paths {
		b, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		var turn usageTurn
		if err := json.Unmarshal(b, &turn); err != nil {
			return nil, fmt.Errorf("read usage attribution: %w", err)
		}
		turns[turn.SessionID] = append(turns[turn.SessionID], turn)
	}
	return turns, nil
}

func usageMember(record UsageRecord, turns map[string][]usageTurn) string {
	member := usageUnassigned
	for _, turn := range turns[record.SessionID] {
		if turn.Role == record.Role && !record.Time.Before(turn.Start) && record.Time.Before(turn.End) {
			// Overlapping owners cannot be attributed reliably (e.g. a shared backend
			// session); keep their tokens visible without charging a guessed person.
			if member != usageUnassigned && member != turn.Member {
				return usageUnassigned
			}
			member = turn.Member
		}
	}
	return member
}
