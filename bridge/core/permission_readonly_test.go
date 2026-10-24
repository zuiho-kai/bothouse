package core

import (
	"strings"
	"testing"
)

func TestReadOnlyPermission_ConservativeCommands(t *testing.T) {
	for _, command := range []string{"ls -la /tmp", "cat README.md", "grep -n word README.md", "rg -n word .", "pwd", "head -20 README.md", "tail -20 README.md", "wc -l README.md"} {
		if !readOnlyPermission(Event{ToolName: "Bash", ToolInputRaw: map[string]any{"command": command}}) {
			t.Errorf("read rejected: %q", command)
		}
	}
	for _, command := range []string{"ls; rm x", "cat x > y", "ls $(touch x)", "ls `touch x`", "ls\ntouch x", "python script.py", "bash script.sh", "find . -exec rm {} ;", "rg --pre=sh word", "rg -nz word", "rg --search-zip word", "/tmp/ls", "X=y ls", "ls | sh", "cat <(touch x)", "cat 'x'"} {
		if readOnlyPermission(Event{ToolName: "Bash", ToolInputRaw: map[string]any{"command": command}}) {
			t.Errorf("unsafe command accepted: %q", command)
		}
	}
	if readOnlyPermission(Event{ToolName: "Bash", ToolInput: "ls", ToolInputRaw: map[string]any{"command": "rm x"}}) {
		t.Fatal("trusted summary instead of raw input")
	}
	if readOnlyPermission(Event{ToolName: "Read", ToolInputRaw: map[string]any{"toolCall": map[string]any{"kind": "execute"}}}) {
		t.Fatal("trusted ACP display title")
	}
}

func TestReadOnlyPermission_FailureAndUnconfiguredKeepReview(t *testing.T) {
	e := newTestEngine()
	event := Event{ToolName: "Read", ToolInputRaw: map[string]any{"file_path": "README.md"}}
	if e.tryApproveReadOnly(&stubPlatformEngine{}, &recordingAgentSession{}, event) {
		t.Fatal("unconfigured scope auto-approved")
	}
	s := &delegatedFailSession{}
	if e.tryApproveReadOnly(&delegatedTestPlatform{}, s, event) || s.calls != 1 {
		t.Fatal("failure swallowed")
	}
	event.Questions = []UserQuestion{{Question: "Choose?"}}
	if e.tryApproveReadOnly(&delegatedTestPlatform{}, &recordingAgentSession{}, event) {
		t.Fatal("question auto-approved")
	}
}

func TestCUJ_Permission2_ReadsQuietWritesStillReviewed(t *testing.T) {
	p := &delegatedTestPlatform{stubPlatformEngine: stubPlatformEngine{n: "test"}}
	a := &cujAgent{}
	e := NewEngine("test", a, []Platform{p}, t.TempDir()+"/sessions.json", LangEnglish)
	t.Cleanup(func() { e.Stop() })
	send := func(id, text string) {
		e.ReceiveMessage(p, &Message{SessionKey: "test:channel", Platform: "test", MessageID: id, UserID: "human", Content: text, Mentioned: true})
	}
	for _, id := range []string{"read-one", "read-two"} {
		events := []Event{{Type: EventPermissionRequest, RequestID: id, ToolName: "Bash", ToolInput: "cat README.md", ToolInputRaw: map[string]any{"command": "cat README.md"}}, {Type: EventResult, Content: id + " finished", Done: true}}
		a.mu.Lock()
		if len(a.sessions) == 0 {
			a.nextSessionEvents = events
		} else {
			a.sessions[0].mu.Lock()
			a.sessions[0].pendingEvents = events
			a.sessions[0].mu.Unlock()
		}
		a.mu.Unlock()
		send(id, "read a file")
		inputWait(t, func() bool { return strings.Contains(strings.Join(p.getSent(), "\n"), id+" finished") })
		inputWait(t, func() bool { return !e.sessions.GetOrCreateActive("test:channel").Busy() })
	}
	if strings.Contains(strings.Join(p.getSent(), "\n"), "/permit ") {
		t.Fatal("read emitted approval noise")
	}
	a.mu.Lock()
	a.sessions[0].mu.Lock()
	a.sessions[0].pendingEvents = []Event{{Type: EventPermissionRequest, RequestID: "write", ToolName: "Bash", ToolInput: "touch output", ToolInputRaw: map[string]any{"command": "touch output"}}, {Type: EventResult, Content: "write handled", Done: true}}
	a.sessions[0].mu.Unlock()
	a.mu.Unlock()
	send("write", "create a file")
	inputWait(t, func() bool { return strings.Contains(strings.Join(p.getSent(), "\n"), "/permit ") })
	if strings.Contains(strings.Join(p.getSent(), "\n"), "write handled") {
		t.Fatal("write bypassed approval")
	}
	send("deny", "deny")
	inputWait(t, func() bool { return strings.Contains(strings.Join(p.getSent(), "\n"), "write handled") })
}
