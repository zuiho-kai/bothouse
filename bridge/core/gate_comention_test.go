package core

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// Issue #184 (user 2026-10-20「你这什么狗屎，你是怎么验收过的，这叫对齐么」): when a person @-s the lead
// and a sub together, the lead waits for the sub's answer @-ing it (#182). These are the ways that wait
// never ended or did not happen.

// gateRecorder is a gate that records every /decide request and answers action.
func gateRecorder(t *testing.T, action string) (*httptest.Server, func() []gateRequest) {
	t.Helper()
	var mu sync.Mutex
	var reqs []gateRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/context") {
			_, _ = w.Write([]byte(`{}`))
			return
		}
		var req gateRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		mu.Lock()
		reqs = append(reqs, req)
		mu.Unlock()
		_ = json.NewEncoder(w).Encode(gateResponse{Action: action})
	}))
	t.Cleanup(srv.Close)
	return srv, func() []gateRequest {
		mu.Lock()
		defer mu.Unlock()
		return append([]gateRequest(nil), reqs...)
	}
}

// A teammate's message reaches core as "【name】text" (discord holdBotMessage, rh/cloudweb.py on_new);
// a Discord burst of its posts is joined with blank lines, each part with its own prefix.
func TestIsBotErrorNotice_TeammatePrefix(t *testing.T) {
	for _, s := range []string{
		"【龙娘】❌ 错误: 启动 Agent 会话失败",
		"【龙娘】⚠️ 本轮有操作失败，以上回复不代表全部操作成功：x",
		"【龙娘】我先算一下\n\n【龙娘】❌ 错误: usage_limit_exceeded",
	} {
		if !isBotErrorNotice(s) {
			t.Errorf("%q should be an error notice", s)
		}
	}
	for _, s := range []string{
		"【龙娘】391",
		"【龙娘】对比如下：\n❌ 不支持\n✅ 支持", // a list in a normal answer, not a cc-connect error line
	} {
		if isBotErrorNotice(s) {
			t.Errorf("%q is not an error notice", s)
		}
	}
}

// The lead hears a teammate's error report as a turn of its own (the gate is asked with mentioned=true),
// so a sub that fails on a co-mention does not leave the lead waiting forever.
func TestApplyGate_TeammateErrorWakesLead(t *testing.T) {
	srv, reqs := gateRecorder(t, "context")
	e := newTestEngine()
	e.SetGate(srv.URL, 2000, "reply")
	e.team = &teamState{dir: t.TempDir(), name: "橘", inject: true, seen: map[string]*teamSession{}}
	m := &Message{SessionKey: "discord:c1", UserName: "龙娘", Content: "【龙娘】❌ 错误: 启动 Agent 会话失败", FromBot: true}
	e.gate.released[m] = true
	e.applyGate(nil, m, &Session{}, "k")
	got := reqs()
	if len(got) != 1 || !got[0].Mentioned || !got[0].FromBot {
		t.Fatalf("teammate error did not reach the gate as addressed to the lead: %+v", got)
	}
}

// An idle burst folds several messages into one. Each part keeps who it @-ed, and the merged reply
// context keeps "the lead dispatched this" from any part (core.InjectedReplyMerger).
func TestApplyGate_BurstKeepsEachMessage(t *testing.T) {
	srv, reqs := gateRecorder(t, "context")
	e := newTestEngine()
	e.SetGate(srv.URL, 2000, "reply")
	e.SetGateBurstWindow(60_000) // the test releases the burst itself
	p := &leadPlatform{}
	s := &Session{}
	first := &Message{SessionKey: "test:room-2", Content: "<@2> 写个 X", ReplyCtx: leadCtx{id: "1"}}
	second := &Message{SessionKey: "test:room-2", Content: "你盯一下", Mentioned: true, ReplyCtx: leadCtx{id: "2", lead: true}}
	e.applyGate(p, first, s, "k")
	e.applyGate(p, second, s, "k")

	g := e.gate
	g.mu.Lock()
	h := g.held["k"]
	if h == nil {
		g.mu.Unlock()
		t.Fatal("burst not held")
	}
	h.timer.Stop()
	delete(g.held, "k")
	g.released[h.msg] = true
	g.mu.Unlock()

	if rc, _ := h.msg.ReplyCtx.(leadCtx); !rc.lead {
		t.Errorf("merged reply ctx %+v lost the lead dispatch of the second message", h.msg.ReplyCtx)
	}
	e.applyGate(p, h.msg, s, "k")
	got := reqs()
	if len(got) != 1 {
		t.Fatalf("gate requests = %+v", got)
	}
	want := []gatePart{{Content: "<@2> 写个 X"}, {Content: "你盯一下", Mentioned: true}}
	if len(got[0].Parts) != len(want) || got[0].Parts[0] != want[0] || got[0].Parts[1] != want[1] {
		t.Fatalf("parts = %+v, want %+v", got[0].Parts, want)
	}
}

// A single message sends no parts: content and mentioned already say it.
func TestApplyGate_SingleMessageNoParts(t *testing.T) {
	srv, reqs := gateRecorder(t, "context")
	e := newTestEngine()
	e.SetGate(srv.URL, 2000, "reply")
	m := &Message{SessionKey: "test:room-2", Content: "@橘(你) <@2> 帮我算", Mentioned: true}
	e.gate.released[m] = true
	e.applyGate(nil, m, &Session{}, "k")
	if got := reqs(); len(got) != 1 || got[0].Parts != nil {
		t.Fatalf("gate requests = %+v", got)
	}
}

// The gate answers "context" for a co-mention: an image with it is buffered as a note, not forced
// into a turn the way a "silent" with attachments is (that rule stays for silent).
func TestApplyGate_ContextWithAttachmentStaysQuiet(t *testing.T) {
	srv, _ := gateRecorder(t, "context")
	e := newTestEngine()
	e.SetGate(srv.URL, 2000, "reply")
	m := &Message{SessionKey: "test:room-2", Content: "@橘(你) <@2> 看图", Mentioned: true, Images: []ImageAttachment{{MimeType: "image/png"}}}
	e.gate.released[m] = true
	if handled := e.applyGate(nil, m, &Session{}, "k"); !handled {
		t.Fatal("co-mention with an image started a turn")
	}
	if b := e.gate.buf["k"]; len(b) != 1 || !strings.Contains(b[0], "附了 1 个图片") {
		t.Fatalf("buffer = %q", b)
	}
}
