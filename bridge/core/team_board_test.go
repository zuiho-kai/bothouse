package core

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type stubBoardPlatform struct {
	stubPlatformEngine
	posts   int
	content map[string]string // session key → last board
	fail    bool
}

func (p *stubBoardPlatform) UpsertBoard(_ context.Context, sessionKey, messageID, content string) (string, error) {
	if p.fail {
		return "", errors.New("boom")
	}
	p.posts++
	if p.content == nil {
		p.content = map[string]string{}
	}
	p.content[sessionKey] = content
	if messageID == "" {
		messageID = "m-" + sessionKey
	}
	return messageID, nil
}

func boardFiles(now time.Time) []teamFile {
	return []teamFile{
		{Project: "a", Name: "G哥", Updated: now, Sessions: []teamEntry{
			{Key: "discord:111", Chat: "general", Task: "预解码原型", Busy: true, Worked: true, Since: now},
		}},
		{Project: "b", Name: "大豆包", Updated: now, Sessions: []teamEntry{
			{Key: "discord:222", Chat: "dev", Task: "私密的活", Busy: true, Worked: true, Since: now},
		}},
		{Project: "c", Name: "Grok", Updated: now, Sessions: []teamEntry{
			{Key: "discord:111", Chat: "general", Task: "随便聊聊", Busy: true, Since: now},
		}},
		{Project: "d", Name: "C酱", Updated: now, Sessions: []teamEntry{
			{Key: "discord:111:9", Chat: "general", Task: "审 #139", Worked: true, DoneAt: now},
		}},
	}
}

func TestRenderTeamBoard(t *testing.T) {
	now := time.Now()
	got := renderTeamBoard(boardFiles(now), "discord:111")
	for _, want := range []string{
		"**G哥**　🔧 预解码原型",
		"**大豆包**　🔧 在#dev忙",
		"**Grok**　💤 空闲",      // a chat reply without tools is not work
		"**C酱**　✅ 做完：审 #139", // per-user key of the same channel
	} {
		if !strings.Contains(got, want) {
			t.Errorf("board missing %q:\n%s", want, got)
		}
	}
	if strings.Contains(got, "私密的活") || strings.Contains(got, "随便聊聊") {
		t.Errorf("board leaked another channel's task or a chat reply:\n%s", got)
	}
}

func TestRenderTeamBoardStableOverTime(t *testing.T) {
	now := time.Now()
	files := boardFiles(now)
	a := renderTeamBoard(files, "discord:111")
	// Same states seen later must render identically, so the message is not re-edited every tick.
	for i := range files {
		files[i].Updated = now.Add(30 * time.Second)
	}
	if b := renderTeamBoard(files, "discord:111"); a != b {
		t.Fatalf("board changed without a state change:\n%s\n---\n%s", a, b)
	}
}

func TestUpdateTeamBoards(t *testing.T) {
	p := &stubBoardPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
	now := time.Now()
	boards := map[string]*boardChat{}

	if !e.updateTeamBoards(boardFiles(now), boards) {
		t.Fatal("first update should post boards")
	}
	// Work happened in #general (G哥, C酱) and #dev (大豆包); Grok's chat reply opens nothing.
	if len(boards) != 2 || boards["discord:111"] == nil || boards["discord:222"] == nil {
		t.Fatalf("boards = %v", boards)
	}
	if p.posts != 2 {
		t.Fatalf("posts = %d, want 2", p.posts)
	}

	if e.updateTeamBoards(boardFiles(now), boards) || p.posts != 2 {
		t.Fatal("unchanged state must not edit the boards")
	}

	// Everyone goes idle: boards stay and are edited to show it.
	idle := []teamFile{{Project: "a", Name: "G哥", Updated: now}}
	if !e.updateTeamBoards(idle, boards) || p.posts != 4 {
		t.Fatalf("idle update: posts = %d, want 4", p.posts)
	}
	if got := boards["discord:111"].Content; !strings.Contains(got, "💤 空闲") {
		t.Fatalf("idle board = %q", got)
	}
	if boards["discord:111"].MessageID != "m-discord:111" {
		t.Fatalf("board message id = %q", boards["discord:111"].MessageID)
	}
}

func TestUpdateTeamBoardsKeepsStateOnFailure(t *testing.T) {
	p := &stubBoardPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}, fail: true}
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
	boards := map[string]*boardChat{}
	if e.updateTeamBoards(boardFiles(time.Now()), boards) {
		t.Fatal("failed posts must not count as changes")
	}
	if b := boards["discord:111"]; b == nil || b.Content != "" {
		t.Fatal("a failed post should be retried next tick")
	}
}

func TestTeamNoteWorkResetsOnFreshTurn(t *testing.T) {
	e := newTestEngine()
	e.team = &teamState{dir: t.TempDir(), name: "C酱", seen: map[string]*teamSession{}}
	msg := &Message{SessionKey: "discord:111", Content: "跑测试"}
	e.teamNoteTurn(msg, nil)
	e.teamNoteWork("discord:111")
	if !e.team.seen["discord:111"].worked {
		t.Fatal("tool use should mark the turn as work")
	}
	e.teamNoteTurn(msg, &Session{})
	if e.team.seen["discord:111"].worked {
		t.Fatal("a fresh turn should start as not-yet-work")
	}
}

func TestBoardDisableStopsPublisher(t *testing.T) {
	for _, tc := range []struct {
		name     string
		on, lead bool
	}{{"disabled", false, true}, {"no longer lead", true, false}} {
		t.Run(tc.name, func(t *testing.T) {
			e := NewEngine("lead", &stubAgent{}, nil, "", LangEnglish)
			e.team = &teamState{dir: t.TempDir(), board: true, inject: tc.lead}
			done := make(chan struct{})
			go func() {
				e.runTeamBoard()
				close(done)
			}()
			defer func() { e.cancel(); <-done }()
			e.SetTeamBoard(tc.on)
			select {
			case <-done:
			case <-time.After(teamBoardInterval + 2*time.Second):
				t.Fatal("disabled/former lead still runs the board publisher")
			}
		})
	}
}

type stubBoardRemover struct {
	stubBoardPlatform
	mu      sync.Mutex
	removed []string
	failFor string
}

func (p *stubBoardRemover) RemoveBoard(_ context.Context, _, messageID string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if messageID == p.failFor {
		return errors.New("boom")
	}
	p.removed = append(p.removed, messageID)
	return nil
}

// A project that is no longer the lead deletes the boards it posted before.
func TestFormerLeadRemovesOldBoards(t *testing.T) {
	oldEvery := teamBoardRetireEvery
	oldTries := teamBoardRetireTries
	teamBoardRetireEvery = 5 * time.Millisecond
	teamBoardRetireTries = 2
	defer func() {
		teamBoardRetireEvery = oldEvery
		teamBoardRetireTries = oldTries
	}()

	for _, tc := range []struct {
		name    string
		failFor string
		keep    bool
	}{{"all removed", "", false}, {"failure kept for next start", "m2", true}} {
		t.Run(tc.name, func(t *testing.T) {
			p := &stubBoardRemover{stubBoardPlatform: stubBoardPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}, failFor: tc.failFor}
			e := NewEngine("cjiang", &stubAgent{}, []Platform{p}, "", LangEnglish)
			dir := t.TempDir()
			e.SetTeam(dir, "C酱", false) // no longer lead: no team_status_inject
			state := filepath.Join(dir, "cjiang"+teamBoardFileExt)
			if err := os.WriteFile(state, []byte(`{"discord:111":{"session_key":"discord:111","message_id":"m1"},"discord:222":{"session_key":"discord:222","message_id":"m2"}}`), 0o644); err != nil {
				t.Fatal(err)
			}
			// Wait for the bounded cleanup itself. A fixed sleep races with
			// os.WriteFile truncating the state file during the next retry.
			e.retireTeamBoards()
			raw, err := os.ReadFile(state)
			if !tc.keep {
				if !os.IsNotExist(err) {
					t.Fatalf("state file kept: %s", raw)
				}
				return
			}
			if err != nil || !strings.Contains(string(raw), "m2") || strings.Contains(string(raw), "m1") {
				t.Fatalf("state = %s, %v; want only the failed board kept", raw, err)
			}
			if p.posts != 0 {
				t.Fatal("former lead must not post boards")
			}
		})
	}
}
