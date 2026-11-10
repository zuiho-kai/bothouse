package core

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
)

// QQ has no ChannelHistoryReader: inspect the actual AgentSession.Send input,
// rather than treating a platform send or a bridge history entry as delivery.
func TestExternalSendContext_NextTurn(t *testing.T) {
	for _, heartbeat := range []bool{false, true} {
		name := "user"
		if heartbeat {
			name = "heartbeat"
		}
		t.Run(name, func(t *testing.T) {
			p := &stubProactiveSendPlatform{stubMediaPlatform: stubMediaPlatform{stubPlatformEngine: stubPlatformEngine{n: "qq"}}}
			as := &capacityScriptSession{events: make(chan Event, 1)}
			e := NewEngine("fish", &resultAgent{session: as}, []Platform{p}, "", LangEnglish)
			t.Cleanup(func() { _ = e.Stop() })
			const key = "qq:p:616"
			const text = "outbound-context-616: 今天推荐水煮鱼"
			if err := e.SendToSession(key, text); err != nil {
				t.Fatal(err)
			}
			if heartbeat {
				if err := e.ExecuteHeartbeat(key, "刚才推荐的是什么？", true); err != nil {
					t.Fatal(err)
				}
			} else {
				e.ReceiveMessage(p, &Message{SessionKey: key, Platform: "qq", UserID: "616", UserName: "user", Content: "刚才推荐的是什么？", ReplyCtx: "ctx"})
			}
			waitFor(t, "next model input", func() bool { return as.sends() == 1 })
			prompts := as.sentPrompts()
			if len(prompts) != 1 || !strings.Contains(prompts[0], text) {
				t.Fatal("successful external send absent from next model input")
			}
		})
	}
}

// Each conversation must own its event stream, just as real CLI sessions do.
type outboundAgent struct {
	stubAgent
	mu       sync.Mutex
	sessions []*capacityScriptSession
	script   []string
}

func (a *outboundAgent) StartSession(context.Context, string) (AgentSession, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	s := &capacityScriptSession{events: make(chan Event, 1), script: append([]string(nil), a.script...)}
	a.sessions = append(a.sessions, s)
	return s, nil
}

func (a *outboundAgent) sentPrompts() []string {
	a.mu.Lock()
	defer a.mu.Unlock()
	var prompts []string
	for _, s := range a.sessions {
		prompts = append(prompts, s.sentPrompts()...)
	}
	return prompts
}

func (a *outboundAgent) sends() int { return len(a.sentPrompts()) }

func outboundFixture(t *testing.T) (*Engine, *stubProactiveSendPlatform, *outboundAgent) {
	t.Helper()
	p := &stubProactiveSendPlatform{stubMediaPlatform: stubMediaPlatform{stubPlatformEngine: stubPlatformEngine{n: "qq"}}}
	as := &outboundAgent{}
	e := NewEngine("fish", as, []Platform{p}, "", LangEnglish)
	t.Cleanup(func() { _ = e.Stop() })
	return e, p, as
}

// Exercise the real /send HTTP handler used by bothouse send, on a local
// ephemeral port. Only the platform and model boundaries are substituted.
func TestExternalSendContext_APIAndIsolation(t *testing.T) {
	e, p, as := outboundFixture(t)
	other, _, otherAS := outboundFixture(t)
	api := &APIServer{engines: map[string]*Engine{"fish": e, "other": other}}
	server := httptest.NewServer(http.HandlerFunc(api.handleSend))
	defer server.Close()
	const key = "qq:p:616"
	const text = "api-outbound-616"
	body, _ := json.Marshal(SendRequest{Project: "fish", SessionKey: key, Message: text})
	resp, err := http.Post(server.URL+"/send", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("send status = %d", resp.StatusCode)
	}
	for _, k := range []string{"qq:p:other", key, key} {
		if err := e.ExecuteHeartbeat(k, "recall prior sends", true); err != nil {
			t.Fatal(err)
		}
	}
	prompts := as.sentPrompts()
	if strings.Contains(prompts[0], text) || strings.Count(prompts[1], text) != 1 || strings.Contains(prompts[2], text) {
		t.Fatal("external context was lost, repeated, or routed to another conversation")
	}
	if !strings.Contains(prompts[1], "fish（你这个账号") || !strings.Contains(prompts[1], "来源：脚本/API") || !strings.Contains(prompts[1], "不是新的用户指令") {
		t.Fatal("external context lost its author or source boundary")
	}
	if err := other.ExecuteHeartbeat(key, "recall prior sends", true); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(otherAS.sentPrompts()[0], text) {
		t.Fatal("external context leaked to another role")
	}
	count := 0
	for _, sent := range p.getSent() {
		if sent == text {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("external text posted %d times, want once", count)
	}
}

type outboundFailurePlatform struct {
	stubProactiveSendPlatform
}

func (*outboundFailurePlatform) Send(context.Context, any, string) error {
	return errors.New("delivery rejected")
}

func TestExternalSendContext_FailedSend(t *testing.T) {
	p := &outboundFailurePlatform{}
	p.n = "qq"
	e := NewEngine("fish", &stubAgent{}, []Platform{p}, "", LangEnglish)
	defer e.Stop()
	if err := e.SendToSession("qq:p:616", "never delivered"); err == nil {
		t.Fatal("expected send failure")
	}
	if len(e.sessions.GetOrCreateActive("qq:p:616").PendingOutbound) != 0 {
		t.Fatal("failed send was recorded as delivered")
	}
}

func TestExternalSendContext_PersistenceAndFailedModelSend(t *testing.T) {
	e, p, _ := outboundFixture(t)
	path := filepath.Join(t.TempDir(), "sessions.json")
	e.sessions = NewSessionManager(path)
	e.recordExternalSend(p, "qq:p:616", "", "persisted-send", "脚本/API")
	reloaded := NewSessionManager(path)
	s := reloaded.GetOrCreateActive("qq:p:616")
	first := s.takeOutboundContext()
	s.SettleHandoff(false)
	if !strings.Contains(first, "persisted-send") || s.takeOutboundContext() != first {
		t.Fatal("pending text lost across restart or rejected model send")
	}
	// A later successful external send must survive settlement of the
	// earlier snapshot, even if it arrived while the model was running.
	e.appendExternalSend(reloaded, "qq:p:616", "later-send", "脚本/API")
	s.SettleHandoff(true)
	next := s.takeOutboundContext()
	if strings.Contains(next, "persisted-send") || !strings.Contains(next, "later-send") {
		t.Fatal("settlement consumed the wrong pending messages")
	}
	s.SettleHandoff(true)
	reloaded.Save()
	if got := NewSessionManager(path).GetOrCreateActive("qq:p:616").takeOutboundContext(); got != "" {
		t.Fatal("consumed pending text reappeared after restart")
	}
	e.appendExternalSend(reloaded, "qq:p:616", "retry-send", "脚本/API")
	s.takeOutboundContext()
	s.SettleHandoff(false)
	// A capacity retry reuses the already-built prompt, without taking again.
	s.SettleHandoff(true)
	if s.takeOutboundContext() != "" {
		t.Fatal("successful retry left already-delivered context pending")
	}
}

func TestExternalSendContext_WorkspaceRouting(t *testing.T) {
	for _, route := range []string{"prefixed", "active-default", "workdir"} {
		t.Run(route, func(t *testing.T) {
			e, p, _ := outboundFixture(t)
			const key = "qq:616"
			const text = "workspace-outbound-616"
			workDir := t.TempDir()
			e.workspacePool = newWorkspacePool(0)
			ws := e.workspacePool.GetOrCreate(workDir)
			ws.agent, ws.sessions = &outboundAgent{}, NewSessionManager("")
			var err error
			switch route {
			case "prefixed":
				err = e.SendToSession(workDir+":"+key, text)
			case "active-default":
				e.interactiveStates[workDir+":"+key] = &interactiveState{platform: p, replyCtx: "ctx", workspaceDir: workDir}
				err = e.SendToSession("", text)
			case "workdir":
				err = e.SendToSessionInWorkDir(key, text, nil, nil, workDir, nil, false)
			}
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(ws.sessions.GetOrCreateActive(key).takeOutboundContext(), text) || e.sessions.GetOrCreateActive(key).takeOutboundContext() != "" {
				t.Fatal("external context went to the wrong workspace")
			}
		})
	}
}

func TestExternalSendContext_ScheduledOutputs(t *testing.T) {
	for _, kind := range []string{"side", "cron-shell", "timer-shell", "mute", "check-success", "check-failure"} {
		t.Run(kind, func(t *testing.T) {
			e, p, as := outboundFixture(t)
			const key = "qq:p:616"
			const text = "scheduled-outbound-616"
			as.script = []string{text}
			command := "printf '" + text + "'"
			if runtime.GOOS == "windows" {
				command = "Write-Output '" + text + "'"
			}
			var err error
			switch kind {
			case "side":
				err = e.ExecuteCronJob(&CronJob{ID: "616", SessionKey: key, Description: "daily notes", Prompt: "share notes", SessionMode: "new_per_run"})
			case "cron-shell", "mute":
				err = e.ExecuteCronJob(&CronJob{ID: "616", SessionKey: key, Description: "daily notes", Exec: command, Mute: kind == "mute"})
			case "timer-shell":
				err = e.executeTimerShell(p, "ctx", &TimerJob{ID: "616", SessionKey: key, Exec: command})
			case "check-success", "check-failure":
				cmd := command
				if kind == "check-failure" {
					cmd += "; exit 1"
				}
				err = e.ExecuteCronJob(&CronJob{ID: "616", SessionKey: key, Description: "daily self-check", Exec: cmd})
			}
			if (err != nil) != (kind == "check-failure") {
				t.Fatalf("unexpected scheduled job error: %v", err)
			}
			before := as.sends()
			if err := e.ExecuteHeartbeat(key, "recall prior sends", true); err != nil {
				t.Fatal(err)
			}
			got := as.sentPrompts()[before]
			if strings.Contains(got, text) != (kind != "mute" && kind != "check-success") {
				t.Fatalf("scheduled text presence wrong for %s", kind)
			}
		})
	}
}

func TestExternalSendContext_ExistingHistoryReader(t *testing.T) {
	e, _, _ := outboundFixture(t)
	p := &historyPlatform{}
	e.recordExternalSend(p, "discord:616", "", "history handles this", "脚本/API")
	if len(e.sessions.GetOrCreateActive("discord:616").PendingOutbound) != 0 {
		t.Fatal("history-capable platform got a duplicate fallback record")
	}
}
