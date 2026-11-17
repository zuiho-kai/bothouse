package core

import (
	"testing"
	"time"
)

// #1724 (user 11-17): a workspace turn that only wrote text and handed nothing back is not the
// watch's progress; a turn that ran tools still is.
func TestWatchTextOnlyTurnEndIsNotProgress(t *testing.T) {
	e := NewEngine("lead", &stubAgent{}, []Platform{&stubPlatformEngine{n: "discord"}}, "", LangChinese)
	w := newHandoffWatch(e)
	h := TeamHandoff{Chat: "discord:1"}

	key := "discord:17240001"
	since := time.Now()
	end := beginTeamTurn(teamTurnFact{Chat: key, Session: key, Engine: "lead"})
	noteTeamTurnTextOnly(key)
	end()
	if got, err := w.workspaceProgress(key, h, since); err != nil || got != watchProgressNone {
		t.Fatalf("text-only turn end = %v, %v; want no progress", got, err)
	}

	end = beginTeamTurn(teamTurnFact{Chat: key, Session: key, Engine: "lead"})
	end()
	if got, err := w.workspaceProgress(key, h, since); err != nil || got != watchProgressReal {
		t.Fatalf("turn end after tools = %v, %v; want real progress", got, err)
	}
}
