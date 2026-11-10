package core

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// fakeGH puts a gh on PATH that prints which config dir it was given (and a login for `api user`).
func fakeGH(t *testing.T) {
	t.Helper()
	bin := t.TempDir()
	script := "#!/bin/sh\n" +
		"if [ \"$1\" = api ]; then basename \"$(dirname \"$GH_CONFIG_DIR\")\"; exit 0; fi\n" +
		"echo \"GH_CONFIG_DIR=$GH_CONFIG_DIR TOKEN=${GH_TOKEN:-none}\"\n"
	if err := os.WriteFile(filepath.Join(bin, "gh"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("GH_TOKEN", "shared-token-must-not-leak")
}

func memberTestEngine(t *testing.T) *Engine {
	e := &Engine{name: "lead", dataDir: t.TempDir(), adminFrom: "u-owner"}
	e.SetMemberWorkspaces(true)
	return e
}

// authorize marks a member as authorized the way a finished device login leaves it.
func authorize(t *testing.T, e *Engine, user string) string {
	dir, _, err := ensureMemberDir(e.dataDir, "discord", user, user)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".gh-config", "hosts.yml"), []byte("github.com:\n  user: "+user+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := writeMemberGitHubRecord(dir, memberAuthorizedYes, "gh-"+user, "test"); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestMemberJoinCreatesPrivateDir(t *testing.T) {
	e := memberTestEngine(t)
	p := &stubPlatform{n: "discord"}
	e.OnPlatformEvent(p, PlatformEvent{Name: HookEventMemberJoined, UserID: "u-alice", UserName: "alice"})
	e.OnPlatformEvent(p, PlatformEvent{Name: HookEventMemberJoined, UserID: "u-bot", UserName: "bot", Bot: true})
	dir, _ := MemberWorkspaceDir(e.dataDir, "discord", "u-alice")
	for _, d := range []string{dir, filepath.Join(dir, ".gh-config"), filepath.Join(e.dataDir, memberDirName)} {
		st, err := os.Stat(d)
		if err != nil {
			t.Fatalf("%s: %v", d, err)
		}
		if st.Mode().Perm() != 0o700 {
			t.Fatalf("%s mode %v, want 0700", d, st.Mode().Perm())
		}
	}
	if bot, _ := MemberWorkspaceDir(e.dataDir, "discord", "u-bot"); fileExists(bot) {
		t.Fatal("a bot got a member directory")
	}
	off := &Engine{name: "x", dataDir: t.TempDir()}
	off.OnPlatformEvent(p, PlatformEvent{Name: HookEventMemberJoined, UserID: "u-carol"})
	if d, _ := MemberWorkspaceDir(off.dataDir, "discord", "u-carol"); fileExists(d) {
		t.Fatal("directory created with member_workspaces off")
	}
}

func TestMemberJoinPrompt(t *testing.T) {
	ev := PlatformEvent{UserID: "42", UserName: "alice", GuildName: "g"}
	ask := memberJoinPrompt(ev, "已创建个人目录", false, "")
	if !strings.Contains(ask, "<@42>") || !strings.Contains(ask, "已创建个人目录") || !strings.Contains(ask, "bothouse member login") {
		t.Fatalf("prompt: %s", ask)
	}
	done := memberJoinPrompt(ev, "已确认个人目录存在", true, "gh-alice")
	if strings.Contains(done, "member login") || !strings.Contains(done, "不要再问") {
		t.Fatalf("authorized prompt still asks: %s", done)
	}
}

func TestMemberGHUsesCallersOwnAuth(t *testing.T) {
	fakeGH(t)
	e := memberTestEngine(t)
	aDir := authorize(t, e, "u-alice")
	bDir := authorize(t, e, "u-bob")

	e.noteCallerTurn("discord:c1", "discord", "u-alice", "alice", "c1", false, false, false)
	resp, _ := e.memberOp(context.Background(), MemberRequest{Session: "discord:c1", Op: "gh", Args: []string{"auth", "status"}})
	if resp.Exit != 0 || !strings.Contains(resp.Stdout, filepath.Join(aDir, ".gh-config")) {
		t.Fatalf("alice's turn: %+v", resp)
	}
	if strings.Contains(resp.Stdout, bDir) || strings.Contains(resp.Stdout, "shared-token") {
		t.Fatalf("alice's turn saw bob's dir or the shared token: %+v", resp)
	}

	// Same session, bob talks next: his turn uses his own authorization.
	e.noteCallerTurn("discord:c1", "discord", "u-bob", "bob", "c1", false, false, false)
	resp, _ = e.memberOp(context.Background(), MemberRequest{Session: "discord:c1", Op: "gh", Args: []string{"auth", "status"}})
	if !strings.Contains(resp.Stdout, filepath.Join(bDir, ".gh-config")) || strings.Contains(resp.Stdout, aDir) {
		t.Fatalf("bob's turn: %+v", resp)
	}

	// carol has no authorization of her own: refused, nobody else's is borrowed.
	e.noteCallerTurn("discord:c1", "discord", "u-carol", "carol", "c1", false, false, false)
	resp, status := e.memberOp(context.Background(), MemberRequest{Session: "discord:c1", Op: "gh", Args: []string{"auth", "status"}})
	if resp.Exit == 0 || status != 409 || resp.Stdout != "" {
		t.Fatalf("carol without auth: %d %+v", status, resp)
	}
}

func TestMemberRefusesNonHumanTurns(t *testing.T) {
	fakeGH(t)
	e := memberTestEngine(t)
	authorize(t, e, "u-alice")
	if r, st := e.memberOp(context.Background(), MemberRequest{Session: "discord:c1", Op: "gh"}); st != 403 || r.Exit == 0 {
		t.Fatalf("no turn: %d %+v", st, r)
	}
	for name, turn := range map[string][3]bool{"bot": {true, false, false}, "timer": {false, true, false}, "local": {false, false, true}} {
		e.noteCallerTurn("discord:c1", "discord", "u-alice", "alice", "c1", turn[0], turn[1], turn[2])
		if r, st := e.memberOp(context.Background(), MemberRequest{Session: "discord:c1", Op: "gh", Args: []string{"auth", "status"}}); st != 403 || r.Stdout != "" {
			t.Fatalf("%s turn ran gh: %d %+v", name, st, r)
		}
	}
}

func TestMemberEnableOnlyByOwner(t *testing.T) {
	e := &Engine{name: "lead", dataDir: t.TempDir(), adminFrom: "u-owner"}
	saved := []bool{}
	e.SetMemberWorkspacesSaver(func(on bool) error { saved = append(saved, on); return nil })
	e.noteCallerTurn("discord:c1", "discord", "u-alice", "alice", "c1", false, false, false)
	if r, st := e.memberOp(context.Background(), MemberRequest{Session: "discord:c1", Op: "enable"}); st != 403 || e.MemberWorkspacesOn() {
		t.Fatalf("non-owner enabled: %d %+v", st, r)
	}
	if r, _ := e.memberOp(context.Background(), MemberRequest{Session: "discord:c1", Op: "status"}); r.Exit == 0 {
		t.Fatalf("status with feature off: %+v", r)
	}
	e.noteCallerTurn("discord:c1", "discord", "u-owner", "owner", "c1", false, false, false)
	if r, st := e.memberOp(context.Background(), MemberRequest{Session: "discord:c1", Op: "enable"}); st != 200 || !e.MemberWorkspacesOn() || len(saved) != 1 || !saved[0] {
		t.Fatalf("owner enable: %d %+v saved=%v", st, r, saved)
	}
}

func TestMemberLeftDropsCredentials(t *testing.T) {
	e := memberTestEngine(t)
	dir := authorize(t, e, "u-alice")
	if err := os.WriteFile(filepath.Join(dir, "files", "notes.md"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	e.OnPlatformEvent(&stubPlatform{n: "discord"}, PlatformEvent{Name: HookEventMemberLeft, UserID: "u-alice"})
	if fileExists(filepath.Join(dir, ".gh-config", "hosts.yml")) {
		t.Fatal("credentials kept after leaving")
	}
	if ok, _ := memberAuthorized(dir); ok {
		t.Fatal("still authorized after leaving")
	}
	if !fileExists(filepath.Join(dir, "files", "notes.md")) {
		t.Fatal("member's files deleted on leave")
	}
}

func TestMemberDirRejectsBadIDs(t *testing.T) {
	for _, id := range []string{"", "..", "a/b", "a\\b", "x\n"} {
		if _, err := MemberWorkspaceDir(t.TempDir(), "discord", id); err == nil {
			t.Fatalf("accepted %q", id)
		}
	}
}

func TestWizardMemberWorkspacesOnlyForTeamWhenTicked(t *testing.T) {
	noHardware(t)
	t1, t2 := fakeToken("111"), fakeToken("222")
	fakeDiscord(t, map[string]string{t1: "Juzi", t2: "Whale"})
	run := func(roles []WizardRole, on *bool) *memStore {
		store := newMemStore()
		req := WizardRequest{Platform: "discord", Language: "zh", Roles: roles, MemberWorkspaces: on, Gate: &WizardGate{}}
		req.Discord = &struct {
			GuildID   string `json:"guild_id"`
			ChannelID string `json:"channel_id"`
		}{GuildID: "900", ChannelID: "1"}
		if res := ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: t.TempDir(), CLIs: testCLIs}, req); !res.OK {
			t.Fatalf("apply failed: %+v", res)
		}
		return store
	}
	yes := true
	team := []WizardRole{{Token: t1}, {Token: t2}}
	for _, p := range run(team, &yes).projects {
		if p.MemberWorkspaces == nil || !*p.MemberWorkspaces {
			t.Fatalf("team with the box ticked: %s has no member_workspaces", p.Name)
		}
	}
	for _, p := range run(team, nil).projects {
		if p.MemberWorkspaces != nil {
			t.Fatalf("box not ticked but %s got member_workspaces", p.Name)
		}
	}
	for _, p := range run([]WizardRole{{Token: t1}}, &yes).projects {
		if p.MemberWorkspaces != nil {
			t.Fatalf("a single role got member_workspaces")
		}
	}
}

func TestMemberBlockOncePerContext(t *testing.T) {
	e := &Engine{name: "lead", dataDir: t.TempDir()}
	s := &Session{}
	if got := e.memberBlock(s); got != memberNoteOffer {
		t.Fatalf("off, no team: want the recommendation, got %q", got)
	}
	if got := e.memberBlock(s); got != "" {
		t.Fatalf("recommendation repeated in the same context: %q", got)
	}
	e.SetMemberWorkspaces(true)
	if got := e.memberBlock(s); got != memberNoteOn {
		t.Fatalf("turned on: want the usage note, got %q", got)
	}
	if got := e.memberBlock(s); got != "" {
		t.Fatalf("usage note repeated: %q", got)
	}
}

// #1355 rework: the device code goes to the person only — DM, or a private thread when the DM is
// refused — and is never posted to the channel; a stranger to the server gets nothing.
func TestMemberCodeOnlyToThePerson(t *testing.T) {
	p, api := refusingFixture(false)
	e := api.engines["p"]
	turn := callerTurn{platform: "discord", userID: dmMember, kind: CallerHuman}
	where, err := e.sendMemberPrivately(turn, dmFrom, "你的 GitHub 设备码：ABCD-1234")
	if err != nil || !strings.Contains(where, "私密子话题") {
		t.Fatalf("refused DM: %q %v", where, err)
	}
	if len(p.threadSent) != 1 || !strings.HasPrefix(p.threadSent[0], "<@"+dmMember+"> ") {
		t.Fatalf("thread got %v", p.threadSent)
	}

	p2, api2 := refusingFixture(true) // no private thread possible either
	if _, err := api2.engines["p"].sendMemberPrivately(turn, dmFrom, "ABCD-1234"); err == nil || len(p2.threadSent) != 0 {
		t.Fatalf("must fail without sending anything: %v %v", err, p2.threadSent)
	}

	p3, api3 := refusingFixture(false)
	stranger := callerTurn{platform: "discord", userID: dmStranger, kind: CallerHuman}
	if _, err := api3.engines["p"].sendMemberPrivately(stranger, dmFrom, "ABCD-1234"); err == nil || len(p3.threadSent) != 0 || len(p3.threadFor) != 0 {
		t.Fatalf("stranger: %v sent=%v threads=%v", err, p3.threadSent, p3.threadFor)
	}
}
