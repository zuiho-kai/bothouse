package discord

import (
	"net/http"
	"net/http/httptest"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/bwmarrin/discordgo"

	"github.com/chenhg5/cc-connect/core"
)

func TestMeetingCommand(t *testing.T) {
	for text, want := range map[string]meetingAction{
		"开会":             meetingStart,
		" 会议助手 ":         meetingStart,
		"开会！":            meetingStart,
		"会议纪要":           meetingEnd,
		"结束。":            meetingEnd,
		"":               meetingNone,
		"明天几点开会":         meetingNone, // a sentence about a meeting goes to the agent
		"把会议纪要发我邮箱":      meetingNone,
		"结束这个任务":         meetingNone,
		"meeting":        meetingNone,
		"开会 讨论一下发布":      meetingNone,
		"会议助手是什么功能":      meetingNone,
		"<@123> 开会":      meetingNone, // another member's mention is left in the text
		"开会\n会议纪要":       meetingNone,
		"\u3000开会\u3000": meetingStart,
	} {
		if got := meetingCommand(text); got != want {
			t.Errorf("meetingCommand(%q) = %v, want %v", text, got, want)
		}
	}
}

func TestMeetingCommandNeedsSwitchAndGuild(t *testing.T) {
	off := &Platform{}
	if off.handleMeetingCommand(nil, testGuildMessage("g1", "<@bot> 开会"), "") {
		t.Fatal("meeting_assistant is off: 开会 must stay an ordinary message")
	}
	on := &Platform{meetingOn: true}
	on.setIdentity("bot", "")
	if on.handleMeetingCommand(nil, testGuildMessage("", "<@bot> 开会"), "") {
		t.Fatal("a DM has no voice channel: not a meeting command")
	}
	// 会议纪要 with no meeting on this server is an ordinary message for the agent
	if on.handleMeetingCommand(nil, testGuildMessage("g1", "<@bot> 会议纪要"), "") {
		t.Fatal("会议纪要 without a meeting must go to the agent")
	}
}

func TestMeetingEveryoneLeft(t *testing.T) {
	mt := &meeting{present: map[string]bool{}, names: map[string]string{}}
	t0 := time.Unix(1000, 0)
	mt.join("a", "阿明", t0)
	mt.join("b", "小红", t0)
	mt.join("a", "阿明", t0) // a second voice state of the same member (mute, deafen) is not a second join
	if len(mt.presence) != 2 {
		t.Fatalf("presence = %d entries, want 2", len(mt.presence))
	}
	if mt.leave("c", t0) {
		t.Fatal("someone who was never in the channel left: the meeting goes on")
	}
	if mt.leave("a", t0.Add(time.Minute)) {
		t.Fatal("b is still there")
	}
	if !mt.leave("b", t0.Add(2*time.Minute)) {
		t.Fatal("everyone but the bot has left: the meeting ends")
	}
	if mt.leave("b", t0.Add(3*time.Minute)) {
		t.Fatal("leaving twice must not end the meeting twice")
	}
}

func TestMeetingTranscript(t *testing.T) {
	start := time.Date(2026, 11, 20, 18, 0, 0, 0, time.Local)
	info := meetingInfo{VoiceName: "会议室", Started: start, Ended: start.Add(65 * time.Minute), Reason: "大家都离开了语音频道"}
	segs := []meetingSegment{
		{UserID: "a", Start: start.Add(5 * time.Second), End: start.Add(9 * time.Second), Text: "小红，发布说明谁来写？"},
		{UserID: "b", Start: start.Add(61 * time.Minute), End: start.Add(61*time.Minute + 4*time.Second), Text: "我来，周五前给。"},
		{UserID: "c", Start: start.Add(62 * time.Minute), End: start.Add(62*time.Minute + time.Second), Text: "好。"},
	}
	presence := []meetingPresence{
		{At: start, UserID: "a", Joined: true},
		{At: start.Add(30 * time.Second), UserID: "b", Joined: true},
		{At: start.Add(64 * time.Minute), UserID: "a", Joined: false},
	}
	shots := []meetingShot{
		{At: start.Add(2 * time.Second), UserID: "b", FileName: "议程.png", N: 1},
		{At: start.Add(61*time.Minute + 30*time.Second), UserID: "a", Text: "看这个数", FileName: "销量.jpg", N: 2},
		{At: start.Add(63 * time.Minute), UserID: "b", FileName: "坏图.png"},
	}
	got := meetingTranscript(info, segs, shots, presence, map[string]string{"a": "阿明", "b": "小红"})
	for _, want := range []string{
		"会议：语音频道「会议室」\n",
		"开始：2026-11-20 18:00:00\n",
		"结束：2026-11-20 19:05:00（大家都离开了语音频道），时长 1:05:00\n",
		"- [00:00] 阿明 在场\n",
		"- [00:30] 小红 进入\n",
		"- [1:04:00] 阿明 离开\n",
		"[00:05–00:09] 阿明：小红，发布说明谁来写？\n",
		"[1:01:00–1:01:04] 小红：我来，周五前给。\n",
		"[1:02:00–1:02:01] c：好。\n", // no name known: the ID
		// pictures stand where they were posted
		"发言：\n[00:02] 小红 发图（图1，议程.png）\n[00:05–00:09] 阿明：",
		"周五前给。\n[1:01:30] 阿明 发图（图2，销量.jpg）：看这个数\n[1:02:00–1:02:01] c：",
		"好。\n[1:03:00] 小红 发图（坏图.png，图片没取到）\n",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("transcript lacks %q:\n%s", want, got)
		}
	}
}

func TestMeetingPrompt(t *testing.T) {
	got := meetingPrompt("[00:05–00:09] 阿明：小红，发布说明谁来写？\n", 0)
	if strings.Contains(got, "发图") {
		t.Errorf("a meeting without pictures must not talk about pictures:\n%s", got)
	}
	withPics := meetingPrompt("[00:02] 小红 发图（图1，议程.png）\n", 2)
	for _, want := range []string{"最后 2 张", "图1 到图2", "某人 发图：画面内容", "出自谁发的图"} {
		if !strings.Contains(withPics, want) {
			t.Errorf("prompt with pictures lacks %q", want)
		}
	}
	for _, want := range []string{
		"<转写稿>\n[00:05–00:09] 阿明：小红，发布说明谁来写？\n</转写稿>",
		"详细记录", "对谁说", "推断",
		"标准纪要", "议题", "结论", "待办", "负责人", "期限", "分歧",
		"记忆或笔记约定",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("prompt lacks %q", want)
		}
	}
}

func TestListenerEventsFillTheMeeting(t *testing.T) {
	p := &Platform{}
	mt := &meeting{guildID: "g1", readyCh: make(chan struct{}), failCh: make(chan string, 1),
		present: map[string]bool{}, names: map[string]string{}}
	p.onListenerEvent(mt, listenerEvent{Op: "error", Message: "could not connect"})
	select {
	case why := <-mt.failCh:
		if why != "could not connect" {
			t.Fatalf("failure = %q", why)
		}
	default:
		t.Fatal("an error before ready must reach startMeeting")
	}
	p.onListenerEvent(mt, listenerEvent{Op: "ready"})
	p.onListenerEvent(mt, listenerEvent{Op: "ready"}) // a reconnect is ready again: no double close
	select {
	case <-mt.readyCh:
	default:
		t.Fatal("ready not signalled")
	}
	p.onListenerEvent(mt, listenerEvent{Op: "segment", UserID: "a", Start: 1000, End: 3000, Text: " 大家好 "})
	p.onListenerEvent(mt, listenerEvent{Op: "segment", UserID: "a", Start: 4000, End: 5000, Text: "  "}) // nothing recognised
	if len(mt.segments) != 1 || mt.segments[0].Text != "大家好" || !mt.segments[0].Start.Equal(time.UnixMilli(1000)) {
		t.Fatalf("segments = %+v", mt.segments)
	}
}

func testGuildMessage(guildID, content string) *discordgo.MessageCreate {
	return &discordgo.MessageCreate{Message: &discordgo.Message{ID: "m1", GuildID: guildID, ChannelID: "c1",
		Content: content, Author: &discordgo.User{ID: "u1", Username: "u1"}}}
}

// A listener that never exits must not hold the meeting: after meetingDrainTimeout it is killed and
// the minutes are written from the segments that had arrived.
func TestEndMeetingKillsStuckListener(t *testing.T) {
	if _, err := exec.LookPath("sh"); err != nil {
		t.Skip("needs sh")
	}
	old := meetingDrainTimeout
	meetingDrainTimeout = 300 * time.Millisecond
	defer func() { meetingDrainTimeout = old }()

	var got *core.Message
	p := &Platform{handler: func(_ core.Platform, m *core.Message) { got = m }}
	p.channelNameCache.Store("c1", "常规")
	mt := &meeting{guildID: "g1", textID: "c1", starterID: "u1", starterName: "u1", startMsgID: "m1",
		voiceName: "常规", startedAt: time.UnixMilli(0), readyCh: make(chan struct{}), failCh: make(chan string, 1),
		present: map[string]bool{}, names: map[string]string{"a": "阿明"}}
	p.meetings = map[string]*meeting{"g1": mt}
	// one segment, then it ignores "leave" and stays
	l, err := p.runVoiceListener(mt, exec.Command("sh", "-c",
		`echo '{"op":"segment","user_id":"a","start":1000,"end":3000,"text":"周五前写完"}'; exec sleep 600`))
	if err != nil {
		t.Fatal(err)
	}
	defer l.kill()
	mt.listener = l
	for deadline := time.Now().Add(20 * time.Second); ; time.Sleep(10 * time.Millisecond) {
		mt.mu.Lock()
		n := len(mt.segments)
		mt.mu.Unlock()
		if n == 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the segment did not arrive")
		}
	}

	done := make(chan struct{})
	go func() {
		p.endMeeting(mt, "大家都离开了语音频道", "")
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(20 * time.Second):
		t.Fatal("endMeeting still waits for a listener that does not exit")
	}
	select {
	case <-l.exited:
	case <-time.After(20 * time.Second):
		t.Fatal("the stuck listener was not killed")
	}
	if p.meetingIn("g1") != nil {
		t.Error("the meeting is still registered")
	}
	if got == nil || !strings.Contains(got.Content, "阿明：周五前写完") {
		t.Fatalf("minutes prompt = %+v", got)
	}
}

func testImageMessage(guildID, channelID string, atts ...*discordgo.MessageAttachment) *discordgo.MessageCreate {
	return &discordgo.MessageCreate{Message: &discordgo.Message{ID: "m2", GuildID: guildID, ChannelID: channelID,
		Content: " 这是议程 ", Author: &discordgo.User{ID: "u2", Username: "xiaohong", GlobalName: "小红"}, Attachments: atts}}
}

// Pictures posted in the meeting's text channel while it is recorded are remembered; anything
// else is not.
func TestNoteMeetingImages(t *testing.T) {
	png := &discordgo.MessageAttachment{Filename: "议程.png", ContentType: "image/png", URL: "u1"}
	noType := &discordgo.MessageAttachment{Filename: "shot", Width: 800, Height: 600, URL: "u2"}
	pdf := &discordgo.MessageAttachment{Filename: "a.pdf", ContentType: "application/pdf", URL: "u3"}
	mt := &meeting{guildID: "g1", textID: "c1", present: map[string]bool{}, names: map[string]string{}}
	p := &Platform{meetingOn: true, meetings: map[string]*meeting{"g1": mt}}

	p.noteMeetingImages(testImageMessage("g1", "c1", png)) // the bot is still connecting
	if len(mt.posts) != 0 {
		t.Fatalf("before the recording started: posts = %+v", mt.posts)
	}
	mt.startedAt = time.Now()
	p.noteMeetingImages(testImageMessage("g1", "c2", png)) // another channel
	p.noteMeetingImages(testImageMessage("g1", "c1", pdf)) // not a picture
	p.noteMeetingImages(testImageMessage("g1", "c1"))      // plain text
	if len(mt.posts) != 0 {
		t.Fatalf("posts = %+v, want none", mt.posts)
	}
	p.noteMeetingImages(testImageMessage("g1", "c1", png, pdf, noType))
	if len(mt.posts) != 1 || len(mt.posts[0].Images) != 2 || mt.posts[0].UserID != "u2" || mt.posts[0].Text != "这是议程" {
		t.Fatalf("posts = %+v", mt.posts)
	}
	if mt.names["u2"] != "小红" {
		t.Errorf("sender name = %q", mt.names["u2"])
	}
	mt.ending = true
	p.noteMeetingImages(testImageMessage("g1", "c1", png))
	if len(mt.posts) != 1 {
		t.Fatal("a picture posted after the meeting ended was taken")
	}
	off := &Platform{meetings: map[string]*meeting{"g1": {guildID: "g1", textID: "c1", startedAt: time.Now(), names: map[string]string{}}}}
	off.noteMeetingImages(testImageMessage("g1", "c1", png))
	if len(off.meetings["g1"].posts) != 0 {
		t.Fatal("meeting_assistant is off")
	}
}

// The pictures of the meeting reach the agent with the minutes prompt, numbered in the transcript
// in the order they are attached; one that cannot be fetched has no number.
func TestEndMeetingHandsOverPictures(t *testing.T) {
	if _, err := exec.LookPath("sh"); err != nil {
		t.Skip("needs sh")
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/gone.png" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte("bytes of " + r.URL.Path))
	}))
	defer srv.Close()

	var got *core.Message
	p := &Platform{meetingOn: true, handler: func(_ core.Platform, m *core.Message) { got = m }}
	p.channelNameCache.Store("c1", "常规")
	start := time.Now().Add(-time.Minute)
	mt := &meeting{guildID: "g1", textID: "c1", starterID: "u1", starterName: "u1", startMsgID: "m1",
		voiceName: "常规", startedAt: start, readyCh: make(chan struct{}), failCh: make(chan string, 1),
		present: map[string]bool{}, names: map[string]string{"a": "阿明", "b": "小红"}}
	mt.segments = []meetingSegment{{UserID: "a", Start: start.Add(20 * time.Second), End: start.Add(23 * time.Second), Text: "看小红发的图"}}
	att := func(name string) *discordgo.MessageAttachment {
		return &discordgo.MessageAttachment{Filename: name, ContentType: "image/png", URL: srv.URL + "/" + name}
	}
	mt.posts = []meetingPost{
		{At: start.Add(10 * time.Second), UserID: "b", Text: "议程", Images: []*discordgo.MessageAttachment{att("gone.png"), att("a.png")}},
		{At: start.Add(30 * time.Second), UserID: "a", Images: []*discordgo.MessageAttachment{att("b.png")}},
	}
	p.meetings = map[string]*meeting{"g1": mt}
	l, err := p.runVoiceListener(mt, exec.Command("sh", "-c", "read line"))
	if err != nil {
		t.Fatal(err)
	}
	defer l.kill()
	mt.listener = l
	p.endMeeting(mt, "大家都离开了语音频道", "")

	if got == nil {
		t.Fatal("no minutes prompt")
	}
	if len(got.Images) != 2 || string(got.Images[0].Data) != "bytes of /a.png" || string(got.Images[1].Data) != "bytes of /b.png" {
		t.Fatalf("images = %+v", got.Images)
	}
	for _, want := range []string{
		"[00:10] 小红 发图（gone.png，图片没取到）：议程\n[00:10] 小红 发图（图1，a.png）：议程\n[00:20–00:23] 阿明：看小红发的图\n[00:30] 阿明 发图（图2，b.png）\n",
		"最后 2 张",
	} {
		if !strings.Contains(got.Content, want) {
			t.Errorf("prompt lacks %q:\n%s", want, got.Content)
		}
	}
}
