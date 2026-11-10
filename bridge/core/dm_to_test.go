package core

import (
	"context"
	"errors"
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

// refusingDMPlatform refuses every DM send (the person does not accept DMs from server members) and can
// open a private thread instead.
type refusingDMPlatform struct {
	stubDMMemberPlatform
	threadFor  []string
	noThread   bool
	threadSent []string
}

var errRefused = errors.New(`HTTP 403 Forbidden, {"message": "Cannot send messages to this user", "code": 50007}`)

func (p *refusingDMPlatform) ReconstructReplyCtx(sessionKey string) (any, error) {
	return sessionKey, nil
}
func (p *refusingDMPlatform) Send(_ context.Context, rctx any, content string) error {
	if strings.HasPrefix(rctx.(string), "discord:dm-chan:") {
		return errRefused
	}
	p.threadSent = append(p.threadSent, content)
	return nil
}
func (p *refusingDMPlatform) IsDMRefused(err error) bool { return errors.Is(err, errRefused) }
func (p *refusingDMPlatform) OpenPrivateThread(fromSession, userID, name string) (string, error) {
	if p.noThread {
		return "", errors.New("missing Create Private Threads")
	}
	p.threadFor = append(p.threadFor, fromSession+"|"+userID)
	return "discord:private-thread", nil
}

func refusingFixture(noThread bool) (*refusingDMPlatform, *APIServer) {
	p := &refusingDMPlatform{stubDMMemberPlatform: stubDMMemberPlatform{
		stubDMPlatform: stubDMPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}},
		members:        map[string]bool{dmOwner: true, dmMember: true}}, noThread: noThread}
	e := NewEngine("p", &stubAgent{}, []Platform{p}, "", LangEnglish)
	e.SetAdminFrom(dmOwner)
	return p, &APIServer{engines: map[string]*Engine{"p": e}}
}

// A refused DM goes to a private thread with the same person; nobody has to change a privacy setting.
func TestHandleSend_DMRefusedFallsBackToPrivateThread(t *testing.T) {
	p, api := refusingFixture(false)
	rec := postSend(t, api, SendRequest{Project: "p", DM: true, DMTo: dmMember, FromSession: dmFrom, Message: "设备码 834B"})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if len(p.threadFor) != 1 || p.threadFor[0] != dmFrom+"|"+dmMember {
		t.Fatalf("private thread for %v", p.threadFor)
	}
	if len(p.threadSent) != 1 || p.threadSent[0] != "<@"+dmMember+"> 设备码 834B" {
		t.Fatalf("thread got %v", p.threadSent)
	}
	if !strings.Contains(rec.Body.String(), "private thread") {
		t.Fatalf("response should say where it went: %s", rec.Body.String())
	}
}

func TestHandleSend_DMRefusedNoThreadExplains(t *testing.T) {
	p, api := refusingFixture(true)
	rec := postSend(t, api, SendRequest{Project: "p", DM: true, DMTo: dmMember, FromSession: dmFrom, Message: "x"})
	if rec.Code == http.StatusOK || len(p.threadSent) != 0 {
		t.Fatalf("must fail without sending: %d %v", rec.Code, p.threadSent)
	}
	body := rec.Body.String()
	for _, want := range []string{"does not accept direct messages from server members", "Do not ask them to change their privacy settings", "Nothing was sent"} {
		if !strings.Contains(body, want) {
			t.Errorf("error lacks %q: %s", want, body)
		}
	}
}
