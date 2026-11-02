package core

import (
	"encoding/json"
	"testing"
)

func TestProactiveBridgeAdapterProvenance(t *testing.T) {
	for _, kind := range []string{"human", "bot", "missing-actor", "insecure", "reconstructed", "other-addressee"} {
		t.Run(kind, func(t *testing.T) {
			bs := NewBridgeServer(0, "test-token", "/bridge/ws", nil)
			bp := &BridgePlatform{server: bs, project: "role"}
			e := NewEngine("role", &stubAgent{}, []Platform{bp}, "", LangEnglish)
			e.SetDataDir(t.TempDir())
			bs.RegisterEngine("role", e, bp)
			a, _ := authorizationFixture(t, ProactiveAuto)
			policy := a.Policy()
			policy.Bindings[0].Identities = []AuthorityIdentity{{Platform: "dsh", UserID: "123"}}
			policy.Rules[0].Source = "dsh"
			policy.Rules[0].EventKind = "message"
			if err := a.ReplacePolicy(policy.Version, policy); err != nil {
				t.Fatal(err)
			}
			e.proactiveAuthorization = a
			adapter := &bridgeAdapter{platform: "dsh", server: bs}
			bs.adapters["dsh"] = adapter
			if kind == "insecure" {
				bs.token = ""
				bs.insecure = true
			}
			var received *Message
			bp.handler = func(_ Platform, msg *Message) { received = msg }
			payload := map[string]any{"session_key": "room", "project": "role", "user_id": "123", "msg_id": kind, "content": "review available", "from_bot": false}
			if kind == "missing-actor" {
				delete(payload, "from_bot")
			}
			if kind == "bot" {
				payload["from_bot"] = true
			}
			if kind == "other-addressee" {
				payload["addressed_other"] = true
			}
			raw, err := json.Marshal(payload)
			if err != nil {
				t.Fatal(err)
			}
			adapter.handleMessage(raw)
			if received == nil {
				t.Fatal("adapter did not dispatch")
			}
			if kind == "reconstructed" {
				received.ReplyCtx = newBridgeReplyCtx(adapter, "room", "")
			}
			d, managed, err := e.evaluatePlatformFollowup(bp, received)
			if err != nil || !managed {
				t.Fatalf("evaluation: managed=%v error=%v", managed, err)
			}
			if (d.Outcome == "eligible") != (kind == "human") {
				t.Fatalf("%s: %+v", kind, d)
			}
			if d.Identity.Platform != "dsh" {
				t.Fatalf("lost platform namespace: %+v", d.Identity)
			}
		})
	}
}
