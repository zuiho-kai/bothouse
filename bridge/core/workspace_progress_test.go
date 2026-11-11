package core

import (
	"fmt"
	"strings"
	"testing"
)

// A timer's end is not the handoff's end. Exercise the real timer/engine path,
// board and session lifecycle; only the agent and platform transports are fake.
func TestWorkspaceTimerProgressKeepsTaskAndSession(t *testing.T) {
	for _, platform := range []string{"discord", "feishu", "cloud_web", "qq"} {
		t.Run(platform, func(t *testing.T) {
			e, a, p := exitFixture(t, nil)
			p.n = platform
			e.SetTeam(t.TempDir(), "橘", true)
			e.markPlatformReady(p)
			key, parent := platform+":ws1", platform+":chat1"
			if err := e.ClaimTeamWorkspaceFor(parent, "ws1", "工作区1", "", "verify live messages"); err != nil {
				t.Fatal(err)
			}
			row := fmt.Sprintf("{\"id\":1131,\"what\":\"verify live messages\",\"who\":\"工作区1橘\",\"ws\":%q,\"chat\":%q,\"status\":\"已部署，待真实样本验收\"}\n", key, parent)
			writeTaskBoard(t, e.team.dir, teamTaskBoardFile, row)
			old := e.sessions.GetOrCreateActive(key).ID

			for i, reply := range []string{
				"版本和哈希一致，仍缺真人样本；十分钟后回查，不结项。",
				"还没完成验收，不能提交 [report]；继续等真实消息。",
				"NO_REPLY",
			} {
				done := make(chan error, 1)
				go func() {
					done <- e.ExecuteTimerJob(&TimerJob{
						ID: fmt.Sprintf("progress-%d", i), SessionKey: key,
						Prompt: "回查部署后的真实消息；没有样本则继续等待，不结项。",
					})
				}()
				inputPrompt(t, a)
				inputDone(a, reply)
				if err := <-done; err != nil {
					t.Fatal(err)
				}
				inputWait(t, func() bool {
					e.pendingResetMu.Lock()
					defer e.pendingResetMu.Unlock()
					return e.resetTurns[key] == 0
				})
				if got := p.sentTo(parent); len(got) != 0 {
					t.Fatalf("progress posted as delivery: %v", got)
				}
				if e.exitBounceCount(key) != 0 {
					t.Fatalf("progress requested a report repair: %v", p.sentTo(key))
				}
				// The process may end with the turn (#702); the conversation and its agent
				// session ID must stay for the next turn to resume.
				if e.sessions.ActiveSessionID(key) != old || e.sessions.GetOrCreateActive(key).GetAgentSessionID() != "t1" {
					t.Fatal("progress cleared the conversation")
				}
				if !e.workspaceHasOpenHandoff(key) {
					t.Fatal("progress ended the handoff")
				}
				if it := e.boardItemByID(1131); it == nil || it.WS != key || it.DoneAt != "" || !it.ReturnedAt.IsZero() {
					t.Fatalf("progress closed or released the board item: %+v", it)
				}
				for _, sent := range p.sentTo(key) {
					if strings.Contains(sent, "第一行没写") || strings.Contains(sent, "但没交 [report]") {
						t.Fatalf("progress was bounced: %s", sent)
					}
				}
			}
		})
	}
}
