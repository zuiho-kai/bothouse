package core

import (
	"net/http"
	"strings"
	"testing"
)

// stubDMMemberPlatform is a DM platform that knows which users are in the server.
type stubDMMemberPlatform struct {
	stubDMPlatform
	members map[string]bool
	asked   []string
}

func (p *stubDMMemberPlatform) IsDMMember(fromSession, userID string) (bool, error) {
	p.asked = append(p.asked, fromSession+"|"+userID)
	return p.members[userID], nil
}

const dmOwner, dmMember, dmStranger = "100000000000000001", "200000000000000002", "300000000000000003"

func dmToFixture() (*stubDMMemberPlatform, *Engine, *APIServer) {
	p := &stubDMMemberPlatform{stubDMPlatform: stubDMPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}},
		members: map[string]bool{dmOwner: true, dmMember: true}}
	e := NewEngine("p", &stubAgent{}, []Platform{p}, "", LangEnglish)
	e.SetAdminFrom(dmOwner)
	return p, e, &APIServer{engines: map[string]*Engine{"p": e}}
}

const dmFrom = "discord:guild-chan"

// #1352: a member (not the owner) started the turn and the model used --dm without --to; before,
// the message silently went to the owner. Now it is refused and the error says how to fix it.
func TestHandleSend_DMWithoutToRefusedForNonOwnerTurn(t *testing.T) {
	p, e, api := dmToFixture()
	e.noteCallerTurn(dmFrom, "discord", dmMember, "tzhouam", "", false, false, false)
	rec := postSend(t, api, SendRequest{Project: "p", DM: true, FromSession: dmFrom, Message: "设备码 834B-F0B0"})
	if rec.Code == http.StatusOK {
		t.Fatal("--dm without --to in a non-owner turn must be refused")
	}
	if len(p.openedFor) != 0 || len(p.getSent()) != 0 {
		t.Fatalf("nothing may be opened or sent: opened=%v sent=%v", p.openedFor, p.getSent())
	}
	if body := rec.Body.String(); !strings.Contains(body, "--to "+dmMember) {
		t.Fatalf("error should suggest --to <sender>: %s", body)
	}
}

func TestHandleSend_DMToMemberGoesToThem(t *testing.T) {
	p, e, api := dmToFixture()
	e.noteCallerTurn(dmFrom, "discord", dmMember, "tzhouam", "", false, false, false)
	rec := postSend(t, api, SendRequest{Project: "p", DM: true, DMTo: "<@" + dmMember + ">", FromSession: dmFrom, Message: "你的设备码"})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if len(p.openedFor) != 1 || p.openedFor[0] != dmMember {
		t.Fatalf("OpenDM for %v, want %s", p.openedFor, dmMember)
	}
	if len(p.asked) != 1 || p.asked[0] != dmFrom+"|"+dmMember {
		t.Fatalf("membership asked %v", p.asked)
	}
}

func TestHandleSend_DMToStrangerRefused(t *testing.T) {
	p, _, api := dmToFixture()
	rec := postSend(t, api, SendRequest{Project: "p", DM: true, DMTo: dmStranger, FromSession: dmFrom, Message: "hi"})
	if rec.Code == http.StatusOK {
		t.Fatal("--to someone outside the server must fail")
	}
	if len(p.openedFor) != 0 || len(p.getSent()) != 0 {
		t.Fatalf("nothing may be sent: opened=%v", p.openedFor)
	}
}

// The existing use stays: owner turns, scheduled turns and calls with no turn still reach the owner.
func TestHandleSend_DMWithoutToStillReachesOwner(t *testing.T) {
	cases := []struct {
		name string
		note func(e *Engine)
	}{
		{"owner turn", func(e *Engine) { e.noteCallerTurn(dmFrom, "discord", dmOwner, "瑞凤", "", false, false, false) }},
		{"timer turn", func(e *Engine) { e.noteCallerTurn(dmFrom, "discord", "timer", "", "", false, true, false) }},
		{"handoff turn", func(e *Engine) { e.noteCallerTurn(dmFrom, "discord", "handoff", "", "", false, false, false) }},
		{"bot relay", func(e *Engine) { e.noteCallerTurn(dmFrom, "discord", "999", "bot", "", true, false, false) }},
		{"no turn", func(e *Engine) {}},
	}
	for _, c := range cases {
		p, e, api := dmToFixture()
		c.note(e)
		rec := postSend(t, api, SendRequest{Project: "p", DM: true, FromSession: dmFrom, Message: "悄悄话"})
		if rec.Code != http.StatusOK {
			t.Errorf("%s: status = %d, body=%s", c.name, rec.Code, rec.Body.String())
			continue
		}
		if len(p.openedFor) != 1 || p.openedFor[0] != dmOwner {
			t.Errorf("%s: OpenDM for %v, want owner", c.name, p.openedFor)
		}
	}
}

// A platform that cannot check membership (QQ today; stub named discord to reuse its keys) only DMs the owner with --to.
func TestHandleSend_DMToWithoutMemberCheckRefused(t *testing.T) {
	p := &stubDMPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}
	e := NewEngine("p", &stubAgent{}, []Platform{p}, "", LangEnglish)
	e.SetAdminFrom(dmOwner)
	api := &APIServer{engines: map[string]*Engine{"p": e}}
	if rec := postSend(t, api, SendRequest{Project: "p", DM: true, DMTo: dmMember, Message: "hi"}); rec.Code == http.StatusOK {
		t.Fatal("--to a non-owner without a membership check must fail")
	}
	if rec := postSend(t, api, SendRequest{Project: "p", DM: true, DMTo: dmOwner, Message: "hi"}); rec.Code != http.StatusOK {
		t.Fatalf("--to the owner must work: %s", rec.Body.String())
	}
}
