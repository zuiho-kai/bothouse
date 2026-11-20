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
//
// Pictures: a bot cannot see a camera or a screen share. Discord does not support video or Go
// Live for bots (discord/discord-api-docs#1995, staff answer), the voice documentation covers
// audio only, and @discordjs/voice drops every packet that is not Opus. So what the meeting wants
// the bot to see is posted as a picture in the text channel the meeting was called from: those
// pictures are remembered with their time and sender (noteMeetingImages) and go to the agent with
// the transcript.

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

// meetingPost is a message with pictures posted in the meeting's text channel during the meeting.
type meetingPost struct {
	At     time.Time
	UserID string
	Text   string // what the sender wrote with the pictures
	Images []*discordgo.MessageAttachment
}

// meetingFrame is a still of a member's camera taken by the listener (video.mjs): one every 10
// seconds while the camera is on, kept only when the picture changed.
type meetingFrame struct {
	At     time.Time
	UserID string
	Kind   string // "camera"
	JPG    []byte
}

// meetingShot is one picture in the transcript: posted in the text channel, or a camera still
// (Kind set). N is its number among the pictures handed to the agent, 0 when it is not handed over.
type meetingShot struct {
	At       time.Time
	UserID   string
	Text     string
	FileName string
	Kind     string // "" posted picture, "camera" camera still
	N        int
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
	posts     []meetingPost
	frames    []meetingFrame
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
	p.meetingSay(m.ChannelID, "已进入语音频道「"+name+"」，开始记录会议。大家都离开语音频道，或者 @ 我说「会议纪要」，我就退出并发出详细记录和标准纪要。摄像头和屏幕共享我看不到，要我看的画面请截图发到这个频道，会一起记进纪要。")
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

// noteMeetingImages remembers the pictures of a message posted in the meeting's text channel
// while the meeting is being recorded, whoever posts them. The message itself is handled as usual.
func (p *Platform) noteMeetingImages(m *discordgo.MessageCreate) {
	if !p.meetingOn || m.GuildID == "" {
		return
	}
	mt := p.meetingIn(m.GuildID)
	if mt == nil || mt.textID != m.ChannelID {
		return
	}
	var images []*discordgo.MessageAttachment
	for _, att := range m.Attachments {
		// the same test as classifyAttachments
		if att == nil {
			continue
		}
		if ct := strings.ToLower(att.ContentType); strings.HasPrefix(ct, "image/") || ct == "" && att.Width > 0 && att.Height > 0 {
			images = append(images, att)
		}
	}
	if len(images) == 0 {
		return
	}
	mt.mu.Lock()
	defer mt.mu.Unlock()
	if mt.startedAt.IsZero() || mt.ending {
		return
	}
	mt.names[m.Author.ID] = discordDisplayName(m)
	mt.posts = append(mt.posts, meetingPost{At: time.Now(), UserID: m.Author.ID, Text: strings.TrimSpace(m.Content), Images: images})
	slog.Info("discord: meeting picture", "guild", mt.guildID, "user", m.Author.ID, "images", len(images))
}

// meetingShots fetches the posted pictures: one transcript entry per picture, and the pictures
// that go to the agent, in the order of their numbers.
func meetingShots(posts []meetingPost, download func(string) ([]byte, error)) (shots []meetingShot, images []core.ImageAttachment) {
	for _, po := range posts {
		for _, att := range po.Images {
			sh := meetingShot{At: po.At, UserID: po.UserID, Text: po.Text, FileName: att.Filename}
			if got, _, _, _ := classifyAttachments([]*discordgo.MessageAttachment{att}, download); len(got) == 1 {
				images = append(images, got[0])
				sh.N = len(images)
			}
			shots = append(shots, sh)
		}
	}
	return shots, images
}

// meetingMaxImages is how many pictures one minutes request may carry.
// 来源：Anthropic Messages API 一次请求最多 100 张图（docs.claude.com vision 文档「up to 100 images」）。
const meetingMaxImages = 100

// meetingFrameShots adds the camera stills to the posted pictures, in order of time, numbering
// them after the posted ones. When there are more than fit in one request, stills are taken at
// even spacing and the rest are left out of the transcript.
func meetingFrameShots(shots []meetingShot, images []core.ImageAttachment, frames []meetingFrame) ([]meetingShot, []core.ImageAttachment) {
	sort.SliceStable(frames, func(i, j int) bool { return frames[i].At.Before(frames[j].At) })
	room := meetingMaxImages - len(images)
	if room <= 0 {
		return shots, images
	}
	if len(frames) > room {
		picked := make([]meetingFrame, 0, room)
		for i := 0; i < room; i++ {
			picked = append(picked, frames[i*len(frames)/room])
		}
		frames = picked
	}
	for _, f := range frames {
		images = append(images, core.ImageAttachment{MimeType: "image/jpeg", Data: f.JPG, FileName: "camera.jpg"})
		shots = append(shots, meetingShot{At: f.At, UserID: f.UserID, Kind: f.Kind, N: len(images)})
	}
	sort.SliceStable(shots, func(i, j int) bool { return shots[i].At.Before(shots[j].At) })
	return shots, images
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
	case "frame":
		if ev.UserID == "" || len(ev.JPG) == 0 {
			return
		}
		mt.mu.Lock()
		mt.frames = append(mt.frames, meetingFrame{At: time.UnixMilli(ev.At), UserID: ev.UserID, Kind: ev.Kind, JPG: ev.JPG})
		n := len(mt.frames)
		mt.mu.Unlock()
		slog.Info("discord: meeting video still", "guild", mt.guildID, "n", n, "user", ev.UserID, "kind", ev.Kind, "bytes", len(ev.JPG))
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

// meetingDrainTimeout is how long endMeeting waits for the listener to transcribe what is still
// queued and exit. After that the listener is killed and the minutes are written from the
// segments that have arrived. A variable so that the test can shorten it.
// 来源：用户只要求「加等待上限」，没给时长，这个值是自定的：实测最慢一段的转写耗时 × 60。
// 实测（#1817 e2e 三轮，共 16 段、每段 3–9 秒的话）：说完到收到这段的字，扣掉 1 秒切段停顿后
// 是 0.5–1 秒；队列空时从发 leave 到 listener 退出约 0.04 秒。按最慢 1 秒算，60 秒够转完 60 段积压。
var meetingDrainTimeout = 60 * time.Second

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
	// it leaves the channel, transcribes what is still queued, then exits
	if !l.waitExit(meetingDrainTimeout) {
		slog.Warn("discord: meeting listener did not exit, killed", "guild", mt.guildID, "waited", meetingDrainTimeout)
	}
	// the listener asked for this already; again in case it died before it could
	_ = voiceStateOp4(p.liveSession(), mt.guildID, "", false, false)
	p.forgetMeeting(mt)

	s := p.liveSession()
	mt.mu.Lock()
	segs := append([]meetingSegment(nil), mt.segments...)
	presence := append([]meetingPresence(nil), mt.presence...)
	posts := append([]meetingPost(nil), mt.posts...)
	frames := append([]meetingFrame(nil), mt.frames...)
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
	for _, f := range frames {
		if names[f.UserID] == "" {
			names[f.UserID] = p.meetingMemberName(s, mt.guildID, f.UserID)
		}
	}
	shots, images := meetingShots(posts, downloadURL)
	posted := len(shots)
	shots, images = meetingFrameShots(shots, images, frames)
	said := fmt.Sprintf("共 %d 段发言", len(segs))
	if posted > 0 {
		said += fmt.Sprintf("、%d 张图", posted)
	}
	if n := len(shots) - posted; n > 0 {
		said += fmt.Sprintf("、%d 张摄像头截图", n)
	}
	p.meetingSay(mt.textID, fmt.Sprintf("会议结束（%s），%s。正在整理详细记录和标准纪要。", reason, said))

	if replyTo == "" {
		replyTo = mt.startMsgID
	}
	msg := &core.Message{
		SessionKey: p.makeSessionKey(mt.textID, mt.starterID), Platform: "discord",
		ChannelID: mt.textID, MessageID: replyTo,
		UserID: mt.starterID, UserName: mt.starterName,
		Content:   meetingPrompt(meetingTranscript(info, segs, shots, presence, names), len(images), posted > 0, len(shots) > posted),
		Images:    images,
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

// meetingTranscript is the text the agent gets: the header, who was there and, in order of time,
// one line per stretch of speech, "[start–end] name：text", and one per posted picture,
// "[time] name 发图（图N，file）：text". Times are counted from the start of the recording.
func meetingTranscript(info meetingInfo, segs []meetingSegment, shots []meetingShot, presence []meetingPresence, names map[string]string) string {
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
	k := 0 // shots[:k] are written
	for _, sg := range segs {
		for ; k < len(shots) && shots[k].At.Before(sg.Start); k++ {
			b.WriteString(meetingShotLine(info, shots[k], name(shots[k].UserID)))
		}
		fmt.Fprintf(&b, "[%s–%s] %s：%s\n", meetingClock(sg.Start.Sub(info.Started)), meetingClock(sg.End.Sub(info.Started)), name(sg.UserID), sg.Text)
	}
	for ; k < len(shots); k++ {
		b.WriteString(meetingShotLine(info, shots[k], name(shots[k].UserID)))
	}
	return b.String()
}

func meetingShotLine(info meetingInfo, sh meetingShot, name string) string {
	if sh.Kind == "camera" {
		return fmt.Sprintf("[%s] %s 的摄像头（图%d）\n", meetingClock(sh.At.Sub(info.Started)), name, sh.N)
	}
	what := fmt.Sprintf("图%d，%s", sh.N, sh.FileName)
	if sh.N == 0 {
		what = sh.FileName + "，图片没取到"
	}
	line := fmt.Sprintf("[%s] %s 发图（%s）", meetingClock(sh.At.Sub(info.Started)), name, what)
	if sh.Text != "" {
		line += "：" + sh.Text
	}
	return line + "\n"
}

// meetingPrompt is the message the agent of the text channel gets when a meeting ends. images is
// the number of pictures that come with it; posted / camera: whether they include pictures posted
// in the text channel / camera stills.
func meetingPrompt(transcript string, images int, posted, camera bool) string {
	var b strings.Builder
	b.WriteString("【会议助手】下面是刚结束的一场语音会议的转写稿。这条消息是桥自动生成的，不是用户打的字。\n")
	b.WriteString("转写稿里每行发言是「[开始–结束] 说话人：内容」，时间从开始记录算起。说话人按 Discord 账号区分，是确定的；文字是语音识别出来的，可能有错字、同音字。\n")
	if images > 0 {
		// The engine may put older channel pictures in front of these, never behind them.
		if camera {
			b.WriteString("会上有人开了摄像头，桥每 10 秒截一张，画面变了才留，转写稿里是「[时间] 某人 的摄像头（图N）」，画面是这个人的摄像头拍到的。")
		}
		if posted {
			b.WriteString("会议进行中有人在这个文字频道发了图，转写稿里是「[时间] 发图人 发图（图N，文件名）：附言」。")
		}
		fmt.Fprintf(&b, "这些图随本条消息附上：本条消息所带图片的最后 %d 张，按顺序就是图1 到图%d。先看图再写。\n", images, images)
	}
	b.WriteString("\n<转写稿>\n" + transcript + "</转写稿>\n\n")
	b.WriteString("请直接在这个频道回复下面两份内容，不要寒暄，不要反问：\n\n")
	b.WriteString("一、详细记录。按时间顺序逐条写，每条一行，不用表格：时间、谁说的、对谁说、内容。「对谁说」Discord 给不出来，由你根据点名、称呼和上下文推断，每一条都标明「推断」，判断不出就写「全体（推断）」。内容照原话整理，只改明显的识别错字，不删观点、不加没说过的话。")
	if images > 0 {
		b.WriteString("发图和摄像头的行也按时间插在里面，写成「[时间] 某人 发图：画面内容」或「[时间] 某人 的摄像头：画面内容」，画面内容写图上看得到的标题、文字、数字，看不清的写看不清，不猜。")
	}
	b.WriteString("\n\n")
	b.WriteString("二、标准纪要。四部分：议题；结论；待办（每条写清做什么、负责人、期限，会上没说的写「未定」）；分歧（没有就写「无」）。")
	if images > 0 {
		b.WriteString("图上的信息可以用，用到时写明出自谁发的图或谁的摄像头。")
	}
	b.WriteString("\n\n")
	b.WriteString("另外，按你本机的记忆或笔记约定把这份纪要存一份（没有这类约定就不用存），存了就在回复最后写一句存在哪。")
	return b.String()
}
