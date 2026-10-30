package core

import (
	"fmt"
	"strings"
	"testing"
)

// Drive real engine turns, reset queuing, board files and parent forwarding;
// only the external agent transport and platform transport are substituted.
func TestWorkspaceMissingReportRecoversBeforeReset(t *testing.T) {
	for _, tc := range []struct {
		platform string
		handoff  bool
	}{{"discord", false}, {"cloud_web", false}, {"discord", true}} {
		platform := tc.platform
		for _, mode := range []string{"reset", "reset_waiting", "waiting", "done"} {
			t.Run(fmt.Sprintf("%s/handoff=%t/%s", platform, tc.handoff, mode), func(t *testing.T) {
				e, a, p := exitFixture(t, nil)
				p.n = platform
				key, parent := platform+":ws1", platform+":chat1"
				dir := t.TempDir()
				e.SetTeam(dir, "橘", false)
				teamWorkspaceStore.mu.Lock()
				err := saveTeamWorkspacesLocked(teamWorkspacePath(e.dataDir), &teamWorkspaceState{
					Parents: map[string][]TeamWorkspace{parent: {{ID: "ws1", Name: "工作区1"}}},
					Version: teamWorkspaceStateVersion,
				})
				teamWorkspaceStore.mu.Unlock()
				if err != nil {
					t.Fatal(err)
				}
				row := func(status, done string) string {
					if tc.handoff {
						return fmt.Sprintf("{\"id\":666,\"what\":\"deliver draft\",\"who\":\"工作区1橘\",\"ch\":\"chat1\",\"status\":%q,\"done_at\":%q}\n", status, done)
					}
					return fmt.Sprintf("{\"id\":666,\"what\":\"deliver draft\",\"who\":\"工作区1橘\",\"sk\":%q,\"status\":%q,\"done_at\":%q}\n", key, status, done)
				}
				writeTaskBoard(t, dir, teamTaskBoardFile, row("在做", ""))
				e.ReceiveMessage(p, &Message{SessionKey: key, Platform: platform, ChannelID: "ws1", UserID: "u", Content: "finish the draft", Mentioned: true, ReplyCtx: key})
				inputPrompt(t, a)
				old := e.sessions.ActiveSessionID(key)
				if strings.HasPrefix(mode, "reset") {
					if r, err := e.QueueSessionReset(key); err != nil || !r.Queued {
						t.Fatalf("reset not queued: %+v, %v", r, err)
					}
					if mode == "reset_waiting" {
						writeTaskBoard(t, dir, teamTaskBoardFile, row("等用户[看片]", ""))
					}
				} else if mode == "waiting" {
					writeTaskBoard(t, dir, teamTaskBoardFile, row("等用户[看片]", ""))
				} else {
					writeTaskBoard(t, dir, teamTaskBoardFile, "")
					writeTaskBoard(t, dir, teamTaskBoardDoneFile, row("在做", "10-27 19:52"))
				}
				inputDone(a, "NO_REPLY")
				prompt := inputPrompt(t, a)
				if !strings.Contains(prompt, "但没交 [report]") {
					t.Fatalf("missing recovery instruction: %s", prompt)
				}
				if got := e.sessions.ActiveSessionID(key); got != old {
					t.Fatalf("reset lost original context: %s -> %s", old, got)
				}
				if got := p.sentTo(parent); len(got) != 0 {
					t.Fatalf("unmarked reply was forwarded: %v", got)
				}
				inputDone(a, "[report] #666 背景：你让我做这件事。\nDraft delivered with verification evidence.\n要你做的：没有。")
				inputWait(t, func() bool { return len(p.sentTo(parent)) == 1 })
				t.Logf("recovery prompt received in retained session %s; parent %s received %q", old, parent, p.sentTo(parent)[0])
				if strings.HasPrefix(mode, "reset") {
					inputWait(t, func() bool { return e.sessions.ActiveSessionID(key) != old })
				} else {
					inputWait(t, func() bool { return !e.sessions.GetOrCreateActive(key).Busy() })
					if e.sessions.ActiveSessionID(key) != old {
						t.Fatal("board-only recovery reset a session without a reset request")
					}
				}
			})
		}
	}
}

func TestWorkspaceOldWaitingItemDoesNotWake(t *testing.T) {
	e, a, p := exitFixture(t, mapParent{"ws1": "chat1"})
	dir := t.TempDir()
	e.SetTeam(dir, "橘", false)
	writeTaskBoard(t, dir, teamTaskBoardFile, `{"id":666,"who":"橘","sk":"discord:ws1","status":"等用户[看片]"}`+"\n")
	e.beginWorkspaceReportTurn("discord:ws1")
	if e.finishWorkspaceReportTurn("discord:ws1", "NO_REPLY") {
		t.Fatal("old waiting item requested another report")
	}
	select {
	case prompt := <-a.session.prompts:
		t.Fatalf("unexpected recovery prompt: %s", prompt)
	default:
	}
	if len(p.sentTo("discord:chat1")) != 0 {
		t.Fatal("unexpected parent message")
	}
}

func TestWorkspaceReportLegacyHandoffOwnership(t *testing.T) {
	e, _, _ := exitFixture(t, nil)
	dir := t.TempDir()
	e.SetTeam(dir, "橘", false)
	teamWorkspaceStore.mu.Lock()
	err := saveTeamWorkspacesLocked(teamWorkspacePath(e.dataDir), &teamWorkspaceState{
		Parents: map[string][]TeamWorkspace{"discord:chat1": {{ID: "ws1", Name: "工作区1"}}},
		Version: teamWorkspaceStateVersion,
	})
	teamWorkspaceStore.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, fields string
		want         bool
	}{
		{"legacy handoff", `"ch":"chat1","who":"工作区1橘"`, true},
		{"other chat", `"ch":"chat2","who":"工作区1橘"`, false},
		{"other workspace", `"ch":"chat1","who":"工作区2橘"`, false},
		{"workspace name prefix", `"ch":"chat1","who":"工作区11橘"`, false},
		{"other role", `"ch":"chat1","who":"工作区1鲸鱼娘"`, false},
		{"parent role", `"ch":"chat1","who":"橘"`, false},
		{"explicit session wins", `"ch":"chat1","who":"工作区1橘","sk":"discord:ws2"`, false},
		{"explicit workspace wins", `"ch":"chat1","who":"工作区1橘","ws":"discord:ws2"`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			writeTaskBoard(t, dir, teamTaskBoardFile, fmt.Sprintf("{\"id\":677,\"status\":\"等用户[看片]\",%s}\n", tc.fields))
			_, got := e.workspaceReportBoard("discord:ws1")[677]
			if got != tc.want {
				t.Fatalf("workspace owns row = %t, want %t: %s", got, tc.want, tc.fields)
			}
		})
	}
}
