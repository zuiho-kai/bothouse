package core

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type permissionFileFailure struct{ stubPlatformEngine }

func (p *permissionFileFailure) SendFile(context.Context, any, FileAttachment) error {
	return errors.New("upload unavailable")
}

func TestPermissionDetails_CompleteRawCommandAndScript(t *testing.T) {
	dir := t.TempDir()
	script := "#!/bin/sh\necho reviewed-script-body\n"
	if err := os.WriteFile(filepath.Join(dir, "review script.sh"), []byte(script), 0600); err != nil {
		t.Fatal(err)
	}
	command := "sh \"review script.sh\" " + strings.Repeat("argument ", 500) + "COMMAND-END"
	event := Event{ToolName: "Bash", RequestID: "one", ToolInput: "short summary", ToolInputRaw: map[string]any{"command": command, "cwd": dir}}
	details := permissionRequestDetails(event, "")
	encoded, _ := json.Marshal(command)
	if !strings.Contains(details, string(encoded)) || !strings.Contains(details, "reviewed-script-body") || !strings.Contains(details, "SHA256:") {
		t.Fatal("full raw command or script snapshot missing")
	}

	p := &stubMediaPlatform{}
	e := newTestEngine()
	e.display.ToolMaxLen = 4
	e.sendEventPermissionPrompt(p, nil, &pendingPermission{ApprovalID: "one"}, event, dir)
	if len(p.files) != 1 || !strings.Contains(string(p.files[0].Data), "COMMAND-END") || !strings.Contains(string(p.files[0].Data), script) {
		t.Fatal("missing full attachment")
	}
	if !strings.Contains(strings.Join(p.getSent(), "\n"), e.i18n.T(MsgPermissionDetails)) {
		t.Fatal("attachment not discoverable from prompt")
	}
}

func TestPermissionDetails_AttachmentFallbackPreservesTail(t *testing.T) {
	for _, p := range []Platform{&stubPlatformEngine{}, &permissionFileFailure{}} {
		e := newTestEngine()
		input := strings.Repeat("x", 9000) + "FINAL-COMMAND"
		e.sendEventPermissionPrompt(p, nil, &pendingPermission{ApprovalID: "one"}, Event{ToolName: "Bash", ToolInput: input}, "")
		var sent []string
		switch v := p.(type) {
		case *stubPlatformEngine:
			sent = v.getSent()
		case *permissionFileFailure:
			sent = v.getSent()
		}
		if !strings.Contains(strings.Join(sent, "\n"), "FINAL-COMMAND") {
			t.Fatal("fallback lost full command")
		}
	}
}

func TestPermissionDetails_ScriptSnapshotsBoundedAndMissing(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "large.py"), []byte(strings.Repeat("x", 12000)), 0600)
	details := permissionRequestDetails(Event{ToolInput: "python3 large.py; bash missing.sh", ToolInputRaw: map[string]any{"cwd": dir}}, "")
	if !strings.Contains(details, "first 8192 bytes") || !strings.Contains(details, "Unavailable:") || len(details) > 10000 {
		t.Fatal("missing bounded summary or missing-file explanation")
	}
	if got := permissionScriptPaths("python3 -c 'print(1)' && python3 -m module"); len(got) != 0 {
		t.Fatalf("inline program treated as script: %v", got)
	}
}

func TestPermissionDetails_ACPRawCommand(t *testing.T) {
	raw := map[string]any{"toolCall": map[string]any{"rawInput": map[string]any{"command": "bash script.sh"}}}
	if permissionCommand(raw) != "bash script.sh" {
		t.Fatal("ACP raw command missing")
	}
}

func TestCUJ_Permission3_LongCommandRemainsReviewable(t *testing.T) {
	p := &delegatedTestPlatform{stubPlatformEngine: stubPlatformEngine{n: "test"}}
	a := &cujAgent{}
	command := strings.Repeat("long-argument ", 500) + "COMMAND-TAIL"
	a.setNextSessionEvents([]Event{{Type: EventPermissionRequest, RequestID: "long", ToolName: "Bash", ToolInput: command}, {Type: EventResult, Content: "review finished", Done: true}}, 0)
	e := NewEngine("test", a, []Platform{p}, t.TempDir()+"/sessions.json", LangEnglish)
	e.display.ToolMaxLen = 10
	t.Cleanup(func() { e.Stop() })
	send := func(id, text string) {
		e.ReceiveMessage(p, &Message{SessionKey: "test:channel", Platform: "test", UserID: "human", MessageID: id, Content: text, Mentioned: true})
	}
	send("request", "run a command")
	inputWait(t, func() bool { return strings.Contains(strings.Join(p.getSent(), "\n"), "/permit ") })
	if !strings.Contains(strings.Join(p.getSent(), "\n"), "COMMAND-TAIL") {
		t.Fatal("approval lost command tail")
	}
	send("decision", "deny")
	inputWait(t, func() bool { return strings.Contains(strings.Join(p.getSent(), "\n"), "review finished") })
	send("next", "next request")
	inputWait(t, func() bool { return strings.Contains(strings.Join(p.getSent(), "\n"), "ok") })
}
