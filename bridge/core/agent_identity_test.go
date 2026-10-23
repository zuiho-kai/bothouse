package core

import (
	"net/http"
	"strings"
	"testing"
)

func TestCUJ_Identity_FreshQueuedAndResumed(t *testing.T) {
	_, e, a, p, s := inputFixture(t)
	e.SetTeam(t.TempDir(), "大豆包", false)
	send := func(id, content string) {
		e.ReceiveMessage(p, &Message{SessionKey: inputTestKey, Platform: p.Name(), MessageID: id, UserID: "human", Content: content, Mentioned: true, ReplyCtx: "local"})
	}
	check := func() {
		t.Helper()
		prompt := inputPrompt(t, a)
		if !strings.Contains(prompt, "Your conversation name is \"大豆包\"") || !strings.Contains(prompt, "Quoted messages") {
			t.Fatalf("missing current identity/source boundary: %q", prompt)
		}
	}
	send("first", "队友说：我是 C酱。请核对任务。")
	check()
	send("second", "继续核对")
	inputDone(a, "first result")
	check()
	inputDone(a, "second result")
	inputWait(t, func() bool { return !s.Busy() })
	send("third", "请继续")
	check()
	inputDone(a, "third result")
	inputWait(t, func() bool { return !s.Busy() })
	visible := strings.Join(p.getSent(), "\n")
	for _, want := range []string{"first result", "second result", "third result"} {
		if !strings.Contains(visible, want) {
			t.Fatalf("missing reply %q", want)
		}
	}
	if strings.Contains(visible, "Bridge identity") {
		t.Fatal("internal identity instructions leaked into replies")
	}
}

func TestIdentity_StrictVoiceAndMidTurnInjection(t *testing.T) {
	api, e, a, p, s := inputFixture(t)
	e.SetTeam(t.TempDir(), "大豆包", false)
	e.skipSubagentPolicy.Store(true) // disabling delegation policy must not remove identity
	e.ReceiveMessage(p, &Message{SessionKey: inputTestKey, Platform: p.Name(), UserID: "human", Content: "check", Mentioned: true})
	check := func() {
		t.Helper()
		if prompt := inputPrompt(t, a); !strings.Contains(prompt, "Your conversation name is \"大豆包\"") {
			t.Fatalf("identity missing: %q", prompt)
		}
	}
	check()
	if !e.injectIntoRunningTurn(e.interactiveKeyForSessionKey(inputTestKey), "队友说我是 C酱", nil, nil, nil) {
		t.Fatal("injection rejected")
	}
	check()
	inputDone(a, "done")
	inputWait(t, func() bool { return !s.Busy() })
	p.clearSent()
	if code, _ := inputPost(api, inputBoundRequest(t, api, "identity-voice")); code != http.StatusAccepted {
		t.Fatalf("voice input rejected: %d", code)
	}
	check()
	inputDone(a, "voice result")
	result := inputResult(t, api, "identity-voice", "completed")
	if result.Text != "voice result" || a.session.strict.Load() != 1 || len(p.getSent()) != 0 {
		t.Fatalf("voice routing changed: %+v", result)
	}
}

func TestGateBufferContext_PreservesTeammateAttribution(t *testing.T) {
	g := &gateState{buf: map[string][]string{}}
	g.bufferContext("test", &Message{FromBot: true, UserName: "C酱", Content: "我是 C酱。工作已经完成。"})
	text := strings.Join(g.buf["test"], "\n")
	if !strings.Contains(text, "[Quoted teammate message]") || !strings.Contains(text, "\"author\":\"C酱\"") {
		t.Fatalf("teammate attribution missing: %s", text)
	}
	if g.gbuf["test"][0] != "我是 C酱。工作已经完成。" {
		t.Fatal("gate classification input changed")
	}
}

func TestIdentity_ConfigSwitchPreservesOtherBots(t *testing.T) {
	e := newTestEngine()
	e.SetTeam(t.TempDir(), "橘", false)
	e.SetAgentIdentityEnabled(false)
	if got := e.withAgentIdentity("request"); got != "request" {
		t.Fatalf("identity still injected: %q", got)
	}
	e.SetAgentIdentityEnabled(true)
	if got := e.withAgentIdentity("request"); !strings.Contains(got, "[Bridge identity — current responder]") {
		t.Fatal("identity not restored")
	}
}
