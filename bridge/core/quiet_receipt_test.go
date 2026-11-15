package core

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// QQ must not see the bridge's own receipts and job start notices (user 2026-11-05:
// groups got "↪ 已插入" and "⏰ newsdigest:<hash>" from a scheduled digest, then her private
// chat got "↪ 已插入" too). The insert acknowledgement is silent in both QQ chats; the ⏰ job
// start notice stays group-only; platforms without a quieter keep everything. The injected
// message and the real result still go out.

// privateReceiptPlatform is QQ as it now classifies receipts: quiet chats are groups, and the
// insert acknowledgement is silent everywhere.
type privateReceiptPlatform struct {
	stubPlatformEngine
}

func (p *privateReceiptPlatform) QuietSystemNotices(replyCtx any) bool { return replyCtx == "group" }
func (p *privateReceiptPlatform) QuietInsertReceipt(replyCtx any) bool { return true }

// quietCronPlatform answers proactive sends for both a QQ group and a private chat key.
type quietCronPlatform struct {
	quietGroupPlatform
}

func (p *quietCronPlatform) ReconstructReplyCtx(sessionKey string) (any, error) {
	if strings.Contains(sessionKey, ":g:") {
		return "group", nil
	}
	return "private", nil
}

// gateEngine returns an engine whose busy local key "k" folds mid-turn input into `running`.
func gateEngine(t *testing.T, p Platform, lang Language) (*Engine, *midTurnSession, *Session) {
	t.Helper()
	a := &midTurnAgent{workDirAgent: workDirAgent{resultAgent: resultAgent{session: newImgCaptureSession()}, dir: t.TempDir()}}
	a.can.Store(true)
	e := NewEngine("test", a, []Platform{p}, "", lang)
	t.Cleanup(func() { _ = e.Stop() })
	e.SetGate("", 0, "")
	e.SetGateLocal(true)
	running := &midTurnSession{imgCaptureSession: newImgCaptureSession()}
	e.interactiveMu.Lock()
	e.interactiveStates["k"] = &interactiveState{agentSession: running}
	e.interactiveMu.Unlock()
	s := e.sessions.GetOrCreateActive("qq:g:1")
	s.TryLock() // busy
	return e, running, s
}

func injectedText(t *testing.T, running *midTurnSession) string {
	t.Helper()
	running.mu.Lock()
	defer running.mu.Unlock()
	return strings.Join(running.mid, "\n")
}

func TestLocalGateInsertReceiptKeptOutOfQuietGroup(t *testing.T) {
	p := &quietGroupPlatform{stubPlatformEngine{n: "qq"}}
	e, running, s := gateEngine(t, p, LangChinese)
	msg := &Message{SessionKey: "qq:g:1", MessageID: "1", UserID: "u1", UserName: "u", Content: "补充一句", ReplyCtx: "group", GroupChat: true, Mentioned: true}
	if !e.applyGate(p, msg, s, "k") {
		t.Fatal("a busy group message that calls the bot is inserted")
	}
	if got := injectedText(t, running); !strings.Contains(got, "补充一句") {
		t.Fatalf("mid-turn input = %q, want the message", got)
	}
	if sent := p.getSent(); len(sent) != 0 {
		t.Fatalf("group got the insert receipt: %q", sent)
	}
}

func TestLocalGateInsertReceiptKeptOutOfPrivateChat(t *testing.T) {
	p := &privateReceiptPlatform{stubPlatformEngine{n: "qq"}}
	e, running, s := gateEngine(t, p, LangChinese)
	msg := &Message{SessionKey: "qq:g:1", MessageID: "1", UserID: "u1", UserName: "u", Content: "补充一句", ReplyCtx: "private", Direct: true, Mentioned: true}
	if !e.applyGate(p, msg, s, "k") {
		t.Fatal("a busy private message is inserted")
	}
	if got := injectedText(t, running); !strings.Contains(got, "补充一句") {
		t.Fatalf("mid-turn input = %q, want the message", got)
	}
	if sent := p.getSent(); len(sent) != 0 {
		t.Fatalf("private chat got the insert receipt: %q", sent)
	}
}

// The gate service's busy "reply" path also confirms the insertion with its own line.
func TestGateInsertReceiptKeptOutOfQuietGroup(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"action":"reply"}`)
	}))
	defer srv.Close()
	p := &quietGroupPlatform{stubPlatformEngine{n: "qq"}}
	e, running, s := gateEngine(t, p, LangChinese)
	e.SetGate(srv.URL+"/decide", 1000, "reply")
	msg := &Message{SessionKey: "qq:g:1", MessageID: "1", UserID: "u1", UserName: "u", Content: "补充一句", ReplyCtx: "group", GroupChat: true, Mentioned: true}
	e.gate.Load().mu.Lock()
	msg.burstDone = true // skip the burst window
	e.gate.Load().mu.Unlock()
	if !e.applyGate(p, msg, s, "k") {
		t.Fatal("a busy group message answered \"reply\" is inserted")
	}
	if got := injectedText(t, running); !strings.Contains(got, "补充一句") {
		t.Fatalf("mid-turn input = %q, want the message", got)
	}
	if sent := p.getSent(); len(sent) != 0 {
		t.Fatalf("group got the insert receipt: %q", sent)
	}
}

func TestCronStartNoticeKeptOutOfQuietGroup(t *testing.T) {
	run := func(sessionKey, body string) []string {
		t.Helper()
		p := &quietCronPlatform{quietGroupPlatform{stubPlatformEngine{n: "qq"}}}
		e := NewEngine("test", &resultAgent{session: newResultAgentSession(body)}, []Platform{p}, "", LangEnglish)
		t.Cleanup(func() { e.Stop() })
		store, err := NewCronStore(t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		e.cronScheduler = NewCronScheduler(store)
		job := &CronJob{ID: "digest", SessionKey: sessionKey, Prompt: "run digest", Description: "newsdigest:6f249ce2"}
		if err := e.ExecuteCronJob(job); err != nil {
			t.Fatal(err)
		}
		return p.getSent()
	}
	if sent := run("qq:g:1", "digest body"); len(sent) != 1 || sent[0] != "digest body" {
		t.Fatalf("group sent = %q, want only the digest body", sent)
	}
	sent := run("qq:1", "digest body")
	if len(sent) != 2 || sent[0] != "⏰ newsdigest:6f249ce2" || sent[1] != "digest body" {
		t.Fatalf("private sent = %q, want the start notice and the digest body", sent)
	}
}

func TestTimerStartNoticeKeptOutOfQuietGroup(t *testing.T) {
	run := func(sessionKey, body string) []string {
		t.Helper()
		p := &quietCronPlatform{quietGroupPlatform{stubPlatformEngine{n: "qq"}}}
		e := NewEngine("test", &resultAgent{session: newResultAgentSession(body)}, []Platform{p}, "", LangEnglish)
		t.Cleanup(func() { e.Stop() })
		job := &TimerJob{ID: "t", SessionKey: sessionKey, Prompt: "run timer", Description: "newsdigest:6f249ce2"}
		if err := e.ExecuteTimerJob(job); err != nil {
			t.Fatal(err)
		}
		return p.getSent()
	}
	if sent := run("qq:g:1", "timer body"); len(sent) != 1 || sent[0] != "timer body" {
		t.Fatalf("group sent = %q, want only the timer result", sent)
	}
	sent := run("qq:1", "timer body")
	if len(sent) != 2 || sent[0] != "⏰ newsdigest:6f249ce2" || sent[1] != "timer body" {
		t.Fatalf("private sent = %q, want the start notice and the timer result", sent)
	}
}
