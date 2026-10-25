package core

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// #587: assigning a teammate whose bot is not bound in the channel fails with the /bind to
// send, and the channel gets the same sentence once.
func TestAssignUnboundMemberSaysBindAndNoticesChannel(t *testing.T) {
	platform := newProgressPlatform()
	p, err := NewPublicProgress(t.TempDir(), "source", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	source := NewEngine("source", &stubAgent{}, []Platform{platform}, "", LangEnglish)
	t.Cleanup(source.cancel)
	target := NewEngine("target", &stubAgent{}, []Platform{newProgressPlatform()}, "", LangEnglish)
	t.Cleanup(target.cancel)
	source.publicProgress = p
	p.resolveReporter = source.resolveTaskReporter
	p.notBound = source.noteBound
	rm := NewRelayManager("")
	rm.RegisterEngine("source", source)
	rm.RegisterEngine("target", target)
	source.SetRelayManager(rm)
	rm.Bind("discord", "room", map[string]string{"source": "Source"}) // target not /bind-ed
	session := "discord:room:user"
	run := p.begin(platform, session, LangChinese, nil)
	req := TaskMemberAssignment{Project: "source", SessionKey: session, Run: run, BatchID: "b1", MemberID: "m1", ReporterProject: "target", Title: "查日志", Ref: assignRefNew}

	want := "target 在本频道没绑定，请用户在本频道发 /bind target"
	for i := 0; i < 2; i++ {
		_, err := p.AssignMember(req)
		if err == nil || err.Error() != want {
			t.Fatalf("assign %d: err = %v, want %q", i, err, want)
		}
		if !errors.Is(err, ErrNotBoundInChannel) || !errors.Is(err, ErrTaskFactUndeliverable) {
			t.Fatalf("assign %d: err %v lost its kinds", i, err)
		}
	}
	waitSent(t, &platform.stubPlatformEngine, want, 1)

	// Bound now: the assignment goes through, and a later unbind is told again.
	rm.Bind("discord", "room", map[string]string{"source": "Source", "target": "Target"})
	if _, err := p.AssignMember(req); err != nil {
		t.Fatal(err)
	}
	rm.Bind("discord", "room", map[string]string{"source": "Source"})
	req.MemberID = "m2"
	if _, err := p.AssignMember(req); err == nil || err.Error() != want {
		t.Fatalf("after unbind: %v", err)
	}
	waitSent(t, &platform.stubPlatformEngine, want, 2)
}

func TestRelaySendUnboundSaysBind(t *testing.T) {
	src := &relayVisibilityPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}
	source := NewEngine("source", &stubAgent{}, []Platform{src}, "", LangEnglish)
	t.Cleanup(source.cancel)
	target := NewEngine("target", &stubAgent{}, nil, "", LangEnglish)
	t.Cleanup(target.cancel)
	rm := NewRelayManager("")
	rm.RegisterEngine("source", source)
	rm.RegisterEngine("target", target)
	req := RelayRequest{From: "source", To: "target", SessionKey: "discord:room:user", Message: "hi"}

	_, err := rm.Send(context.Background(), req) // no binding in the channel at all
	if err == nil || !strings.Contains(err.Error(), "target 在本频道没绑定，请用户在本频道发 /bind target") || !errors.Is(err, ErrNotBoundInChannel) {
		t.Fatalf("no binding: %v", err)
	}
	waitSent(t, &src.stubPlatformEngine, "target 在本频道没绑定，请用户在本频道发 /bind target", 1)

	rm.Bind("discord", "room", map[string]string{"source": "Source", "other": "Other"})
	_, err = rm.Send(context.Background(), req)
	if err == nil || !strings.Contains(err.Error(), "/bind target") || !strings.Contains(err.Error(), "已绑定：other") {
		t.Fatalf("target not bound: %v", err)
	}
}

// #587: a misspelled target is not a missing /bind — no channel notice, the old error.
func TestRelaySendUnknownTargetNoBindNotice(t *testing.T) {
	src := &relayVisibilityPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}
	source := NewEngine("source", &stubAgent{}, []Platform{src}, "", LangEnglish)
	t.Cleanup(source.cancel)
	rm := NewRelayManager("")
	rm.RegisterEngine("source", source)
	rm.Bind("discord", "room", map[string]string{"source": "Source"})
	req := RelayRequest{From: "source", To: "tagret", SessionKey: "discord:room:user", Message: "hi"}

	_, err := rm.Send(context.Background(), req)
	if err == nil || !strings.Contains(err.Error(), "not found") || errors.Is(err, ErrNotBoundInChannel) {
		t.Fatalf("unknown target: %v", err)
	}
	time.Sleep(200 * time.Millisecond)
	src.mu.Lock()
	n := len(src.sent)
	src.mu.Unlock()
	if n != 0 {
		t.Fatalf("unknown target sent %d channel notices", n)
	}
}

// #587: a chat channel with no workspace is told how to make the first one; workspaces are
// still never made by themselves.
func TestTeamWorkspaceListEmptySaysNew(t *testing.T) {
	g := newWorkspaceGuild()
	e := newWorkspaceLead(t, g, t.TempDir())
	e.teamWS = newTeamWorkspaces()
	e.sessions.GetOrCreateActive("discord:100:u1")
	s := &APIServer{engines: map[string]*Engine{"lead": e}}

	list := func() TeamWorkspaceListResult {
		rec := httptest.NewRecorder()
		s.handleTeamWorkspaceList(rec, httptest.NewRequest(http.MethodGet, "/team/workspace/list?session_key=discord:100:u1", nil))
		var l TeamWorkspaceListResult
		if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &l) != nil {
			t.Fatalf("list: %d %s", rec.Code, rec.Body.String())
		}
		return l
	}
	if l := list(); l.Hint != teamWorkspaceNoneHint || len(l.Workspaces) != 0 {
		t.Fatalf("empty list = %+v, want hint %q", l, teamWorkspaceNoneHint)
	}
	if got := g.createdNames(); len(got) != 0 {
		t.Fatalf("list created %v", got)
	}

	rec := httptest.NewRecorder()
	s.handleTeamWorkspacePark(rec, httptest.NewRequest(http.MethodPost, "/team/workspace/park", strings.NewReader(`{"session_key":"discord:100:u1"}`)))
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), teamWorkspaceNoneHint) {
		t.Fatalf("park without workspace: %d %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	s.handleTeamWorkspaceNew(rec, httptest.NewRequest(http.MethodPost, "/team/workspace/new", strings.NewReader(`{"session_key":"discord:100:u1"}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("new: %d %s", rec.Code, rec.Body.String())
	}
	if l := list(); l.Hint != "" || len(l.Workspaces) != 1 {
		t.Fatalf("after new: %+v", l)
	}
}

func waitSent(t *testing.T, p *stubPlatformEngine, text string, n int) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		got := 0
		for _, s := range p.getSent() {
			if s == text {
				got++
			}
		}
		if got == n {
			time.Sleep(30 * time.Millisecond)
			if c := countSent(p, text); c != n {
				t.Fatalf("channel got %q %d times, want %d", text, c, n)
			}
			return
		}
		if got > n || time.Now().After(deadline) {
			t.Fatalf("channel got %q %d times, want %d (sent %v)", text, got, n, p.getSent())
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func countSent(p *stubPlatformEngine, text string) int {
	c := 0
	for _, s := range p.getSent() {
		if s == text {
			c++
		}
	}
	return c
}
