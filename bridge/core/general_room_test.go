package core

import (
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestCUJ_GeneralRoom_ProjectReplyStartsAddressedTeammate(t *testing.T) {
	dir := t.TempDir()
	room, err := NewGeneralRoom(dir)
	if err != nil {
		t.Fatal(err)
	}

	// A draft mentioning another project must not leave the turn. A long
	// final answer must be saved and routed whole, even across chunk limits.
	handoff := "@BothouseV2 Check the rollout. " + strings.Repeat("Detail. ", 600) + "Final detail."
	planner := &cujAgent{nextSessionEvents: []Event{
		{Type: EventText, Content: "@Observer Draft plan"},
		{Type: EventThinking, Content: "working"},
		{Type: EventResult, Content: handoff, Done: true},
	}}
	reviewer := &cujAgent{nextSessionEvents: []Event{{Type: EventResult, Content: "Rollout reviewed.", Done: true}}}
	observer := &cujAgent{}

	start := func(project string, agent *cujAgent) *Engine {
		t.Helper()
		engine := NewEngine(project, agent, []Platform{room.Platform(project, project)}, filepath.Join(dir, project+".json"), LangEnglish)
		t.Cleanup(func() {
			if err := engine.Stop(); err != nil {
				t.Error(err)
			}
		})
		if err := engine.Start(); err != nil {
			t.Fatal(err)
		}
		return engine
	}
	plannerEngine := start("Bothouse", planner)
	reviewerEngine := start("BothouseV2", reviewer)
	observerEngine := start("Observer", observer)
	otherKey := "discord:42"
	prior := reviewerEngine.sessions.NewSession(otherKey, "release")

	if err := room.PostUserMessage("owner", "Owner", "Release notes are ready."); err != nil {
		t.Fatal(err)
	}
	if err := room.PostUserMessage("owner", "Owner", "@Bothouse Ask for a rollout review."); err != nil {
		t.Fatal(err)
	}

	var history []GeneralMessage
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		history = room.History()
		if len(history) >= 4 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if len(history) != 4 {
		t.Fatalf("transcript has %d messages, want two user posts and two final replies", len(history))
	}
	note, user, request, reply := history[0], history[1], history[2], history[3]
	if note.Target != "" || user.Target != "Bothouse" || request.Target != "BothouseV2" || reply.Target != "" ||
		request.AuthorID != "Bothouse" || request.ReplyTo != user.ID || request.Text != handoff ||
		reply.AuthorID != "BothouseV2" || reply.ReplyTo != request.ID || reply.Text != "Rollout reviewed." {
		t.Fatalf("unexpected General transcript: %+v", history)
	}
	reviewer.mu.Lock()
	reviewerSessions := append([]*cujAgentSession(nil), reviewer.sessions...)
	reviewer.mu.Unlock()
	if len(reviewerSessions) != 1 {
		t.Fatalf("reviewer started %d backend sessions", len(reviewerSessions))
	}
	prompts := reviewerSessions[0].getSentPrompts()
	if len(prompts) != 1 || !strings.Contains(prompts[0], "Final detail.") ||
		!strings.Contains(prompts[0], "Project names in General: Bothouse, BothouseV2, Observer.") {
		t.Fatalf("reviewer received %d prompts, want one containing the handoff and room members", len(prompts))
	}
	if plannerEngine.sessions.ActiveSessionID(GeneralSessionKey) == "" ||
		reviewerEngine.sessions.ActiveSessionID(GeneralSessionKey) == "" ||
		observerEngine.sessions.ActiveSessionID(GeneralSessionKey) != "" ||
		reviewerEngine.sessions.ActiveSessionID(otherKey) != prior.ID {
		t.Fatal("General created or switched the wrong session")
	}

	reopened, err := NewGeneralRoom(dir)
	if err != nil {
		t.Fatal(err)
	}
	if got := reopened.History(); !reflect.DeepEqual(got, history) {
		t.Fatalf("reopened General transcript differs: loaded %d messages", len(got))
	}
	if err := reopened.PostUserMessage("owner", "Owner", "Another note after restart."); err != nil {
		t.Fatal(err)
	}
	if got := reopened.History(); len(got) != 5 || got[4].ID != "5" {
		t.Fatalf("General did not append after reopening: %+v", got)
	}
}
