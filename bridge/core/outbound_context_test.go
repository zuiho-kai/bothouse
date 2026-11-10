package core

import (
	"strings"
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
				e.handleMessage(p, &Message{SessionKey: key, Platform: "qq", UserID: "616", UserName: "user", Content: "刚才推荐的是什么？", ReplyCtx: "ctx"})
			}
			prompts := as.sentPrompts()
			if len(prompts) != 1 || !strings.Contains(prompts[0], text) {
				t.Fatalf("successful external send absent from next model input: %#v", prompts)
			}
		})
	}
}
