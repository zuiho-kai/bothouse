package core

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

// #1453 (user 2026-11-11「能不能修根因感觉还在修现象」): one addressee decision feeds every path.
// Routing model present / absent / failing × who the message calls × lead or sub. "starts" means
// applyGate lets the message go on to a turn; "gate" means the routing model was asked.
func TestAddresseeTable(t *testing.T) {
	msgs := []struct {
		name string
		msg  Message
		addr Addressee
	}{
		{"@本角色", Message{Content: "<@me> 看看", Mentioned: true}, AddrSelf},
		{"@队友bot", Message{Content: "<@sub> 看看", AddressedOther: true}, AddrOther},
		{"@真人", Message{Content: "<@887952333957386250> PTAL", AddressedOther: true}, AddrOther},
		{"回复本角色", Message{Content: "可以", Mentioned: true}, AddrSelf},
		{"回复别人", Message{Content: "可以", AddressedOther: true}, AddrOther},
		{"行首点名本角色", Message{Content: "橘，看看", Mentioned: true}, AddrSelf},
		{"行首点名队友", Message{Content: "龙娘，看看", AddressedOther: true}, AddrOther},
		{"谁都没叫", Message{Content: "大家好"}, AddrNone},
	}
	type outcome struct{ starts, gate bool }
	// want[mode][role][addr]
	want := map[string]map[string]map[Addressee]outcome{
		"无路由模型": {
			"lead": {AddrSelf: {true, false}, AddrOther: {false, false}, AddrNone: {false, false}},
			"sub":  {AddrSelf: {true, false}, AddrOther: {false, false}, AddrNone: {false, false}},
		},
		"有路由模型": { // the routing model answers "reply": whatever reaches it starts
			"lead": {AddrSelf: {true, true}, AddrOther: {false, false}, AddrNone: {true, true}},
			"sub":  {AddrSelf: {true, true}, AddrOther: {false, false}, AddrNone: {true, true}},
		},
		"路由模型出错": { // unreachable: an @ still answers, the lead covers what calls no one
			"lead": {AddrSelf: {true, false}, AddrOther: {false, false}, AddrNone: {true, false}},
			"sub":  {AddrSelf: {true, false}, AddrOther: {false, false}, AddrNone: {false, false}},
		},
	}
	for _, mode := range []string{"无路由模型", "有路由模型", "路由模型出错"} {
		for _, role := range []string{"lead", "sub"} {
			for _, mc := range msgs {
				t.Run(fmt.Sprintf("%s/%s/%s", mode, role, mc.name), func(t *testing.T) {
					e := newTestEngine()
					e.name = role
					e.team = nil
					p := &selfLeadTestPlatform{stubPlatformEngine{n: "discord"}, role == "lead"}
					m := mc.msg
					m.ChannelID, m.SessionKey = "c", "discord:c"
					if got := e.addresseeOf(p, &m); got != mc.addr {
						t.Fatalf("addresseeOf = %s, want %s", got, mc.addr)
					}
					var asked func() []gateRequest
					switch mode {
					case "有路由模型":
						var srv *httptest.Server
						srv, asked = gateRecorder(t, "reply")
						e.SetGate(srv.URL, 2000, map[string]string{"lead": "reply", "sub": "context"}[role])
					case "路由模型出错":
						down := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
						down.Close()
						e.SetGate(down.URL, 500, map[string]string{"lead": "reply", "sub": "context"}[role])
						asked = func() []gateRequest { return nil }
					default:
						asked = func() []gateRequest { return nil }
					}
					if e.gate.Load() != nil {
						m.burstDone = true // skip the burst hold
					}
					starts := !e.applyGate(p, &m, &Session{}, "k")
					w := want[mode][role][mc.addr]
					if starts != w.starts {
						t.Errorf("starts = %v, want %v", starts, w.starts)
					}
					if gate := len(asked()) > 0; gate != w.gate {
						t.Errorf("routing model asked = %v, want %v", gate, w.gate)
					}
				})
			}
		}
	}
}

// A bot not in a team keeps answering what calls no one; what calls someone else stays theirs.
func TestAddresseeSoloBot(t *testing.T) {
	e := newTestEngine()
	e.team = nil
	p := &stubPlatformEngine{n: "discord"}
	if e.suppressUnaddressedGroup(p, &Message{Content: "大家好", ChannelID: "c", SessionKey: "discord:c"}) {
		t.Fatal("a solo bot must still answer a message that calls no one")
	}
	if !e.suppressUnaddressedGroup(p, &Message{Content: "<@9> 看看", ChannelID: "c", SessionKey: "discord:c", AddressedOther: true}) {
		t.Fatal("a message calling someone else is not the solo bot's")
	}
}

// The ♻️ new-session notice follows the same result: a sub that was not called in a chat and has
// no work there keeps it out (鲸鱼娘 in agentm #vllm-omni, 11-11); called lately, it is posted.
func TestFreshNoticeFollowsAddressee(t *testing.T) {
	e := newTestEngine()
	e.name = "sub-notice-test"
	e.team = nil
	sub := &selfLeadTestPlatform{stubPlatformEngine{n: "discord"}, false}
	lead := &selfLeadTestPlatform{stubPlatformEngine{n: "discord"}, true}
	if e.freshNoticeBelongs(sub, "discord:c9") {
		t.Fatal("a sub never called in this chat must not post the notice there")
	}
	if !e.freshNoticeBelongs(lead, "discord:c9") {
		t.Fatal("the lead runs the chat: its notice stays")
	}
	if e.suppressUnaddressedGroup(sub, &Message{Content: "<@sub> 看看", ChannelID: "c9", SessionKey: "discord:c9", Mentioned: true}) {
		t.Fatal("an @-ed sub must answer")
	}
	if !e.freshNoticeBelongs(sub, "discord:c9") {
		t.Fatal("a sub just called in this chat posts its notice there")
	}
	if !e.freshNoticeBelongs(&stubPlatformEngine{n: "discord"}, "discord:c8") {
		t.Fatal("a bot not in a team keeps its notices")
	}
}
