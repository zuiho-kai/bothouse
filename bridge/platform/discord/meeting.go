package discord

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/bwmarrin/discordgo"
	"github.com/chenhg5/cc-connect/core"
)

// Meeting assistant (meeting_assistant = true, off by default).
//
// "@bot 开会" / "@bot 会议助手" in a text channel: the bot joins the voice channel the caller is
// in and records who says what. When everyone else has left that voice channel, or someone says
// "@bot 会议纪要" / "@bot 结束", it leaves and hands the transcript to the agent of that text
// channel, which answers with a detailed record and standard minutes.
//
// The bridge keeps its single gateway connection: it only sends the voice state updates (op 4)
// and relays its own VOICE_STATE_UPDATE / VOICE_SERVER_UPDATE to a small Node process
// (contrib/discord-voice, meeting_listener.go) that owns the voice connection. discordgo cannot
// be used for it: Discord requires DAVE end-to-end encryption on voice channels and discordgo
// v0.29 does not implement it. discordgo does not connect by itself either: its
// onVoiceServerUpdate returns when Session.VoiceConnections has no entry for the guild, and
// ChannelVoiceJoinManual never adds one.
//
// Audio is never stored: the listener transcribes each stretch of speech and deletes the wav.

// defaultMeetingASRPython: the python that has mlx_whisper, for contrib/discord-voice/asr_worker.py.
const defaultMeetingASRPython = "~/ai-voice/voice-train/.venv-asr/bin/python"

type meetingAction int

const (
	meetingNone meetingAction = iota
	meetingStart
	meetingEnd
)

// meetingCommand reads the text left after the @: only the bare words count, so a sentence that
// merely contains "开会" still goes to the agent.
func meetingCommand(text string) meetingAction {
	text = strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) || unicode.IsPunct(r) || unicode.IsSymbol(r) {
			return -1
		}
		return r
	}, text)
	switch text {
	case "开会", "会议助手":
		return meetingStart
	case "会议纪要", "结束":
		return meetingEnd
	}
	return meetingNone
}

type meetingSegment struct {
	UserID     string
	Start, End time.Time
	Text       string
}

type meetingPresence struct {
	At     time.Time
	UserID string
	Joined bool
}

type meeting struct {
	guildID     string
	textID      string // where it was called and where the minutes go
	starterID   string
	starterName string
	startMsgID  string
	readyCh     chan struct{} // closed when the listener is connected to the voice channel
	failCh      chan string   // the listener failed before it was ready

	mu        sync.Mutex
	listener  *voiceListener
	voiceID   string
	voiceName string
	startedAt time.Time // zero until ready
	ending    bool
	present   map[string]bool   // members in the voice channel now, the bot excluded
	names     map[string]string // user ID → display name
	segments  []meetingSegment
	presence  []meetingPresence
}

func (mt *meeting) theListener() *voiceListener {
	mt.mu.Lock()
	defer mt.mu.Unlock()
	return mt.listener
}

func memberDisplayName(m *discordgo.Member) string {
	if m == nil {
		return ""
	}
	if m.Nick != "" {
		return m.Nick
	}
	if m.User == nil {
		return ""
	}
	if m.User.GlobalName != "" {
		return m.User.GlobalName
	}
	return m.User.Username
}

// meetingMemberName returns the server display name of a member (nickname, else global name,
// else username).
func (p *Platform) meetingMemberName(s *discordgo.Session, guildID, userID string) string {
	if s == nil {
		return userID
	}
	if m, err := s.State.Member(guildID, userID); err == nil {
		if n := memberDisplayName(m); n != "" {
			return n
		}
	}
	if m, err := s.GuildMember(guildID, userID); err == nil {
		if n := memberDisplayName(m); n != "" {
			return n
		}
	}
	return userID
}

func (p *Platform) liveSession() *discordgo.Session {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.session
}

func (p *Platform) meetingIn(guildID string) *meeting {
	p.meetingMu.Lock()
	defer p.meetingMu.Unlock()
	return p.meetings[guildID]
}

func (p *Platform) forgetMeeting(mt *meeting) {
	p.meetingMu.Lock()
	defer p.meetingMu.Unlock()
	if p.meetings[mt.guildID] == mt {
		delete(p.meetings, mt.guildID)
	}
}

func (p *Platform) meetingSay(channelID, text string) {
	if err := p.Send(context.Background(), replyContext{channelID: channelID}, text); err != nil {
		slog.Warn("discord: meeting notice not sent", "channel", channelID, "error", err)
	}
}

// voiceStateOp4 sends the gateway voice state update; channelID "" leaves the voice channel.
func voiceStateOp4(s *discordgo.Session, guildID, channelID string, mute, deaf bool) (err error) {
	if s == nil {
		return fmt.Errorf("discord session is not ready")
	}
	defer func() { // ChannelVoiceJoinManual dereferences the websocket without checking it
		if r := recover(); r != nil {
			err = fmt.Errorf("gateway is not connected")
		}
	}()
	return s.ChannelVoiceJoinManual(guildID, channelID, mute, deaf)
}

// handleMeetingCommand takes "@bot 开会 / 会议助手" and, while a meeting is being recorded on this
// server, "@bot 会议纪要 / 结束". It reports whether the message was a meeting command.
func (p *Platform) handleMeetingCommand(s *discordgo.Session, m *discordgo.MessageCreate, botRoleID string) bool {
	if !p.meetingOn || m.GuildID == "" {
		return false
	}
	switch meetingCommand(stripDiscordMentionWithRole(m.Content, p.selfID(), botRoleID)) {
	case meetingStart:
		go p.startMeeting(s, m)
		return true
	case meetingEnd:
		mt := p.meetingIn(m.GuildID)
		if mt == nil {
			return false // nothing is being recorded: an ordinary message for the agent
		}
		go p.endMeeting(mt, "有人要了会议纪要", m.ID)
		return true
	}
	return false
}

func (p *Platform) startMeeting(s *discordgo.Session, m *discordgo.MessageCreate) {
	voiceID := ""
	if vs, err := s.State.VoiceState(m.GuildID, m.Author.ID); err == nil && vs != nil {
		voiceID = vs.ChannelID
	}
	if voiceID == "" {
		p.meetingSay(m.ChannelID, "你还没进语音频道。先进一个语音频道，再 @ 我说「开会」。")
		return
	}
	voiceName := voiceID
	if c, err := s.State.Channel(voiceID); err == nil && c != nil && c.Name != "" {
		voiceName = c.Name
	}
	mt := &meeting{
		guildID: m.GuildID, textID: m.ChannelID, voiceID: voiceID, voiceName: voiceName,
		starterID: m.Author.ID, starterName: m.Author.Username, startMsgID: m.ID,
		readyCh: make(chan struct{}), failCh: make(chan string, 1),
		present: map[string]bool{}, names: map[string]string{},
	}
	p.meetingMu.Lock()
	if cur := p.meetings[m.GuildID]; cur != nil {
		p.meetingMu.Unlock()
		cur.mu.Lock()
		name := cur.voiceName
		cur.mu.Unlock()
		p.meetingSay(m.ChannelID, "已经在语音频道「"+name+"」记录会议了。@ 我说「会议纪要」就结束并出纪要。")
		return
	}
	if p.meetings == nil {
		p.meetings = map[string]*meeting{}
	}
	p.meetings[m.GuildID] = mt
	p.meetingMu.Unlock()

	fail := func(why string) {
		p.forgetMeeting(mt)
		mt.theListener().kill()
		_ = voiceStateOp4(p.liveSession(), m.GuildID, "", false, false)
		slog.Warn("discord: meeting did not start", "guild", m.GuildID, "voice", voiceID, "reason", why)
		p.meetingSay(m.ChannelID, "没能进语音频道记录："+why)
	}

	// who is already there
	now := time.Now()
	if g, err := s.State.Guild(m.GuildID); err == nil && g != nil {
		s.State.RLock()
		var there []string
		for _, vs := range g.VoiceStates {
			if vs != nil && vs.ChannelID == voiceID && vs.UserID != p.selfID() {
				there = append(there, vs.UserID)
			}
		}
		s.State.RUnlock()
		for _, id := range there {
			mt.join(id, p.meetingMemberName(s, m.GuildID, id), now)
		}
	}

	l, err := p.startVoiceListener(mt)
	if err != nil {
		fail(err.Error())
		return
	}
	mt.mu.Lock()
	mt.listener = l
	mt.mu.Unlock()
	if err := l.send(map[string]any{"op": "join", "guild_id": m.GuildID, "channel_id": voiceID}); err != nil {
		fail(err.Error())
		return
	}
	select { // the listener gives up by itself when it cannot connect, so there is no timer here
	case <-mt.readyCh:
	case why := <-mt.failCh:
		fail(why)
		return
	case <-l.exited:
		fail("语音组件退出了")
		return
	}
	mt.mu.Lock()
	mt.startedAt = time.Now()
	for i := range mt.presence { // people who were there before the recording started
		if mt.presence[i].At.Before(mt.startedAt) {
			mt.presence[i].At = mt.startedAt
		}
	}
	empty := len(mt.present) == 0
	name := mt.voiceName
	mt.mu.Unlock()
	slog.Info("discord: meeting started", "guild", m.GuildID, "voice", voiceID, "text", m.ChannelID)
	p.meetingSay(m.ChannelID, "已进入语音频道「"+name+"」，开始记录会议。大家都离开语音频道，或者 @ 我说「会议纪要」，我就退出并发出详细记录和标准纪要。")
	if empty { // everyone left while the bot was connecting
		go p.endMeeting(mt, "大家都离开了语音频道", "")
	}
}

func (mt *meeting) join(userID, name string, at time.Time) {
	mt.mu.Lock()
	defer mt.mu.Unlock()
	if name != "" {
		mt.names[userID] = name
	}
	if mt.present[userID] {
		return
	}
	mt.present[userID] = true
	mt.presence = append(mt.presence, meetingPresence{At: at, UserID: userID, Joined: true})
}

// leave reports whether nobody but the bot is left.
func (mt *meeting) leave(userID string, at time.Time) (empty bool) {
	mt.mu.Lock()
	defer mt.mu.Unlock()
	if !mt.present[userID] {
		return false
	}
	delete(mt.present, userID)
	mt.presence = append(mt.presence, meetingPresence{At: at, UserID: userID, Joined: false})
	return len(mt.present) == 0
}

// meetingVoiceState follows who is in the meeting's voice channel and relays the bot's own
// voice state to the listener.
func (p *Platform) meetingVoiceState(s *discordgo.Session, v *discordgo.VoiceStateUpdate) {
	if !p.meetingOn {
		return
	}
	mt := p.meetingIn(v.GuildID)
	if mt == nil {
		return
	}
	if v.UserID == p.selfID() {
		if l := mt.theListener(); l != nil {
			_ = l.send(map[string]any{"op": "voice_state", "d": v.VoiceState})
		}
		return
	}
	mt.mu.Lock()
	voiceID, started := mt.voiceID, !mt.startedAt.IsZero()
	mt.mu.Unlock()
	if v.ChannelID == voiceID {
		name := memberDisplayName(v.Member)
		if name == "" {
			name = p.meetingMemberName(s, v.GuildID, v.UserID)
		}
		mt.join(v.UserID, name, time.Now())
		return
	}
	if mt.leave(v.UserID, time.Now()) && started {
		go p.endMeeting(mt, "大家都离开了语音频道", "")
	}
}

func (p *Platform) meetingVoiceServer(_ *discordgo.Session, v *discordgo.VoiceServerUpdate) {
	if !p.meetingOn || v == nil {
		return
	}
	mt := p.meetingIn(v.GuildID)
	if mt == nil {
		return
	}
	if l := mt.theListener(); l != nil {
		_ = l.send(map[string]any{"op": "voice_server", "d": map[string]any{
			"token": v.Token, "guild_id": v.GuildID, "endpoint": v.Endpoint}})
	}
}

// onListenerEvent handles one JSON line of the listener (meeting_listener.go).
func (p *Platform) onListenerEvent(mt *meeting, ev listenerEvent) {
	switch ev.Op {
	case "gateway": // the voice library wants a voice state update (gateway op 4) sent
		if ev.D.Op != discordVoiceStateUpdateOp {
			return
		}
		ch := ""
		if ev.D.D.ChannelID != nil {
			ch = *ev.D.D.ChannelID
		}
		if err := voiceStateOp4(p.liveSession(), mt.guildID, ch, ev.D.D.SelfMute, ev.D.D.SelfDeaf); err != nil {
			slog.Warn("discord: meeting voice state update failed", "guild", mt.guildID, "error", err)
		}
	case "ready":
		select {
		case <-mt.readyCh:
		default:
			close(mt.readyCh)
		}
	case "segment":
		text := strings.TrimSpace(ev.Text)
		if text == "" || ev.UserID == "" {
			return
		}
		mt.mu.Lock()
		mt.segments = append(mt.segments, meetingSegment{UserID: ev.UserID, Start: time.UnixMilli(ev.Start), End: time.UnixMilli(ev.End), Text: text})
		n := len(mt.segments)
		mt.mu.Unlock()
		slog.Info("discord: meeting segment", "guild", mt.guildID, "n", n, "user", ev.UserID, "chars", len([]rune(text)))
	case "error":
		mt.mu.Lock()
		started := !mt.startedAt.IsZero()
		mt.mu.Unlock()
		if !started {
			select {
			case mt.failCh <- ev.Message:
			default:
			}
			return
		}
		slog.Warn("discord: meeting listener failed", "guild", mt.guildID, "error", ev.Message)
		go p.endMeeting(mt, "语音连接断了（"+ev.Message+"）", "")
	}
}

// endMeeting leaves the voice channel, waits for the queued speech to be transcribed and hands
// the transcript to the agent. replyTo is the message that asked for the minutes, if any.
func (p *Platform) endMeeting(mt *meeting, reason, replyTo string) {
	mt.mu.Lock()
	if mt.ending || mt.startedAt.IsZero() {
		mt.mu.Unlock()
		return
	}
	mt.ending = true
	l := mt.listener
	mt.mu.Unlock()
	endedAt := time.Now()

	_ = l.send(map[string]any{"op": "leave"})
	<-l.exited // it leaves the channel, transcribes what is still queued, then exits
	// the listener asked for this already; again in case it died before it could
	_ = voiceStateOp4(p.liveSession(), mt.guildID, "", false, false)
	p.forgetMeeting(mt)

	s := p.liveSession()
	mt.mu.Lock()
	segs := append([]meetingSegment(nil), mt.segments...)
	presence := append([]meetingPresence(nil), mt.presence...)
	names := map[string]string{}
	for k, v := range mt.names {
		names[k] = v
	}
	info := meetingInfo{VoiceName: mt.voiceName, Started: mt.startedAt, Ended: endedAt, Reason: reason}
	mt.mu.Unlock()
	sort.SliceStable(segs, func(i, j int) bool { return segs[i].Start.Before(segs[j].Start) })
	for _, sg := range segs {
		if names[sg.UserID] == "" {
			names[sg.UserID] = p.meetingMemberName(s, mt.guildID, sg.UserID)
		}
	}
	slog.Info("discord: meeting ended", "guild", mt.guildID, "reason", reason, "segments", len(segs))
	if len(segs) == 0 {
		p.meetingSay(mt.textID, "会议结束（"+reason+"）。这次没有收到任何发言，不出纪要。")
		return
	}
	p.meetingSay(mt.textID, fmt.Sprintf("会议结束（%s），共 %d 段发言。正在整理详细记录和标准纪要。", reason, len(segs)))

	if replyTo == "" {
		replyTo = mt.startMsgID
	}
	msg := &core.Message{
		SessionKey: p.makeSessionKey(mt.textID, mt.starterID), Platform: "discord",
		ChannelID: mt.textID, MessageID: replyTo,
		UserID: mt.starterID, UserName: mt.starterName,
		Content:   meetingPrompt(meetingTranscript(info, segs, presence, names)),
		ReplyCtx:  replyContext{channelID: mt.textID, messageID: replyTo, msgChannelID: mt.textID},
		Mentioned: true,
	}
	msg.ChatName, _ = p.ResolveChannelName(mt.textID)
	p.dispatchMessage(msg)
}

// stopMeetings stops the listeners when the platform stops.
func (p *Platform) stopMeetings() {
	p.meetingMu.Lock()
	all := p.meetings
	p.meetings = nil
	p.meetingMu.Unlock()
	for _, mt := range all {
		mt.theListener().kill()
	}
}

type meetingInfo struct {
	VoiceName      string
	Started, Ended time.Time
	Reason         string
}

// meetingClock: time since the start of the meeting, "mm:ss" or "h:mm:ss".
func meetingClock(d time.Duration) string {
	if d < 0 {
		d = 0
	}
	sec := int(d.Seconds())
	if d >= time.Hour {
		return fmt.Sprintf("%d:%02d:%02d", sec/3600, sec/60%60, sec%60)
	}
	return fmt.Sprintf("%02d:%02d", sec/60, sec%60)
}

// meetingTranscript is the text the agent gets: the header, who was there and one line per
// stretch of speech, "[start–end] name：text", times counted from the start of the recording.
func meetingTranscript(info meetingInfo, segs []meetingSegment, presence []meetingPresence, names map[string]string) string {
	name := func(id string) string {
		if n := names[id]; n != "" {
			return n
		}
		return id
	}
	var b strings.Builder
	fmt.Fprintf(&b, "会议：语音频道「%s」\n", info.VoiceName)
	fmt.Fprintf(&b, "开始：%s\n", info.Started.Format("2006-01-02 15:04:05"))
	fmt.Fprintf(&b, "结束：%s（%s），时长 %s\n", info.Ended.Format("2006-01-02 15:04:05"), info.Reason, meetingClock(info.Ended.Sub(info.Started)))
	b.WriteString("进出：\n")
	for _, pr := range presence {
		what := "离开"
		if pr.Joined {
			what = "在场"
			if pr.At.After(info.Started) {
				what = "进入"
			}
		}
		fmt.Fprintf(&b, "- [%s] %s %s\n", meetingClock(pr.At.Sub(info.Started)), name(pr.UserID), what)
	}
	b.WriteString("发言：\n")
	for _, sg := range segs {
		fmt.Fprintf(&b, "[%s–%s] %s：%s\n", meetingClock(sg.Start.Sub(info.Started)), meetingClock(sg.End.Sub(info.Started)), name(sg.UserID), sg.Text)
	}
	return b.String()
}

// meetingPrompt is the message the agent of the text channel gets when a meeting ends.
func meetingPrompt(transcript string) string {
	var b strings.Builder
	b.WriteString("【会议助手】下面是刚结束的一场语音会议的转写稿。这条消息是桥自动生成的，不是用户打的字。\n")
	b.WriteString("转写稿里每行发言是「[开始–结束] 说话人：内容」，时间从开始记录算起。说话人按 Discord 账号区分，是确定的；文字是语音识别出来的，可能有错字、同音字。\n\n")
	b.WriteString("<转写稿>\n" + transcript + "</转写稿>\n\n")
	b.WriteString("请直接在这个频道回复下面两份内容，不要寒暄，不要反问：\n\n")
	b.WriteString("一、详细记录。按时间顺序逐条写，每条一行，不用表格：时间、谁说的、对谁说、内容。「对谁说」Discord 给不出来，由你根据点名、称呼和上下文推断，每一条都标明「推断」，判断不出就写「全体（推断）」。内容照原话整理，只改明显的识别错字，不删观点、不加没说过的话。\n\n")
	b.WriteString("二、标准纪要。四部分：议题；结论；待办（每条写清做什么、负责人、期限，会上没说的写「未定」）；分歧（没有就写「无」）。\n\n")
	b.WriteString("另外，按你本机的记忆或笔记约定把这份纪要存一份（没有这类约定就不用存），存了就在回复最后写一句存在哪。")
	return b.String()
}
