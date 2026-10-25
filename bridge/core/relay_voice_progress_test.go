package core

import (
	"strings"
	"testing"
)

func voiceProgressFixture(t *testing.T, enable bool) (*RelayManager, *Engine, *voiceAgentFake) {
	t.Helper()
	a := &voiceAgentFake{sessions: make(chan *inputTestSession, 16)}
	p := newProgressPlatform()
	e := NewEngine("target", a, []Platform{p}, "", LangEnglish)
	e.SetDataDir(t.TempDir())
	if enable {
		if err := e.EnablePublicProgress(); err != nil {
			t.Fatal(err)
		}
	}
	rm := NewRelayManager("")
	rm.RegisterEngine("target", e)
	src := NewEngine("source", &stubAgent{}, []Platform{p}, "", LangEnglish)
	rm.RegisterEngine("source", src)
	t.Cleanup(func() { _ = e.Stop(); _ = src.Stop() })
	rm.Bind("discord", "voice", map[string]string{"source": "source", "target": "target"})
	return rm, e, a
}

func voiceProgressReq(id string) RelayRequest {
	return RelayRequest{Mode: "voice", RequestID: id, Scope: "desk", From: "source", To: "target", SessionKey: "discord:voice:thread-a", Message: "build a page"}
}

func TestVoiceRelay_SpokenTaskOpensCardOnVoiceChannel(t *testing.T) {
	rm, e, a := voiceProgressFixture(t, true)
	if _, _, err := rm.submitVoice(voiceProgressReq("card")); err != nil {
		t.Fatal(err)
	}
	s := <-a.sessions
	prompt := <-s.prompts
	if !strings.Contains(prompt, "--session 'discord:voice:thread-a'") || !strings.HasSuffix(prompt, "build a page") {
		t.Fatalf("voice prompt lacks card instructions: %q", prompt)
	}
	run := progressToken(t, prompt)
	id, err := e.publicProgress.Report(PublicProgressRequest{Project: "target", SessionKey: "discord:voice:thread-a", Run: run, Seq: 1, Kind: "start", Title: "page", Summary: "started"})
	if err != nil {
		t.Fatal(err)
	}
	s.events <- Event{Type: EventText, Content: "done"}
	s.events <- Event{Type: EventResult, Done: true}
	if r := voiceWait(t, rm, "card"); r.Status != "completed" {
		t.Fatalf("%+v", r)
	}
	r := e.publicProgress.pending[id]
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.record.Task.Origin != "voice" || r.record.Task.ChannelID != "discord:voice:thread-a" || r.record.Task.State != TaskStateResultReady || !r.record.Closed {
		t.Fatalf("card: %+v closed=%v", r.record.Task, r.record.Closed)
	}
	if _, err := e.publicProgress.Report(PublicProgressRequest{Project: "target", SessionKey: "discord:voice:thread-a", Run: run, Seq: 2, Kind: "update", Summary: "late"}); err == nil {
		t.Fatal("token outlived the voice turn")
	}
}

func TestVoiceRelay_NoCardWithoutPublicProgress(t *testing.T) {
	rm, _, a := voiceProgressFixture(t, false)
	if _, _, err := rm.submitVoice(voiceProgressReq("plain")); err != nil {
		t.Fatal(err)
	}
	s := <-a.sessions
	if prompt := <-s.prompts; strings.Contains(prompt, "[Public progress channel]") {
		t.Fatal("card instructions without public progress")
	}
	s.events <- Event{Type: EventResult, Content: "ok", Done: true}
	voiceWait(t, rm, "plain")
}
