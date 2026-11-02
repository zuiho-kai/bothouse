package core

import (
	"strings"
	"testing"
)

type proactiveIntakePlatform struct {
	stubPlatformEngine
	handler MessageHandler
}

func (p *proactiveIntakePlatform) Start(handler MessageHandler) error {
	p.handler = handler
	return nil
}

func TestProactiveRegisteredPlatformIntake(t *testing.T) {
	for _, name := range []string{"discord", "qq", "feishu", "cloud_web"} {
		for _, mode := range []ProactiveMode{ProactiveOff, ProactiveObserve, ProactiveAuto} {
			t.Run(name+"/"+string(mode), func(t *testing.T) {
				p := &proactiveIntakePlatform{stubPlatformEngine: stubPlatformEngine{n: name}}
				backend := &abortTurnSession{events: make(chan Event, 8)}
				e := NewEngine("role", &abortTurnAgent{s: backend}, []Platform{p}, "", LangEnglish)
				e.SetDataDir(t.TempDir())
				if err := e.EnablePublicProgress(); err != nil {
					t.Fatal(err)
				}
				a, _ := authorizationFixture(t, mode)
				policy := a.Policy()
				policy.Bindings[0].Identities = []AuthorityIdentity{{Platform: name, UserID: "123"}}
				policy.Rules[0].Source, policy.Rules[0].EventKind = p.Name(), "message"
				if err := a.ReplacePolicy(policy.Version, policy); err != nil {
					t.Fatal(err)
				}
				e.proactiveAuthorization = a
				if err := e.Start(); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = e.Stop() })
				msg := Message{Platform: p.Name(), MessageID: "event", UserID: "123", SessionKey: "room", Content: "review available", ReplyCtx: "ctx"}
				p.handler(p, &msg)
				if mode != ProactiveAuto {
					waitFor(t, "ordinary chat retained in off/observe", func() bool { backend.mu.Lock(); defer backend.mu.Unlock(); return len(backend.prompts) == 1 })
					if msg.authorization != nil {
						t.Fatal("ordinary chat received a proactive grant")
					}
					if len(e.publicProgress.records) != 0 {
						t.Fatal("observation created a task")
					}
					return
				}
				waitFor(t, "admitted execution", func() bool { backend.mu.Lock(); defer backend.mu.Unlock(); return len(backend.prompts) == 1 })
				if msg.authorization == nil {
					t.Fatal("intake lost grant")
				}
				duplicate := Message{Platform: p.Name(), MessageID: msg.MessageID, UserID: msg.UserID, SessionKey: msg.SessionKey, Content: msg.Content, ReplyCtx: "ctx"}
				p.handler(p, &duplicate)
				backend.mu.Lock()
				count := len(backend.prompts)
				prompt := backend.prompts[0]
				backend.mu.Unlock()
				if count != 1 || !strings.Contains(prompt, msg.authorization.TaskID) {
					t.Fatal("duplicate execution or unrelated progress task")
				}
				if err := a.Revoke(msg.authorization.DecisionID, "human:stop"); err != nil {
					t.Fatal(err)
				}
				waitFor(t, "intake execution cancelled", func() bool { backend.mu.Lock(); defer backend.mu.Unlock(); return backend.cancels > 0 })
			})
		}
	}
}

func TestProactivePlatformIngressSharedContract(t *testing.T) {
	for _, name := range []string{"discord", "qq", "feishu", "cloud_web"} {
		for _, mode := range []ProactiveMode{ProactiveOff, ProactiveObserve, ProactiveAuto} {
			t.Run(name+"/"+string(mode), func(t *testing.T) {
				a, _ := authorizationFixture(t, mode)
				policy := a.Policy()
				policy.Bindings[0].Identities = []AuthorityIdentity{{Platform: name, UserID: "123"}}
				policy.Rules[0].Source, policy.Rules[0].EventKind = name, "message"
				if err := a.ReplacePolicy(policy.Version, policy); err != nil {
					t.Fatal(err)
				}
				p := &stubPlatformEngine{n: name}
				e := NewEngine("role", &stubAgent{}, []Platform{p}, "", LangEnglish)
				e.SetDataDir(t.TempDir())
				e.proactiveAuthorization = a
				msg := &Message{Platform: name, MessageID: "stable-event", UserID: "123", UserName: "same name", SessionKey: "room", Content: "The review is available"}
				d, managed, err := e.evaluatePlatformFollowup(p, msg)
				want := map[ProactiveMode]string{ProactiveOff: "off", ProactiveObserve: "would_accept", ProactiveAuto: "eligible"}[mode]
				if err != nil || !managed || d.Outcome != want {
					t.Fatalf("decision %+v managed=%v error=%v", d, managed, err)
				}
				if len(p.sent) != 0 {
					t.Fatal("candidate evaluation sent confirmation")
				}
				for _, kind := range []string{"bot", "other-author", "context", "wrong-platform"} {
					input := *msg
					input.MessageID += kind
					switch kind {
					case "bot":
						input.FromBot = true
					case "other-author":
						input.UserID = "not-bound"
					case "context":
						input.AddressedOther = true
					case "wrong-platform":
						input.Platform = "untrusted"
					}
					d, _, err := e.evaluatePlatformFollowup(p, &input)
					if err != nil || d.Outcome == "eligible" || d.Outcome == "would_accept" {
						t.Fatalf("%s enlarged authority: %+v %v", kind, d, err)
					}
				}
				for _, kind := range []string{"mention", "direct", "permission", "stop"} {
					input := *msg
					switch kind {
					case "mention":
						input.Mentioned = true
					case "direct":
						input.Direct = true
					case "permission":
						input.IsPermissionResponse = true
					case "stop":
						input.Content = "/stop all"
					}
					if _, managed, err := e.evaluatePlatformFollowup(p, &input); err != nil || managed {
						t.Fatalf("%s intercepted explicit checks: %v", kind, err)
					}
				}
			})
		}
	}
}
