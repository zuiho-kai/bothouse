package qq

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
	"github.com/gorilla/websocket"
)

type outboundCaptureAgent struct {
	*outboundCaptureSession
}

func (*outboundCaptureAgent) Name() string { return "outbound-capture" }
func (a *outboundCaptureAgent) StartSession(context.Context, string) (core.AgentSession, error) {
	return a.outboundCaptureSession, nil
}
func (*outboundCaptureAgent) ListSessions(context.Context) ([]core.AgentSessionInfo, error) {
	return nil, nil
}
func (*outboundCaptureAgent) Stop() error { return nil }

type outboundCaptureSession struct {
	prompts chan string
	events  chan core.Event
}

func (s *outboundCaptureSession) Send(prompt, _ string, _ []core.ImageAttachment, _ []core.FileAttachment) error {
	s.prompts <- prompt
	s.events <- core.Event{Type: core.EventResult, Content: "answer", Done: true}
	return nil
}
func (*outboundCaptureSession) RespondPermission(string, core.PermissionResult) error { return nil }
func (s *outboundCaptureSession) Events() <-chan core.Event                           { return s.events }
func (*outboundCaptureSession) CurrentSessionID() string                              { return "outbound-616" }
func (*outboundCaptureSession) Alive() bool                                           { return true }
func (*outboundCaptureSession) Close() error                                          { return nil }

// Exercise the real QQ adapter and OneBot send acknowledgement on loopback.
// The OneBot server and model are substitutes; no QQ account is contacted.
func TestOutboundContext_RealQQAdapter(t *testing.T) {
	for _, trigger := range []string{"user", "heartbeat"} {
		t.Run(trigger, func(t *testing.T) {
			upgrader := websocket.Upgrader{}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				c, err := upgrader.Upgrade(w, r, nil)
				if err != nil {
					return
				}
				defer c.Close()
				for {
					var req map[string]any
					if err := c.ReadJSON(&req); err != nil {
						return
					}
					data := map[string]any{"message_id": 616}
					if req["action"] == "get_login_info" {
						data = map[string]any{"user_id": 999999, "nickname": "fish"}
					}
					if err := c.WriteJSON(map[string]any{"status": "ok", "retcode": 0, "echo": req["echo"], "data": data}); err != nil {
						return
					}
				}
			}))
			defer server.Close()
			p, err := New(map[string]any{"ws_url": "ws" + strings.TrimPrefix(server.URL, "http"), "allow_from": "*"})
			if err != nil {
				t.Fatal(err)
			}
			as := &outboundCaptureSession{prompts: make(chan string, 1), events: make(chan core.Event, 1)}
			e := core.NewEngine("fish", &outboundCaptureAgent{as}, []core.Platform{p}, "", core.LangEnglish)
			if err := p.Start(e.ReceiveMessage); err != nil {
				t.Fatal(err)
			}
			defer e.Stop()
			const text = "qq-outbound-616: 今天推荐水煮鱼"
			if err := e.SendToSession("qq:616", text); err != nil {
				t.Fatal(err)
			}
			if trigger == "heartbeat" {
				if err := e.ExecuteHeartbeat("qq:616", "刚才推荐的是什么？", true); err != nil {
					t.Fatal(err)
				}
			} else {
				p.(*Platform).handleMessage(map[string]any{"message_type": "private", "user_id": float64(616), "message_id": float64(617), "raw_message": "刚才推荐的是什么？", "sender": map[string]any{"nickname": "user"}})
			}
			select {
			case prompt := <-as.prompts:
				if strings.Count(prompt, text) != 1 || !strings.Contains(prompt, "来源：脚本/API") {
					t.Fatal("QQ external text missing or duplicated in actual model input")
				}
				t.Log("QQ OneBot send acknowledged; next model input contains external text once with source")
			case <-time.After(5 * time.Second):
				t.Fatal("QQ follow-up did not reach model input")
			}
		})
	}
}
