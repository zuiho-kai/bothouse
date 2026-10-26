package core

import (
	"context"
	"errors"
	"testing"
	"time"
)

// teamBindFixture: a data dir whose conest-setup.json has a Discord team (lead, worker — same
// model, different roles) and a cloud_web team (lead, cw), plus a registered external project.
func teamBindFixture(t *testing.T) (string, *RelayManager) {
	t.Helper()
	dir := t.TempDir()
	writeTeamState(t, dir, SetupState{
		Platform: "discord",
		Team: []SetupTeamEntry{
			{Project: "lead", Name: "橘", AgentType: "claudecode"},
			{Project: "worker", Name: "橘二", AgentType: "claudecode"},
		},
		CloudWebTeam: []SetupTeamEntry{{Project: "lead", Name: "橘"}, {Project: "cw", Name: "网页"}},
	})
	return dir, newTeamBindManager(t, dir)
}

func writeTeamState(t *testing.T, dir string, s SetupState) {
	t.Helper()
	if err := writeJSONFile(dir+"/"+setupStateFile, s, 0o644); err != nil {
		t.Fatal(err)
	}
}

func newTeamBindManager(t *testing.T, dir string) *RelayManager {
	t.Helper()
	rm := NewRelayManager(dir)
	for _, name := range []string{"lead", "worker", "cw", "ext"} {
		p := newProgressPlatform()
		rm.RegisterEngine(name, &Engine{name: name, ctx: context.Background(), platforms: []Platform{p}, i18n: NewI18n(LangEnglish)})
	}
	return rm
}

// relaySendOK runs a plain relay to a fresh engine that answers "ok".
func relaySendOK(t *testing.T, rm *RelayManager, from, to, session string) error {
	t.Helper()
	platform, _, _ := parseSessionKeyParts(session)
	src := &relayVisibilityPlatform{stubPlatformEngine: stubPlatformEngine{n: platform}}
	dst := &relayVisibilityPlatform{stubPlatformEngine: stubPlatformEngine{n: platform}}
	s := newControllableSession(to)
	rm.RegisterEngine(from, NewEngine(from, &stubAgent{}, []Platform{src}, "", LangEnglish))
	rm.RegisterEngine(to, NewEngine(to, &controllableAgent{nextSession: s}, []Platform{dst}, "", LangEnglish))
	done := make(chan error, 1)
	go func() {
		_, err := rm.Send(context.Background(), RelayRequest{From: from, To: to, SessionKey: session, Message: "go"})
		done <- err
	}()
	select {
	case err := <-done: // refused before reaching the target
		return err
	case <-time.After(50 * time.Millisecond):
	}
	s.events <- Event{Type: EventResult, Content: "ok"}
	select {
	case err := <-done:
		return err
	case <-time.After(2 * time.Second):
		t.Fatal("Send did not return")
		return nil
	}
}

// taskSendBindErr: a task relay with an unknown task id. It must fail; the result says whether
// the binding checks refused it (ErrNotBoundInChannel) or let it through to the task lookup.
func taskSendBindErr(rm *RelayManager, from, to, session string) bool {
	_, err := rm.Send(context.Background(), RelayRequest{From: from, To: to, SessionKey: session, TaskID: "task-x", RequestID: "r1", Message: "m"})
	return errors.Is(err, ErrNotBoundInChannel)
}

func TestRelayTeamBind_TeamRelaysWithoutBind(t *testing.T) {
	_, rm := teamBindFixture(t)
	if err := relaySendOK(t, rm, "lead", "worker", "discord:fresh-room:u1"); err != nil {
		t.Fatal("team member relay without /bind:", err)
	}
	if err := relaySendOK(t, rm, "worker", "lead", "discord:other-guild-room:u1"); err != nil {
		t.Fatal("reverse relay in another server's channel:", err)
	}
	_, rm = teamBindFixture(t)
	if taskSendBindErr(rm, "lead", "worker", "discord:fresh-room:u1") {
		t.Fatal("task relay inside the team refused as not bound")
	}
}

func TestRelayTeamBind_ProgressReporterResolves(t *testing.T) {
	_, rm := teamBindFixture(t)
	if _, err := rm.ResolveTaskReporter("lead", "worker", "discord", "discord:fresh-room:u1"); err != nil {
		t.Fatal("team member reporter refused:", err)
	}
	if _, err := rm.ResolveTaskReporter("lead", "ext", "discord", "discord:fresh-room:u1"); !errors.Is(err, ErrNotBoundInChannel) {
		t.Fatal("external reporter accepted:", err)
	}
}

func TestRelayTeamBind_ExternalStillNeedsBind(t *testing.T) {
	_, rm := teamBindFixture(t)
	if err := relaySendOK(t, rm, "lead", "ext", "discord:room:u1"); !errors.Is(err, ErrNotBoundInChannel) {
		t.Fatal("external target accepted without /bind:", err)
	}
	if !taskSendBindErr(rm, "ext", "lead", "discord:room:u1") {
		t.Fatal("external source task relay accepted without /bind")
	}
	// A manual /bind of the external project keeps the team bound too.
	rm.AddToBind("discord", "room", "lead")
	rm.AddToBind("discord", "room", "ext")
	if taskSendBindErr(rm, "lead", "ext", "discord:room:u1") || taskSendBindErr(rm, "lead", "worker", "discord:room:u1") {
		t.Fatal("manual /bind of an external project broke team or manual binding")
	}
	if _, err := rm.ResolveTaskReporter("lead", "worker", "discord", "discord:room:u1"); err != nil {
		t.Fatal("reporter after manual /bind:", err)
	}
}

func TestRelayTeamBind_UnbindVetoes(t *testing.T) {
	dir, rm := teamBindFixture(t)
	if !rm.RemoveFromBind("room", "worker") {
		t.Fatal("/bind -worker on a team member reported not found")
	}
	if !taskSendBindErr(rm, "lead", "worker", "discord:room:u1") {
		t.Fatal("team bound worker back after /bind -worker")
	}
	if _, err := rm.ResolveTaskReporter("lead", "worker", "discord", "discord:room:u1"); !errors.Is(err, ErrNotBoundInChannel) {
		t.Fatal("reporter accepted after /bind -worker:", err)
	}
	// The veto is per chat and survives a restart.
	rm = newTeamBindManager(t, dir)
	if !taskSendBindErr(rm, "lead", "worker", "discord:room:u1") {
		t.Fatal("veto lost on restart")
	}
	if taskSendBindErr(rm, "lead", "worker", "discord:another:u1") {
		t.Fatal("veto leaked to another chat")
	}
	rm.AddToBind("discord", "room", "worker")
	if taskSendBindErr(rm, "lead", "worker", "discord:room:u1") {
		t.Fatal("/bind worker did not lift the veto")
	}
	// /bind remove clears the whole chat, team included.
	rm.Unbind("room")
	if !taskSendBindErr(rm, "lead", "worker", "discord:room:u1") || rm.EffectiveBinding("discord", "room") != nil {
		t.Fatal("team bound the chat back after /bind remove")
	}
	if !taskSendBindErr(newTeamBindManager(t, dir), "lead", "worker", "discord:room:u1") {
		t.Fatal("/bind remove veto lost on restart")
	}
}

func TestRelayTeamBind_SameModelRolesAreSeparate(t *testing.T) {
	_, rm := teamBindFixture(t)
	b := rm.EffectiveBinding("discord", "room")
	if b == nil || b.Bots["lead"] != "lead" || b.Bots["worker"] != "worker" || len(b.Bots) != 2 {
		t.Fatalf("same-model roles not both bound: %+v", b)
	}
	for _, pair := range [][2]string{{"lead", "worker"}, {"worker", "lead"}} {
		if _, _, err := rm.voiceTarget(RelayRequest{From: pair[0], To: pair[1], SessionKey: "discord:room:u1", Scope: "desk"}); err != nil {
			t.Fatalf("voice %s→%s refused: %v", pair[0], pair[1], err)
		}
	}
	if _, _, err := rm.voiceTarget(RelayRequest{From: "lead", To: "ext", SessionKey: "discord:room:u1", Scope: "desk"}); err == nil {
		t.Fatal("voice to external project accepted")
	}
}

func TestRelayTeamBind_TeamsSplitByPlatform(t *testing.T) {
	dir, rm := teamBindFixture(t)
	// cloud_web: a workspace room the wizard never saw.
	if err := relaySendOK(t, rm, "lead", "cw", "cloud_web:ws-room-7:u1"); err != nil {
		t.Fatal("cloud_web team relay in a new room:", err)
	}
	rm = newTeamBindManager(t, dir)
	if !taskSendBindErr(rm, "lead", "worker", "cloud_web:ws-room-7:u1") {
		t.Fatal("Discord team member accepted on cloud_web")
	}
	if !taskSendBindErr(rm, "lead", "cw", "discord:room:u1") {
		t.Fatal("cloud_web team member accepted on Discord")
	}
	if !taskSendBindErr(rm, "lead", "worker", "feishu:oc_1:u1") {
		t.Fatal("Discord team accepted on Feishu")
	}
	// A team of one is no team; a later wizard run is picked up without a restart.
	writeTeamState(t, dir, SetupState{Platform: "discord", Team: []SetupTeamEntry{{Project: "lead"}}})
	if !taskSendBindErr(rm, "lead", "worker", "discord:room:u1") {
		t.Fatal("single-role state still bound the old team")
	}
	writeTeamState(t, dir, SetupState{Platform: "feishu", Team: []SetupTeamEntry{{Project: "lead"}, {Project: "worker"}}})
	if taskSendBindErr(rm, "lead", "worker", "feishu:oc_1:u1") {
		t.Fatal("Feishu team refused")
	}
}

// Without conest-setup.json relay behaves as before: manual bindings only.
func TestRelayTeamBind_NoWizardStateKeepsManualOnly(t *testing.T) {
	rm := newTeamBindManager(t, t.TempDir())
	if !taskSendBindErr(rm, "lead", "worker", "discord:room:u1") {
		t.Fatal("unbound chat accepted without a wizard team")
	}
	rm.Bind("discord", "room", map[string]string{"lead": "Lead", "worker": "Worker"})
	if taskSendBindErr(rm, "lead", "worker", "discord:room:u1") {
		t.Fatal("manual binding refused")
	}
	if got := rm.EffectiveBinding("discord", "room"); got != rm.GetBinding("room") {
		t.Fatal("manual binding was copied without a team")
	}
}

// A plain relay (no task id) in a channel the team bound must come from a bound sender:
// external projects and members of another platform's team still need /bind.
func TestRelayTeamBind_PlainRelayChecksSender(t *testing.T) {
	_, rm := teamBindFixture(t)
	if err := relaySendOK(t, rm, "ext", "lead", "discord:room:u1"); !errors.Is(err, ErrNotBoundInChannel) {
		t.Fatal("external source plain relay accepted without /bind:", err)
	}
	if err := relaySendOK(t, rm, "cw", "worker", "discord:room2:u1"); !errors.Is(err, ErrNotBoundInChannel) {
		t.Fatal("cloud_web-only member plain relay accepted on Discord without /bind:", err)
	}
	// After /bind of ext, the sender is bound and the relay goes through.
	rm.AddToBind("discord", "room", "ext")
	if err := relaySendOK(t, rm, "ext", "lead", "discord:room:u1"); err != nil {
		t.Fatal("plain relay after /bind ext:", err)
	}
}

// A chat bound only by a manual /bind (no wizard team) keeps the old plain relay rule.
func TestRelayTeamBind_ManualBindPlainRelayUnchanged(t *testing.T) {
	rm := newTeamBindManager(t, t.TempDir())
	rm.AddToBind("discord", "room", "lead")
	rm.AddToBind("discord", "room", "worker")
	if err := relaySendOK(t, rm, "ext", "lead", "discord:room:u1"); err != nil {
		t.Fatal("manual /bind channel changed its plain relay rule:", err)
	}
}
