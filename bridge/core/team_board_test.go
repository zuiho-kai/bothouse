package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
	live    map[string]bool   // session key → last board's state
	fail    bool
}

func (p *stubBoardPlatform) UpsertBoard(_ context.Context, sessionKey, messageID, content string, live bool) (string, error) {
	if p.fail {
		return "", errors.New("boom")
	}
	p.posts++
	if p.content == nil {
		p.content = map[string]string{}
		p.live = map[string]bool{}
	}
	p.content[sessionKey] = content
	p.live[sessionKey] = live
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
		"**大豆包**　↗️ 在<#222>忙：私密的活（", // busy elsewhere: that channel (a link) and its task (#613)
		"**Grok**　💤 空闲",             // a chat reply without tools is not work
		"**C酱**　✅ 做完：审 #139",        // per-user key of the same channel
	} {
		if !strings.Contains(got, want) {
			t.Errorf("board missing %q:\n%s", want, got)
		}
	}
	if strings.Contains(got, "随便聊聊") {
		t.Errorf("board shows a chat reply:\n%s", got)
	}
}

// Busy in another channel is listed but is not busy here: the line says it does not block work
// here, and neither the member lines nor the card state count it as live.
func TestTeamBoardBusyElsewhereNotBusyHere(t *testing.T) {
	now := time.Now()
	files := []teamFile{
		{Project: "b", Name: "大豆包", Updated: now, Sessions: []teamEntry{
			{Key: "discord:222", Chat: "外出", Task: "外出巡逻", Busy: true, Worked: true, Since: now},
		}},
		{Project: "e", Name: "小橙", Updated: now, Sessions: []teamEntry{
			{Key: "discord:333", Task: "私聊里的活", Busy: true, Worked: true, Since: now},
		}},
	}
	got, live := teamBoardMembers(files, "discord:111", nil)
	for _, want := range []string{
		"**大豆包**　↗️ 在<#222>忙：外出巡逻（",
		"**小橙**　↗️ 在<#333>忙：私聊里的活（",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("board missing %q:\n%s", want, got)
		}
	}
	if n := strings.Count(got, teamElsewhereNote); n != 2 {
		t.Errorf("want %q on both lines, got %d:\n%s", teamElsewhereNote, n, got)
	}
	if live {
		t.Errorf("busy only in other channels must not count as live here:\n%s", got)
	}
	if strings.Contains(got, "🔧") {
		t.Errorf("🔧 is for busy in this channel:\n%s", got)
	}

	// The same teammate busy in this channel too: that is busy here.
	files[0].Sessions = append(files[0].Sessions, teamEntry{Key: "discord:111", Chat: "general", Task: "修 bug", Busy: true, Worked: true, Since: now})
	got, live = teamBoardMembers(files, "discord:111", nil)
	if !strings.Contains(got, "**大豆包**　🔧 修 bug") || !live {
		t.Errorf("busy in this channel should be live 🔧 (live=%t):\n%s", live, got)
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
	allChatsAreWorkspaces(e)
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
	allChatsAreWorkspaces(e)
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

// #597 G36: a timer turn (ws-handoff wake-up) shows its job label on 谁在干啥, not the prompt the
// bridge sends the agent (v0.1.24 web check: 「✅ 做完：你是工作区频道里的主角色，从主频道接手…」).
func TestTeamNoteTurnTimerUsesJobLabel(t *testing.T) {
	e := newTestEngine()
	e.team = &teamState{dir: t.TempDir(), name: "C酱", seen: map[string]*teamSession{}}
	e.teamNoteTurn(&Message{SessionKey: "cloud_web:room-2", Content: "你是工作区频道里的主角色，从主频道接手一整块大活：写脚本。先读交接 /x.md",
		boardLabel: "⏰ " + boardJobDesc("工作区接手：写脚本", "你是工作区频道里的主角色…", "")}, nil)
	if got := e.team.seen["cloud_web:room-2"].task; got != "⏰ 工作区接手：写脚本" {
		t.Fatalf("task = %q", got)
	}
	e.teamNoteTurn(&Message{SessionKey: "discord:111", Content: "  跑\n测试 "}, nil)
	if got := e.team.seen["discord:111"].task; got != "跑 测试" {
		t.Fatalf("user turn task = %q", got)
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
	mu       sync.Mutex
	removed  []string
	failFor  string
	failErr  error
	attempts map[string]int
}

func (p *stubBoardRemover) RemoveBoard(_ context.Context, _, messageID string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.attempts == nil {
		p.attempts = map[string]int{}
	}
	p.attempts[messageID]++
	if messageID == p.failFor {
		if p.failErr != nil {
			return p.failErr
		}
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

// A board the platform reports as unremovable (archived thread, lost access) is
// tried once, logged once and dropped; a temporary failure keeps being retried.
func TestFormerLeadGivesUpUnremovableBoard(t *testing.T) {
	oldEvery := teamBoardRetireEvery
	oldTries := teamBoardRetireTries
	teamBoardRetireEvery = 5 * time.Millisecond
	teamBoardRetireTries = 3
	defer func() {
		teamBoardRetireEvery = oldEvery
		teamBoardRetireTries = oldTries
	}()

	for _, tc := range []struct {
		name     string
		failErr  error
		attempts int
		keep     bool
	}{
		{"unremovable dropped", fmt.Errorf("%w: thread archived", ErrBoardUnremovable), 1, false},
		{"temporary retried", errors.New("network"), 3, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := &stubBoardRemover{stubBoardPlatform: stubBoardPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}},
				failFor: "m2", failErr: tc.failErr}
			e := NewEngine("cjiang", &stubAgent{}, []Platform{p}, "", LangEnglish)
			dir := t.TempDir()
			e.SetTeam(dir, "C酱", false)
			state := filepath.Join(dir, "cjiang"+teamBoardFileExt)
			if err := os.WriteFile(state, []byte(`{"discord:111":{"session_key":"discord:111","message_id":"m1"},"discord:222":{"session_key":"discord:222","message_id":"m2"}}`), 0o644); err != nil {
				t.Fatal(err)
			}
			logs, restore := captureSlog(t)
			e.retireTeamBoards()
			restore()
			p.mu.Lock()
			got := p.attempts["m2"]
			p.mu.Unlock()
			if got != tc.attempts {
				t.Fatalf("delete attempts = %d, want %d", got, tc.attempts)
			}
			raw, err := os.ReadFile(state)
			if !tc.keep {
				if !os.IsNotExist(err) {
					t.Fatalf("state file kept: %s", raw)
				}
				if n := strings.Count(logs.String(), "giving up"); n != 1 {
					t.Fatalf("give-up logged %d times, want 1:\n%s", n, logs)
				}
				return
			}
			if err != nil || !strings.Contains(string(raw), "m2") {
				t.Fatalf("state = %s, %v; want the temporarily failed board kept", raw, err)
			}
		})
	}
}

// stubBoardEditFails fails every update of one chat's board with editErr.
type stubBoardEditFails struct {
	stubBoardPlatform
	mu      sync.Mutex
	failFor string
	editErr error
	tries   int
}

func (p *stubBoardEditFails) UpsertBoard(ctx context.Context, sessionKey, messageID, content string, live bool) (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if sessionKey == p.failFor {
		p.tries++
		return messageID, p.editErr
	}
	return p.stubBoardPlatform.UpsertBoard(ctx, sessionKey, messageID, content, live)
}

func (p *stubBoardEditFails) triesSoFar() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.tries
}

// A board the platform will no longer let us edit or post (archived thread) is
// tried once, logged once and left alone while the channel has no newer
// activity: no retries, and no new board that would bump the thread. Newer
// activity earns exactly one more try. A temporary failure keeps being retried.
func TestTeamBoardEditGivesUp(t *testing.T) {
	for _, tc := range []struct {
		name      string
		messageID string
		editErr   error
		tries     int
		gaveUp    bool
	}{
		{"edit unremovable given up", "m1", fmt.Errorf("discord: edit board: %w: 50083", ErrBoardUnremovable), 1, true},
		{"send unremovable given up", "", fmt.Errorf("discord: send board: %w: 50001", ErrBoardUnremovable), 1, true},
		{"temporary retried", "m1", errors.New("network"), 3, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := &stubBoardEditFails{stubBoardPlatform: stubBoardPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}},
				failFor: "discord:111", editErr: tc.editErr}
			e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
			allChatsAreWorkspaces(e)
			boards := map[string]*boardChat{"discord:111": {SessionKey: "discord:111", MessageID: tc.messageID, Content: "old"}}
			before := time.Now().Add(-time.Minute)
			logs, restore := captureSlog(t)
			changed := e.updateTeamBoards(boardFiles(before), boards)
			for i := 0; i < 2; i++ {
				e.updateTeamBoards(boardFiles(before), boards)
			}
			restore()
			if p.tries != tc.tries {
				t.Fatalf("update tries = %d, want %d", p.tries, tc.tries)
			}
			b := boards["discord:111"]
			if b == nil || b.MessageID != tc.messageID || b.Content != "old" {
				t.Fatalf("board = %+v, want the old message kept and no new board", b)
			}
			if p.content["discord:111"] != "" {
				t.Fatal("a new board was posted for the failing channel")
			}
			if gaveUp := !b.GaveUpAt.IsZero(); gaveUp != tc.gaveUp {
				t.Fatalf("gave up = %v, want %v", gaveUp, tc.gaveUp)
			}
			if !tc.gaveUp {
				if n := strings.Count(logs.String(), "team board: update failed"); n != tc.tries {
					t.Fatalf("update-failed logged %d times, want %d:\n%s", n, tc.tries, logs)
				}
				return
			}
			if !changed {
				t.Fatal("giving up must be persisted")
			}
			if n := strings.Count(logs.String(), "giving up until new activity"); n != 1 {
				t.Fatalf("give-up logged %d times, want 1:\n%s", n, logs)
			}
			if strings.Contains(logs.String(), "update failed") {
				t.Fatalf("given-up board kept failing:\n%s", logs)
			}
			out, _ := json.Marshal(boards)
			restored := map[string]*boardChat{}
			if err := json.Unmarshal(out, &restored); err != nil || !restored["discord:111"].GaveUpAt.Equal(b.GaveUpAt) {
				t.Fatalf("gave_up_at not persisted: %s, %v", out, err)
			}

			// Newer activity in the channel: exactly one more try, one more warning.
			newer := b.GaveUpAt.Add(time.Second)
			logs, restore = captureSlog(t)
			for i := 0; i < 3; i++ {
				e.updateTeamBoards(boardFiles(newer), boards)
			}
			restore()
			if p.tries != tc.tries+1 {
				t.Fatalf("tries after new activity = %d, want %d", p.tries, tc.tries+1)
			}
			if n := strings.Count(logs.String(), "giving up until new activity"); n != 1 {
				t.Fatalf("re-give-up logged %d times, want 1:\n%s", n, logs)
			}
			if b.GaveUpAt.Before(newer) {
				t.Fatalf("gave_up_at = %v, want refreshed after the retry", b.GaveUpAt)
			}
		})
	}
}

// After a restart the lead reads gave_up_at back from its state file: with no
// newer activity runTeamBoard leaves the board alone tick after tick; newer
// activity earns one try, and the new give-up time is saved again.
func TestTeamBoardGaveUpSurvivesRestart(t *testing.T) {
	old := teamBoardInterval
	teamBoardInterval = 5 * time.Millisecond
	defer func() { teamBoardInterval = old }()

	p := &stubBoardEditFails{stubBoardPlatform: stubBoardPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}},
		failFor: "discord:111", editErr: fmt.Errorf("discord: edit board: %w: 50083", ErrBoardUnremovable)}
	e := NewEngine("lead", &stubAgent{}, []Platform{p}, "", LangEnglish)
	allChatsAreWorkspaces(e)
	dir := t.TempDir()
	e.team = &teamState{dir: dir, board: true, inject: true}
	gaveUp := time.Now().Add(-time.Hour).UTC().Truncate(time.Second)
	statePath := filepath.Join(dir, "lead"+teamBoardFileExt)
	state := fmt.Sprintf(`{"discord:111":{"session_key":"discord:111","message_id":"m1","content":"old","gave_up_at":%q}}`, gaveUp.Format(time.RFC3339))
	if err := os.WriteFile(statePath, []byte(state), 0o600); err != nil {
		t.Fatal(err)
	}
	writeStatus := func(since time.Time) {
		t.Helper()
		raw, _ := json.Marshal(teamFile{Project: "a", Name: "G哥", Updated: time.Now(), Sessions: []teamEntry{
			{Key: "discord:111", Chat: "general", Task: "预解码原型", Busy: true, Worked: true, Since: since},
		}})
		if err := AtomicWriteFile(filepath.Join(dir, "a"+teamStatusFileExt), raw, 0o600); err != nil {
			t.Fatal(err)
		}
	}

	// updateTeamBoards on the read-back state: old activity is skipped.
	boards := map[string]*boardChat{}
	if err := json.Unmarshal([]byte(state), &boards); err != nil || !boards["discord:111"].GaveUpAt.Equal(gaveUp) {
		t.Fatalf("read back gave_up_at: %+v, %v", boards["discord:111"], err)
	}
	if e.updateTeamBoards([]teamFile{{Project: "a", Name: "G哥", Updated: time.Now(), Sessions: []teamEntry{
		{Key: "discord:111", Chat: "general", Task: "x", Busy: true, Worked: true, Since: gaveUp.Add(-time.Minute)},
	}}}, boards) || p.triesSoFar() != 0 {
		t.Fatalf("old activity retried a given-up board: tries=%d", p.triesSoFar())
	}

	writeStatus(gaveUp.Add(-time.Minute))
	logs, restore := captureSlog(t)
	done := make(chan struct{})
	go func() {
		e.runTeamBoard()
		close(done)
	}()
	stopped := false
	stop := func() {
		if !stopped {
			stopped = true
			e.cancel()
			<-done
			restore()
		}
	}
	defer stop()
	time.Sleep(100 * time.Millisecond) // many ticks
	if n := p.triesSoFar(); n != 0 {
		t.Fatalf("restart retried a given-up board with no new activity: tries=%d", n)
	}

	writeStatus(time.Now())
	deadline := time.Now().Add(2 * time.Second)
	for p.triesSoFar() == 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	time.Sleep(100 * time.Millisecond) // many more ticks
	stop()
	if n := p.triesSoFar(); n != 1 {
		t.Fatalf("tries after new activity = %d, want exactly 1", n)
	}
	if n := strings.Count(logs.String(), "giving up until new activity"); n != 1 {
		t.Fatalf("give-up logged %d times, want 1:\n%s", n, logs)
	}
	raw, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	saved := map[string]*boardChat{}
	if err := json.Unmarshal(raw, &saved); err != nil || saved["discord:111"] == nil || !saved["discord:111"].GaveUpAt.After(gaveUp) {
		t.Fatalf("state after retry = %s, %v; want a newer gave_up_at", raw, err)
	}
	if saved["discord:111"].MessageID != "m1" || saved["discord:111"].Content != "old" {
		t.Fatalf("state after retry = %s; want the old board kept", raw)
	}
}

// PR #377 review: board.py's old pinned cards are deleted on takeover, so a channel has one task
// board; a card that fails stays for the next try, the file goes once empty.
func TestRetireBoardPyCards(t *testing.T) {
	p := &stubBoardRemover{stubBoardPlatform: stubBoardPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}, failFor: "m2"}
	e := NewEngine("lead", &stubAgent{}, []Platform{p}, "", LangEnglish)
	dir := t.TempDir()
	path := filepath.Join(dir, boardPyCardsFile)
	if err := os.WriteFile(path, []byte(`{"111":"m1","222":"m2"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if e.retireBoardPyCards(dir) {
		t.Fatal("reported done with a card left")
	}
	raw, _ := os.ReadFile(path)
	if string(raw) != `{"222":"m2"}` {
		t.Fatalf("state = %s, want only the failed card", raw)
	}
	p.failFor = ""
	if !e.retireBoardPyCards(dir) {
		t.Fatal("not done after all removed")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("state file kept")
	}
	if strings.Join(p.removed, ",") != "m1,m2" {
		t.Fatalf("removed = %v", p.removed)
	}
	if !e.retireBoardPyCards(dir) { // no file: nothing to do
		t.Fatal("no file should be done")
	}
}

// allChatsAreWorkspaces: boards are only for workspace channels (isTeamWorkspaceChat); tests
// written before that rule treat every chat as a workspace.
func allChatsAreWorkspaces(e *Engine) { e.workspaceChatForTest = func(string) bool { return true } }
