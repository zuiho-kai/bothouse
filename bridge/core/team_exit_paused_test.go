package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A task the user stopped (board pause) sends nothing more to the chat channel: the turn that
// was already running when it was paused ends with an [ask] or [report], which stays in the
// workspace (user 2026-10-28 「我都说不做了，你还问我」). ws-up --ask's own pause
// (「等待用户答复」) and a task still in work forward as before.
func TestPausedTaskExitNotForwarded(t *testing.T) {
	for _, c := range []struct {
		name, item string
		forward    bool
	}{
		{"user stopped", `{"id": 4, "what": "守卫", "ws_was": "discord:ws1", "bound": "2026-10-28T05:05:47+00:00", "paused": "10-28 14:12", "pause_why": "用户叫停：先讨论不做"}`, false},
		{"stopped without reason", `{"id": 4, "what": "守卫", "ws_was": "discord:ws1", "bound": "2026-10-28T05:05:47+00:00", "paused": "10-28 14:12"}`, false},
		{"waiting on the user's answer", `{"id": 4, "what": "守卫", "ws_was": "discord:ws1", "bound": "2026-10-28T05:05:47+00:00", "paused": "10-28 14:12", "pause_why": "等待用户答复"}`, true},
		{"in work", `{"id": 4, "what": "守卫", "ws": "discord:ws1", "bound": "2026-10-28T05:05:47+00:00"}`, true},
		{"older stopped item, newer one in work", `{"id": 3, "what": "旧活", "ws_was": "discord:ws1", "bound": "2026-10-28T01:00:00+00:00", "paused": "10-28 10:12", "pause_why": "用户叫停"}` + "\n" +
			`{"id": 4, "what": "守卫", "ws": "discord:ws1", "bound": "2026-10-28T05:05:47+00:00"}`, true},
		{"another workspace's stopped item", `{"id": 4, "what": "守卫", "ws_was": "discord:ws2", "bound": "2026-10-28T05:05:47+00:00", "paused": "10-28 14:12", "pause_why": "用户叫停"}`, true},
	} {
		t.Run(c.name, func(t *testing.T) {
			e, _, p := exitFixture(t, mapParent{"ws1": "chat1"})
			dir := t.TempDir()
			e.SetTeam(dir, "橘", false)
			if err := os.WriteFile(filepath.Join(dir, teamTaskBoardFile), []byte(c.item+"\n"), 0o644); err != nil {
				t.Fatal(err)
			}
			e.forwardWorkspaceExit(p, exitWSKey, "[ask] #4 能不能开子任务\n自验：设计稿已写好\n类别：权限确认")
			e.forwardWorkspaceExit(p, exitWSKey, "[report] #4 已停手")
			// Each reply's first line is posted as a 📬 #4 headline (its details may follow it).
			got := 0
			for _, s := range p.sentTo("discord:chat1") {
				if strings.HasPrefix(s, "📬 #4「") {
					got++
				}
			}
			if c.forward && got != 2 {
				t.Fatalf("forwarded %d of 2: %+v", got, p.out)
			}
			if !c.forward && got != 0 {
				t.Fatalf("stopped task still forwarded: %+v", p.out)
			}
		})
	}
}
