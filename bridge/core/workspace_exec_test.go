package core

import "testing"

func TestWorkspaceExecSettings(t *testing.T) {
	e := &Engine{}
	e.workspaceChatForTest = func(s string) bool { return s == "discord:ws" }
	e.SetWorkspaceExec("local-qwen", "qwen-27b")
	// #1448: a workspace with no handoff to read is routed direct (lead model)
	if got := e.sessionSettingsFor("discord:ws"); got.Provider != "" || got.Model != "" {
		t.Fatalf("unrouted workspace must stay on the lead model: %+v", got)
	}
	if got := e.sessionSettingsFor("discord:chat"); got.Provider != "" || got.Model != "" {
		t.Fatalf("chat channel must keep lead model: %+v", got)
	}
	if err := e.saveSessionSelection("discord:ws", "claude-fable-5-2", ""); err != nil {
		t.Fatal(err)
	}
	if got := e.sessionSettingsFor("discord:ws"); got.Provider != "" || got.Model != "claude-fable-5-2" {
		t.Fatalf("hand-picked model must win: %+v", got)
	}
	e.SetWorkspaceExec("", "")
	if got := e.sessionSettingsFor("discord:ws2"); got.Provider != "" {
		t.Fatalf("off: %+v", got)
	}
}
