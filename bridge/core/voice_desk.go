package core

// maomao fork: voice desk.
//
// The owner talks to one voice conversation and uses it as a front desk. Each voice turn carries a
// brief of what every teammate is doing in which channel (from the team status files). To hand an
// instruction to a teammate the model only proposes it (<待转达 ...>); the bridge resolves the
// teammate and channel, stores the proposal and reads back exactly what it would send. The bridge
// posts it, with an @ of the teammate in that channel, only when the owner's next voice message is
// an explicit confirmation; anything else drops it. The model can never send on its own, a channel
// is never guessed, and every outcome (sent, failed, unknown) is spoken back.

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode"
)

const (
	voiceDeskMaxRunes    = 500
	voiceDeskSendTimeout = 15 * time.Second
	voiceDeskPendingTTL  = 2 * time.Minute
)

var (
	voiceDeskProposal = regexp.MustCompile(`(?s)<待转达\s+to="([^"]+)"(?:\s+chat="([^"]*)")?\s*>(.*?)</待转达>`)
	// Legacy or invented send tags are stripped and never acted on.
	voiceDeskOtherTag = regexp.MustCompile(`(?s)</?转达[^>]*>`)
)

type voiceDeskState struct {
	on      atomic.Bool
	mu      sync.Mutex
	pending map[string]voicePending // voice conversation → proposal awaiting confirmation
}

// voiceDispatch is one hand-off proposed by the voice answer.
type voiceDispatch struct {
	To, Chat, Text string
}

// voicePending is a resolved proposal waiting for the owner's confirmation.
type voicePending struct {
	ID       string
	Project  string
	Name     string
	Mention  string
	Chat     string
	ChatName string
	Text     string
	At       time.Time
}

// SetVoiceDesk turns the voice desk on for this project's voice turns.
func (e *Engine) SetVoiceDesk(on bool) { e.voiceDesk.on.Store(on) }

func (e *Engine) voiceDeskFiles() []teamFile {
	if !e.voiceDesk.on.Load() || e.team == nil {
		return nil
	}
	return readTeamFiles(e.team.dir, time.Now())
}

func voiceDeskKey(req RelayRequest) string {
	return req.From + "\x00" + req.SessionKey + "\x00" + req.Scope
}

// voiceDeskTake removes the conversation's pending proposal and reports whether this message
// confirms it. A proposal lives for one following message only.
func (e *Engine) voiceDeskTake(key, message string) (voicePending, bool) {
	e.voiceDesk.mu.Lock()
	p, ok := e.voiceDesk.pending[key]
	delete(e.voiceDesk.pending, key)
	e.voiceDesk.mu.Unlock()
	if !ok || time.Since(p.At) > voiceDeskPendingTTL {
		return voicePending{}, false
	}
	return p, isVoiceConfirm(message)
}

func (e *Engine) voiceDeskStore(key string, p voicePending) {
	e.voiceDesk.mu.Lock()
	defer e.voiceDesk.mu.Unlock()
	if e.voiceDesk.pending == nil {
		e.voiceDesk.pending = map[string]voicePending{}
	}
	e.voiceDesk.pending[key] = p
}

// voiceConfirmPhrases are the whole utterances (after dropping spaces and punctuation) that
// confirm a pending hand-off. Exact match only: "对了，查下进度", "发给谁", "确认一下内容" or
// "可以改成明天吗" are not a yes; a change to the text needs a new read-back.
var voiceConfirmPhrases = map[string]bool{
	"对": true, "对的": true, "对对": true, "是": true, "是的": true, "好": true, "好的": true,
	"确认": true, "确认发送": true, "可以": true, "没错": true, "没问题": true, "行": true, "嗯": true,
	"发吧": true, "发": true, "发送": true, "转吧": true, "对发吧": true, "好发吧": true, "好的发吧": true,
	"对的发吧": true, "可以发": true, "ok": true, "okay": true, "yes": true,
}

// isVoiceConfirm reports whether the owner's own words are an explicit yes and nothing else.
func isVoiceConfirm(userText string) bool {
	s := strings.ToLower(strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) || unicode.IsPunct(r) || unicode.IsSymbol(r) {
			return -1
		}
		return r
	}, userText))
	return voiceConfirmPhrases[s]
}

// voiceUserText is what the owner said this turn, if the voice client sent it apart from the
// prompt and it really is part of that prompt. Without it no hand-off can be confirmed.
func voiceUserText(req RelayRequest) string {
	t := strings.TrimSpace(req.UserText)
	if t == "" || !strings.Contains(req.Message, t) {
		return ""
	}
	return t
}

// withVoiceDesk prepends the teammates' progress and the hand-off protocol to a voice message.
func (e *Engine) withVoiceDesk(message string) string {
	files := e.voiceDeskFiles()
	if len(files) == 0 {
		return message
	}
	return renderVoiceDeskBrief(files, time.Now()) + "\n\n" + message
}

// renderVoiceDeskBrief lists each teammate's busy or recently finished work with the channel key
// a hand-off would use. Private chats (no channel name) show no task text.
func renderVoiceDeskBrief(files []teamFile, now time.Time) string {
	var b strings.Builder
	fmt.Fprintf(&b, "（语音总台：各伙伴进度，%s 更新，系统自动附上，只供你回答和转达用，不要逐条念）\n", now.Format("15:04"))
	for _, f := range files {
		var lines []string
		for _, s := range f.Sessions {
			where := "私聊"
			task := ""
			if s.Chat != "" {
				where = "#" + s.Chat + " chat=" + chatOf(s.Key)
				if s.Task != "" {
					task = "「" + s.Task + "」"
				}
			}
			if s.Busy {
				lines = append(lines, fmt.Sprintf("忙了 %s，在%s %s", roundDur(now.Sub(s.Since)), where, task))
			} else {
				lines = append(lines, fmt.Sprintf("%s前做完，在%s %s", roundDur(now.Sub(s.DoneAt)), where, task))
			}
		}
		state := "空闲"
		if len(lines) > 0 {
			sort.Strings(lines)
			state = strings.Join(lines, "；")
		}
		fmt.Fprintf(&b, "- %s（to=%s）：%s\n", f.Name, f.Project, strings.TrimSpace(state))
	}
	b.WriteString("主人要你把话转给某位伙伴时，在回答末尾另起一行写 <待转达 to=\"项目名\" chat=\"频道 chat 值\">要转达的原话</待转达>，" +
		"chat 用上面列出的值，不确定就省略。这一行不会念出来，也不会直接发出：系统会念一句确认，主人下一句说「对」才真正发送。" +
		"正文不用复述，主人确认后你只需简短回应，发送结果由系统播报。一次只提一条。")
	return b.String()
}

// parseVoiceProposals strips every desk tag from a voice answer and returns the first proposal.
func parseVoiceProposals(answer string) (string, *voiceDispatch) {
	var d *voiceDispatch
	clean := voiceDeskProposal.ReplaceAllStringFunc(answer, func(m string) string {
		g := voiceDeskProposal.FindStringSubmatch(m)
		text := strings.TrimSpace(g[3])
		if text != "" && d == nil {
			if r := []rune(text); len(r) > voiceDeskMaxRunes {
				text = string(r[:voiceDeskMaxRunes])
			}
			d = &voiceDispatch{To: strings.TrimSpace(g[1]), Chat: strings.TrimSpace(g[2]), Text: text}
		}
		return ""
	})
	clean = voiceDeskOtherTag.ReplaceAllString(clean, "")
	return strings.TrimSpace(clean), d
}

// errVoiceDesk carries a sentence that can be spoken to the owner as is.
type errVoiceDesk struct{ spoken string }

func (e *errVoiceDesk) Error() string { return "voice desk: " + e.spoken }

func deskErr(format string, a ...any) error { return &errVoiceDesk{fmt.Sprintf(format, a...)} }

// resolveVoiceDispatch finds the teammate and its channel. A named chat must be one the teammate
// was seen in; without one, the teammate must be in exactly one channel (busy first, else recent
// work). Several candidates are an error listing them, never a guess.
func resolveVoiceDispatch(files []teamFile, d voiceDispatch) (voicePending, error) {
	for _, f := range files {
		if !strings.EqualFold(f.Project, d.To) && f.Name != d.To {
			continue
		}
		if f.Mention == "" {
			return voicePending{}, deskErr("现在 @ 不到%s，请在频道里直接说", f.Name)
		}
		p := voicePending{Project: f.Project, Name: f.Name, Mention: f.Mention, Text: d.Text}
		busy, recent := map[string]string{}, map[string]string{}
		for _, s := range f.Sessions {
			if s.Chat == "" {
				continue
			}
			c := chatOf(s.Key)
			if d.Chat != "" && c == d.Chat {
				p.Chat, p.ChatName = c, s.Chat
				return p, nil
			}
			if s.Busy {
				busy[c] = s.Chat
			} else {
				recent[c] = s.Chat
			}
		}
		if d.Chat != "" {
			return voicePending{}, deskErr("%s不在你说的那个频道，请说清楚转到哪个频道", f.Name)
		}
		pick := busy
		if len(pick) == 0 {
			pick = recent
		}
		switch len(pick) {
		case 0:
			return voicePending{}, deskErr("不知道%s现在在哪个频道，请说清楚转到哪个频道", f.Name)
		case 1:
			for c, name := range pick {
				p.Chat, p.ChatName = c, name
			}
			return p, nil
		default:
			var names []string
			for _, name := range pick {
				names = append(names, "#"+name)
			}
			sort.Strings(names)
			return voicePending{}, deskErr("%s同时在%s，要转到哪个频道", f.Name, strings.Join(names, "、"))
		}
	}
	return voicePending{}, deskErr("没找到叫%s的伙伴", d.To)
}

// finishVoiceDesk runs after a successful voice turn: it sends a confirmed proposal, stores a new
// one, and returns the answer to speak with the outcome appended.
func (e *Engine) finishVoiceDesk(ctx context.Context, key, answer string, confirmed *voicePending) string {
	if !e.voiceDesk.on.Load() {
		return answer
	}
	clean, proposal := parseVoiceProposals(answer)
	var notes []string
	if confirmed != nil {
		notes = append(notes, e.sendVoicePending(ctx, *confirmed))
	}
	if proposal != nil {
		p, err := resolveVoiceDispatch(e.voiceDeskFiles(), *proposal)
		if err != nil {
			notes = append(notes, spokenDeskError(err))
		} else {
			p.ID, p.At = newVoicePendingID(), time.Now()
			e.voiceDeskStore(key, p)
			notes = append(notes, fmt.Sprintf("要我转给%s，在#%s：「%s」。确认的话说「对」。", p.Name, p.ChatName, p.Text))
		}
	}
	if len(notes) == 0 {
		return clean
	}
	return strings.TrimSpace(clean + "\n" + strings.Join(notes, "\n"))
}

func spokenDeskError(err error) string {
	var de *errVoiceDesk
	if errors.As(err, &de) {
		return de.spoken + "。"
	}
	return "转达没有成功，请在频道里直接说。"
}

func newVoicePendingID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// sendVoicePending posts a confirmed hand-off and says what happened.
func (e *Engine) sendVoicePending(ctx context.Context, p voicePending) string {
	err := e.postVoicePending(ctx, p)
	switch {
	case err == nil:
		slog.Info("voice desk: handed off", "id", p.ID, "to", p.Project, "chat", p.Chat)
		return fmt.Sprintf("已转达给%s（#%s）。", p.Name, p.ChatName)
	case errors.Is(err, ErrPostOutcomeUnknown):
		slog.Warn("voice desk: hand-off outcome unknown", "id", p.ID, "to", p.Project, "error", err)
		return fmt.Sprintf("转给%s的消息不确定发出去没有，先去#%s看一眼，别重复说。", p.Name, p.ChatName)
	default:
		slog.Warn("voice desk: hand-off failed", "id", p.ID, "to", p.Project, "error", err)
		return "转给" + p.Name + "没有成功：" + strings.TrimSuffix(spokenDeskError(err), "。") + "。"
	}
}

func (e *Engine) postVoicePending(ctx context.Context, p voicePending) error {
	if err := ctx.Err(); err != nil {
		return deskErr("这一轮已经取消")
	}
	platform, _, _ := strings.Cut(p.Chat, ":")
	poster, cp, err := e.voiceDeskPoster(p, platform)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, voiceDeskSendTimeout)
	defer cancel()
	if err := cp.PostToChat(ctx, p.Chat, p.Mention+" 【语音转达】主人："+p.Text, p.Mention); err != nil {
		if ctx.Err() != nil && !errors.Is(err, ErrPostOutcomeUnknown) {
			// The request may have reached the platform before the deadline.
			err = fmt.Errorf("%w: %v", ErrPostOutcomeUnknown, err)
		}
		return fmt.Errorf("voice desk: post via %s: %w", poster.name, err)
	}
	return nil
}

// voiceDeskPoster picks the bot that posts a hand-off: this one, or, when the hand-off is for this
// bot itself (a platform ignores a bot's own messages), another engine of the same process on the
// same platform. No eligible poster is an error, never a silent self-send.
func (e *Engine) voiceDeskPoster(p voicePending, platform string) (*Engine, ChatPoster, error) {
	posterOf := func(x *Engine) ChatPoster {
		cp, ok := x.platformForName(platform).(ChatPoster)
		if !ok {
			return nil
		}
		return cp
	}
	self := strings.EqualFold(p.Project, e.name) || p.Mention == e.selfMention()
	if !self {
		if cp := posterOf(e); cp != nil {
			return e, cp, nil
		}
		return nil, nil, deskErr("这个平台不支持转达")
	}
	if rm := e.relayManager; rm != nil {
		names := rm.ListEngineNames()
		sort.Strings(names)
		for _, name := range names {
			if name == e.name {
				continue
			}
			rm.mu.RLock()
			other := rm.engines[name]
			rm.mu.RUnlock()
			if other == nil {
				continue
			}
			if m := other.selfMention(); m == "" || m == p.Mention {
				continue
			}
			if cp := posterOf(other); cp != nil {
				return other, cp, nil
			}
		}
	}
	return nil, nil, deskErr("没有别的伙伴能代我发给自己")
}

// selfMention is how teammates address this project's bot (first platform that knows it).
func (e *Engine) selfMention() string {
	for _, p := range e.platforms {
		if m, ok := p.(SelfMentioner); ok {
			if s := m.SelfMention(); s != "" {
				return s
			}
		}
	}
	return ""
}
