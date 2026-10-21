package core

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"
)

type deskPost struct{ chat, content, mention string }

type deskPlatform struct {
	stubPlatformEngine
	mention string
	postErr error // returned after recording the post, like a reply lost after delivery
	pmu     sync.Mutex
	posts   []deskPost
}

func (p *deskPlatform) SelfMention() string { return p.mention }

func (p *deskPlatform) PostToChat(_ context.Context, sessionKey, content, mentionUser string) error {
	p.pmu.Lock()
	defer p.pmu.Unlock()
	p.posts = append(p.posts, deskPost{sessionKey, content, mentionUser})
	return p.postErr
}

func (p *deskPlatform) getPosts() []deskPost {
	p.pmu.Lock()
	defer p.pmu.Unlock()
	return append([]deskPost(nil), p.posts...)
}

func newDeskPlatform(mention string) *deskPlatform {
	return &deskPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}, mention: mention}
}

func deskFiles(now time.Time) []teamFile {
	return []teamFile{
		{Project: "gge", Name: "G哥", Mention: "<@1>", Updated: now, Sessions: []teamEntry{
			{Key: "discord:fw:9", Chat: "固件", Task: "测帧率", Busy: true, Since: now.Add(-3 * time.Minute)},
			{Key: "discord:old", Chat: "杂项", Task: "旧活", DoneAt: now.Add(-5 * time.Minute)},
		}},
		{Project: "deep", Name: "肥鱼", Mention: "<@2>", Updated: now, Sessions: []teamEntry{
			{Key: "discord:b", Chat: "桥接", Task: "看日志", DoneAt: now.Add(-2 * time.Minute)},
			{Key: "discord:dm", Task: "私密的事", Busy: true, Since: now},
		}},
		{Project: "cursor", Name: "Cursor", Mention: "<@4>", Updated: now, Sessions: []teamEntry{
			{Key: "discord:x", Chat: "甲", DoneAt: now.Add(-2 * time.Minute)},
			{Key: "discord:y", Chat: "乙", DoneAt: now.Add(-4 * time.Minute)},
		}},
		{Project: "gjiang", Name: "大豆包", Updated: now},
	}
}

func useDeskFiles(t *testing.T, e *Engine, files []teamFile) {
	t.Helper()
	dir := t.TempDir()
	e.team = &teamState{dir: dir, name: e.name, seen: map[string]*teamSession{}}
	for _, f := range files {
		writeTeamFile(t, dir, f)
	}
	e.SetVoiceDesk(true)
}

func TestRenderVoiceDeskBrief(t *testing.T) {
	got := renderVoiceDeskBrief(deskFiles(time.Now()), time.Now())
	for _, want := range []string{"G哥（to=gge）", "#固件 chat=discord:fw", "「测帧率」", "大豆包（to=gjiang）：空闲", "<待转达 to=", "说「对」才真正发送"} {
		if !strings.Contains(got, want) {
			t.Errorf("brief missing %q:\n%s", want, got)
		}
	}
	if strings.Contains(got, "私密的事") {
		t.Fatalf("private chat task leaked:\n%s", got)
	}
}

func TestIsVoiceConfirm(t *testing.T) {
	for msg, want := range map[string]bool{
		"对": true, "对的。": true, "好的，发吧": true, "确认": true, "OK": true, "嗯": true, "没错": true,
		"不对": false, "别发": false, "等一下": false, "取消": false, "对了，还有件事要你帮我查一下": false,
		"对了查下进度": false, "发给谁": false, "可以改成明天吗": false, "确认一下内容": false,
		"现在大家在做什么？": false, "": false,
	} {
		if got := isVoiceConfirm(msg); got != want {
			t.Errorf("isVoiceConfirm(%q) = %v, want %v", msg, got, want)
		}
	}
}

func TestParseVoiceProposals(t *testing.T) {
	clean, d := parseVoiceProposals("好。\n<待转达 to=\"gge\" chat=\"discord:fw\">把帧率结果写进交接</待转达>")
	if clean != "好。" || d == nil || *d != (voiceDispatch{To: "gge", Chat: "discord:fw", Text: "把帧率结果写进交接"}) {
		t.Fatalf("clean=%q d=%+v", clean, d)
	}
	// A direct send tag (old protocol or invented) is stripped and never becomes a proposal.
	if clean, d := parseVoiceProposals(`已转达。<转达 to="gge">继续</转达>`); d != nil || clean != "已转达。继续" {
		t.Fatalf("send tag: clean=%q d=%+v", clean, d)
	}
	if _, d := parseVoiceProposals(`<待转达 to="gge">  </待转达>`); d != nil {
		t.Fatal("empty instruction proposed")
	}
}

func TestResolveVoiceDispatch(t *testing.T) {
	files := deskFiles(time.Now())
	ok := []struct {
		d    voiceDispatch
		chat string
	}{
		{voiceDispatch{To: "gge"}, "discord:fw"},                      // the only busy channel
		{voiceDispatch{To: "G哥", Chat: "discord:old"}, "discord:old"}, // named chat, by display name
		{voiceDispatch{To: "deep"}, "discord:b"},                      // only recent channel; private chat skipped
	}
	for _, c := range ok {
		p, err := resolveVoiceDispatch(files, c.d)
		if err != nil || p.Chat != c.chat || p.Mention == "" {
			t.Errorf("%+v: got %+v, %v", c.d, p, err)
		}
	}
	bad := []struct {
		d   voiceDispatch
		sub string
	}{
		{voiceDispatch{To: "cursor"}, "同时在#乙、#甲"},              // two recent channels: ask, don't guess
		{voiceDispatch{To: "deep", Chat: "discord:zzz"}, "不在"}, // never another chat than the named one
		{voiceDispatch{To: "gjiang"}, "@ 不到"},
		{voiceDispatch{To: "nobody"}, "没找到"},
	}
	for _, c := range bad {
		if _, err := resolveVoiceDispatch(files, c.d); err == nil || !strings.Contains(err.Error(), c.sub) {
			t.Errorf("%+v: err=%v, want %q", c.d, err, c.sub)
		}
	}
	// G哥 busy in two channels at once (review #212): ambiguous, not the first one.
	files[0].Sessions = append(files[0].Sessions, teamEntry{Key: "discord:second", Chat: "另一件事", Busy: true, Since: time.Now()})
	if p, err := resolveVoiceDispatch(files, voiceDispatch{To: "gge", Text: "继续"}); err == nil {
		t.Fatalf("two busy channels silently resolved to %q", p.Chat)
	}
}

// voiceDeskTurn runs one voice turn through the real relay path and returns the spoken text.
func voiceDeskTurn(t *testing.T, rm *RelayManager, a *voiceAgentFake, id, message, answer string) string {
	t.Helper()
	req := voiceReq(id)
	// As companion/voice sends it: entry prompt + words in message, the words alone in user_text.
	req.Message = "[用户从电脑语音入口发言，请接续当前会话，用适合朗读的简短中文回答。]\n" + message
	req.UserText = message
	if _, _, err := rm.submitVoice(req); err != nil {
		t.Fatal(err)
	}
	s := <-a.sessions
	<-s.prompts
	s.events <- Event{Type: EventResult, Done: true, Content: answer}
	r := voiceWait(t, rm, id)
	if r.Status != "completed" {
		t.Fatalf("%s: status %s (%s)", id, r.Status, r.Error)
	}
	return r.Text
}

func TestVoiceDeskSendsOnlyAfterConfirmation(t *testing.T) {
	rm, _, a, _ := voiceFixture(t, t.TempDir())
	e := rm.engines["target"]
	p := newDeskPlatform("<@9>")
	e.platforms = append(e.platforms, p)
	useDeskFiles(t, e, deskFiles(time.Now()))

	// A query-only turn whose answer claims a send (review #212) sends nothing.
	voiceDeskTurn(t, rm, a, "q", "现在大家在做什么？", `已转达。<转达 to="gge" chat="discord:fw">继续测试</转达>`)
	if len(p.getPosts()) != 0 {
		t.Fatalf("unconfirmed send: %+v", p.getPosts())
	}

	spoken := voiceDeskTurn(t, rm, a, "p1", "告诉G哥把帧率结果写进交接", "好。\n<待转达 to=\"gge\">把帧率结果写进交接</待转达>")
	if len(p.getPosts()) != 0 || !strings.Contains(spoken, "要我转给G哥，在#固件：「把帧率结果写进交接」") || strings.Contains(spoken, "<待转达") {
		t.Fatalf("proposal must only be read back: spoken=%q posts=%+v", spoken, p.getPosts())
	}
	// The model's text on the confirming turn cannot change what is sent.
	spoken = voiceDeskTurn(t, rm, a, "c1", "对", `好的。<待转达 to="deep">别的事</待转达>`)
	posts := p.getPosts()
	if len(posts) != 1 || posts[0] != (deskPost{"discord:fw", "<@1> 【语音转达】主人：把帧率结果写进交接", "<@1>"}) {
		t.Fatalf("posts = %+v", posts)
	}
	if !strings.Contains(spoken, "已转达给G哥（#固件）") {
		t.Fatalf("spoken = %q", spoken)
	}

	// Anything but a yes drops the proposal; a later yes sends nothing.
	before := len(p.getPosts())
	voiceDeskTurn(t, rm, a, "p2", "告诉G哥测温升", `<待转达 to="gge">测温升</待转达>`)
	voiceDeskTurn(t, rm, a, "n1", "不对，等一下", "好的。")
	voiceDeskTurn(t, rm, a, "c3", "对", "嗯。")
	if got := len(p.getPosts()); got != before {
		t.Fatalf("declined proposal was sent later: %+v", p.getPosts()[before:])
	}
}

func TestVoiceDeskAmbiguousProposalAsks(t *testing.T) {
	rm, _, a, _ := voiceFixture(t, t.TempDir())
	e := rm.engines["target"]
	p := newDeskPlatform("<@9>")
	e.platforms = append(e.platforms, p)
	useDeskFiles(t, e, deskFiles(time.Now()))
	spoken := voiceDeskTurn(t, rm, a, "p", "告诉Cursor继续", `<待转达 to="cursor">继续</待转达>`)
	voiceDeskTurn(t, rm, a, "c", "对", "好。")
	if len(p.getPosts()) != 0 || !strings.Contains(spoken, "要转到哪个频道") {
		t.Fatalf("spoken=%q posts=%+v", spoken, p.getPosts())
	}
}

func TestVoiceDeskCancelledContextDoesNotPost(t *testing.T) {
	p := newDeskPlatform("<@9>")
	e := NewEngine("cjiang", &stubAgent{}, []Platform{p}, "", LangEnglish)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	pend, err := resolveVoiceDispatch(deskFiles(time.Now()), voiceDispatch{To: "gge", Text: "继续"})
	if err != nil {
		t.Fatal(err)
	}
	if spoken := e.sendVoicePending(ctx, pend); len(p.getPosts()) != 0 || !strings.Contains(spoken, "没有成功") {
		t.Fatalf("cancelled hand-off: spoken=%q posts=%+v", spoken, p.getPosts())
	}
}

func TestVoiceDeskSelfHandoff(t *testing.T) {
	pend, err := resolveVoiceDispatch(deskFiles(time.Now()), voiceDispatch{To: "gge", Text: "接着测温升"})
	if err != nil {
		t.Fatal(err)
	}

	// No other bot can post for us: fail, never a self-send the platform would ignore.
	alone := newDeskPlatform("<@1>")
	e := NewEngine("gge", &stubAgent{}, []Platform{alone}, "", LangEnglish)
	if spoken := e.sendVoicePending(context.Background(), pend); len(alone.getPosts()) != 0 || !strings.Contains(spoken, "没有成功") {
		t.Fatalf("self-send without alternate: spoken=%q posts=%+v", spoken, alone.getPosts())
	}

	self, other := newDeskPlatform("<@1>"), newDeskPlatform("<@3>")
	e = NewEngine("gge", &stubAgent{}, []Platform{self}, "", LangEnglish)
	o := NewEngine("cjiang", &stubAgent{}, []Platform{other}, "", LangEnglish)
	rm := NewRelayManager(t.TempDir())
	rm.RegisterEngine("gge", e)
	rm.RegisterEngine("cjiang", o)
	e.SetRelayManager(rm)
	if spoken := e.sendVoicePending(context.Background(), pend); len(self.getPosts()) != 0 || len(other.getPosts()) != 1 || !strings.Contains(spoken, "已转达") {
		t.Fatalf("self hand-off: spoken=%q self=%+v other=%+v", spoken, self.getPosts(), other.getPosts())
	}
}

func TestVoiceDeskOffLeavesAnswerAlone(t *testing.T) {
	e := NewEngine("cjiang", &stubAgent{}, []Platform{newDeskPlatform("<@9>")}, "", LangEnglish)
	if got := e.withVoiceDesk("现在都在干啥"); got != "现在都在干啥" {
		t.Fatal("voice desk must be off by default")
	}
	ans := `好。<待转达 to="gge">x</待转达>`
	if got := e.finishVoiceDesk(context.Background(), "k", ans, nil); got != ans {
		t.Fatalf("off: %q", got)
	}
}

func TestVoiceDeskNeedsOwnersOwnWords(t *testing.T) {
	rm, _, a, _ := voiceFixture(t, t.TempDir())
	e := rm.engines["target"]
	p := newDeskPlatform("<@9>")
	e.platforms = append(e.platforms, p)
	useDeskFiles(t, e, deskFiles(time.Now()))
	voiceDeskTurn(t, rm, a, "p", "告诉G哥测温升", `<待转达 to="gge">测温升</待转达>`)
	// A "对" that is only inside the prompt (no user_text) cannot confirm.
	req := voiceReq("c")
	req.Message = "[语音入口]\n对"
	if _, _, err := rm.submitVoice(req); err != nil {
		t.Fatal(err)
	}
	s := <-a.sessions
	<-s.prompts
	s.events <- Event{Type: EventResult, Done: true, Content: "好。"}
	voiceWait(t, rm, "c")
	if len(p.getPosts()) != 0 {
		t.Fatalf("confirmed without the owner's own words: %+v", p.getPosts())
	}
	if voiceUserText(RelayRequest{Message: "abc", UserText: "对"}) != "" {
		t.Fatal("user_text that is not part of the message must be ignored")
	}
}

func TestVoiceDeskLostAckIsUnknown(t *testing.T) {
	pend, err := resolveVoiceDispatch(deskFiles(time.Now()), voiceDispatch{To: "gge", Text: "继续"})
	if err != nil {
		t.Fatal(err)
	}
	p := newDeskPlatform("<@9>")
	p.postErr = fmt.Errorf("discord: post to chat: %w: unexpected EOF", ErrPostOutcomeUnknown)
	e := NewEngine("cjiang", &stubAgent{}, []Platform{p}, "", LangEnglish)
	spoken := e.sendVoicePending(context.Background(), pend)
	if !strings.Contains(spoken, "不确定发出去没有") || !strings.Contains(spoken, "别重复说") || strings.Contains(spoken, "没有成功") {
		t.Fatalf("spoken = %q", spoken)
	}
}
