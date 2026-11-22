package core

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// #1866 用户「能不能统一控制面，不要散落」: `bothouse send` is the only door a role's script
// needs — every kind of post (text, audio) goes through the outbox, and nothing else gates it.
func newSendGateServer(t *testing.T, outbox *proactiveOutbox, on, minGap bool) (*APIServer, *audioStubPlatform) {
	t.Helper()
	p := &audioStubPlatform{stubPlatformEngine: stubPlatformEngine{n: "test"}}
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
	t.Cleanup(func() { _ = e.Stop() })
	e.interactiveStates["test:dm"] = &interactiveState{platform: p, replyCtx: "reply-ctx"}
	if outbox != nil {
		e.proactive = outbox
	}
	e.SetProactiveOutbox(on, minGap)
	return &APIServer{engines: map[string]*Engine{"test": e}}, p
}

func doSend(t *testing.T, api *APIServer, reqBody SendRequest) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(reqBody)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	rec := httptest.NewRecorder()
	api.handleSend(rec, httptest.NewRequest(http.MethodPost, "/send", bytes.NewReader(body)))
	return rec
}

// With the control off (the default) two sends from a scheduled turn right after each other go
// through: no script and no door stops them.
func TestHandleSendControlOffLetsConsecutiveSendsThrough(t *testing.T) {
	clk := &outboxClock{t: time.Date(2026, 11, 22, 9, 0, 0, 0, time.Local)}
	o := newTestOutbox(clk)
	api, _ := newSendGateServer(t, o, false, true)
	for i, msg := range []string{"第一条", "第二条"} {
		rec := doSend(t, api, SendRequest{Project: "test", SessionKey: "test:dm", FromSession: "test:turn", Message: msg})
		if rec.Code != http.StatusOK {
			t.Fatalf("send %d with the control off: status %d body=%s", i, rec.Code, rec.Body.String())
		}
	}
}

// With the control on and min gap on, a scheduled turn's second post into the same chat waits for
// an answer — and a voice message sent with --audio is held exactly like text (it used to slip by).
func TestHandleSendControlOnHoldsSecondPostIncludingAudio(t *testing.T) {
	clk := &outboxClock{t: time.Date(2026, 11, 22, 9, 0, 0, 0, time.Local)}
	o := newTestOutbox(clk)
	chat := proactiveChat("test:dm")
	o.caps[chat] = &tokenBucket{tokens: 1e9, maxTokens: 1e9, lastRefill: clk.t}
	api, p := newSendGateServer(t, o, true, true)
	o.freq["hourly"] = true // what admit sets for an hourly job
	end := o.startRun([]string{"hourly"}, "test:turn")
	defer end()

	if rec := doSend(t, api, SendRequest{Project: "test", SessionKey: "test:dm", FromSession: "test:turn", Message: "想你了"}); rec.Code != http.StatusOK {
		t.Fatalf("first send: status %d body=%s", rec.Code, rec.Body.String())
	}
	rec := doSend(t, api, SendRequest{Project: "test", SessionKey: "test:dm", FromSession: "test:turn",
		Audios: []FileAttachment{{FileName: "voice.wav", MimeType: "audio/wav", Data: []byte("RIFF")}}})
	if rec.Code != http.StatusTooManyRequests || !strings.Contains(rec.Body.String(), "两小时内") {
		t.Fatalf("second post (audio) was not held by the min gap: status %d body=%s", rec.Code, rec.Body.String())
	}
	if _, _, calls := p.audioSnapshot(); calls != 0 {
		t.Fatalf("held audio still reached the platform (%d calls)", calls)
	}

	o.answered(chat)
	clk.add(time.Minute)
	if rec := doSend(t, api, SendRequest{Project: "test", SessionKey: "test:dm", FromSession: "test:turn",
		Audios: []FileAttachment{{FileName: "voice.wav", MimeType: "audio/wav", Data: []byte("RIFF")}}}); rec.Code != http.StatusOK {
		t.Fatalf("after an answer the post should go: status %d body=%s", rec.Code, rec.Body.String())
	}
	if _, format, calls := p.audioSnapshot(); calls != 1 || format != "wav" {
		t.Fatalf("audio send = %d calls, format %q", calls, format)
	}
}
