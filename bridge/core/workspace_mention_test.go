package core

import (
	"strings"
	"testing"
)

// A peer can call either role in a workspace. Channel identity must not depend
// on its configured team position; a human decision goes through ws-up --ask.
func TestWorkspaceMentionInstructions863(t *testing.T) {
	dir := t.TempDir()
	writeSetupState(t, dir, wizardTwoRoles)
	p := &stubPlatformEngine{n: "discord"}
	for _, role := range []string{"lead", "sub"} {
		t.Run(role, func(t *testing.T) {
			e := wizardEngine(t, dir, role)
			e.workspaceChatForTest = func(key string) bool { return teamChatKey(key) == "discord:201" }
			prompt := e.withChannelAgentInstructions("队友点名：需要真人拍板", "200", true, p, "discord:201", nil, nil)
			for _, want := range []string{"[工作区规矩", "不 @ 真人", "ws-up", "--ask"} {
				if !strings.Contains(prompt, want) {
					t.Errorf("workspace %s missing %q", role, want)
				}
			}
			if strings.Contains(prompt, "[团队模式规矩") {
				t.Error("workspace received chat dispatch rules")
			}
			chat := e.withChannelAgentInstructions("需要真人拍板", "200", true, p, "discord:2", nil, nil)
			if !strings.Contains(chat, "[团队模式规矩") || strings.Contains(chat, "[工作区规矩") {
				t.Fatal("chat channel lost its ordinary instructions")
			}
		})
	}
}
