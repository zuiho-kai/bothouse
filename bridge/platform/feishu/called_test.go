package feishu

import (
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

// The @bot / p2p flags computed in onMessage ride on replyContext and are copied onto core.Message
// for core's built-in busy rules (core/gate_local.go).
func TestDispatchCoreMessageCarriesCalled(t *testing.T) {
	for _, rc := range []replyContext{{messageID: "m", mentioned: true}, {messageID: "m", direct: true}, {messageID: "m", fromBot: true}, {messageID: "m"}} {
		var got *core.Message
		p := &Platform{}
		p.handler = func(_ core.Platform, m *core.Message) { got = m }
		p.dispatchCoreMessage(&core.Message{MessageID: "m", ReplyCtx: rc})
		if got == nil || got.Mentioned != rc.mentioned || got.Direct != rc.direct || got.FromBot != rc.fromBot {
			t.Fatalf("rc=%+v got=%+v", rc, got)
		}
	}
}
