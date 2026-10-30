package core

import (
	"context"
	"strings"
	"testing"
)

type statusModelSession struct {
	*controllableAgentSession
	model string
}

func (s *statusModelSession) GetModel() string { return s.model }

func TestCUJ_ModelStatusUsesChannelSession(t *testing.T) {
	agent := &stubStrictModelAgent{stubModelModeAgent: stubModelModeAgent{model: "project-default"}, models: []ModelOption{{Name: "channel-a"}, {Name: "channel-b"}}}
	p := &stubPlatformEngine{n: "cloud_web"}
	e := NewEngine("test", agent, []Platform{p}, "", LangEnglish)
	t.Cleanup(func() { e.Stop() })
	for _, key := range []string{"channel-a", "channel-b"} {
		e.interactiveStates[key] = &interactiveState{agentSession: &statusModelSession{newControllableSession(key), key}}
	}
	// Three channel queries must neither report the shared agent default nor leak across channels.
	for _, key := range []string{"channel-a", "channel-b", "channel-a"} {
		if got := e.ModelStatus(context.Background(), key).Model; got != key {
			t.Fatalf("%s model = %q", key, got)
		}
		p.clearSent()
		e.ReceiveMessage(p, &Message{SessionKey: key, Platform: p.Name(), UserID: "human", Content: "/model", Mentioned: true, ReplyCtx: "local"})
		want := e.i18n.Tf(MsgModelCurrent, key)
		inputWait(t, func() bool { return strings.Contains(strings.Join(p.getSent(), "\n"), want) })
		if text := e.renderModelCard(key).RenderText(); !strings.Contains(text, want) {
			t.Fatalf("model card: %s", text)
		}
	}
	if got := e.ModelStatus(context.Background(), "no-session").Model; got != "project-default" {
		t.Fatalf("configured fallback = %q", got)
	}
}

func TestModelStatusPreservesCatalogModelID(t *testing.T) {
	const model = `["provider","model"]`
	agent := &stubStrictModelAgent{stubModelModeAgent: stubModelModeAgent{model: model}, models: []ModelOption{{Name: model}}}
	e := NewEngine("test", agent, nil, "", LangEnglish)
	t.Cleanup(func() { e.Stop() })
	e.interactiveStates["active"] = &interactiveState{agentSession: &statusModelSession{newControllableSession("active"), model}}
	for _, key := range []string{"active", "no-session"} {
		if got := e.ModelStatus(context.Background(), key).Model; got != model {
			t.Fatalf("%s: model ID = %q, want catalog ID %q", key, got, model)
		}
		if text := e.renderModelCard(key).RenderText(); !strings.Contains(text, e.i18n.Tf(MsgModelCurrent, model)) {
			t.Fatalf("model card changed catalog ID: %s", text)
		}
	}
}
