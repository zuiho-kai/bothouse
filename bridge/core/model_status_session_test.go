package core

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type statusModelSession struct {
	*controllableAgentSession
	model string
}

func (s *statusModelSession) GetModel() string { return s.model }

func TestConversationModelPersistsAfterNormalTurn(t *testing.T) {
	p := &stubPlatformEngine{n: "test"}
	storePath := filepath.Join(t.TempDir(), "sessions.json")
	a := &stubModelModeAgent{model: "role-default"}
	e := NewEngine("test", a, []Platform{p}, storePath, LangEnglish)
	t.Cleanup(func() { e.Stop() })
	const key = "test:user"
	session := e.sessions.GetOrCreateActive(key)
	runtime := &statusModelSession{newControllableSession("thread"), "observed-model"}
	state := &interactiveState{agentSession: runtime, platform: p, replyCtx: "ctx"}
	e.interactiveStates[key] = state

	runtime.events <- Event{Type: EventResult, Content: "reply", Done: true}
	e.processInteractiveEvents(state, session, e.sessions, key, "m1", time.Now(), nil, nil, nil)
	runtime.model = "changed-model"
	runtime.events <- Event{Type: EventResult, Content: "another reply", Done: true}
	e.processInteractiveEvents(state, session, e.sessions, key, "m2", time.Now(), nil, nil, nil)

	// /new retires the native ID, but the old conversation retains its model.
	session.SetAgentSessionID("", "")
	fresh := e.sessions.NewSession(key, "fresh")
	reloaded := NewEngine("test", a, nil, storePath, LangEnglish)
	t.Cleanup(func() { reloaded.Stop() })
	for _, tc := range []struct {
		id, want string
		active   bool
	}{
		{session.ID, "changed-model", false},
		{fresh.ID, "", true},
	} {
		saved := reloaded.sessions.FindByID(tc.id)
		if saved == nil {
			t.Fatalf("missing reloaded session %q", tc.id)
		}
		if got := reloaded.conversationModel(key, saved, tc.active); got != tc.want {
			t.Fatalf("reloaded session %s model = %q, want %q", tc.id, got, tc.want)
		}
	}
	if got := e.sessionModelFor(key); got != "" {
		t.Fatalf("observed model became a channel override: %q", got)
	}
}

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
