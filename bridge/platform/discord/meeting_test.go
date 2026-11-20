package discord

import (
	"strings"
	"testing"
	"time"

	"github.com/bwmarrin/discordgo"
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
	got := meetingTranscript(info, segs, presence, map[string]string{"a": "阿明", "b": "小红"})
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
	} {
		if !strings.Contains(got, want) {
			t.Errorf("transcript lacks %q:\n%s", want, got)
		}
	}
}

func TestMeetingPrompt(t *testing.T) {
	got := meetingPrompt("[00:05–00:09] 阿明：小红，发布说明谁来写？\n")
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
