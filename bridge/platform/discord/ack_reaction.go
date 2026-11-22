package discord

import (
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/bwmarrin/discordgo"

	"github.com/chenhg5/cc-connect/core"
)

// ack_reaction (config, default off; user 2026-11-16「第二个做成可选 可选打开或者关闭
// 这个功能」): a "received" emoji on the person's message once the bridge accepts it,
// swapped for ✅ or ❌ when its turn ends. ack_emoji picks the received emoji per bot
// (user 2026-11-20「支持自定义」), default 👀. Messages still marked are kept in a
// small file together with the emoji that was put on, so a restart that cut a turn
// short takes exactly that emoji off at the next Ready, even after ack_emoji changed.
const (
	defaultAckEmoji = "👀"
	ackEmojiDone    = "✅"
	ackEmojiFailed  = "❌"
)

type ackReactions struct {
	mu       sync.Mutex
	path     string // "" = keep in memory only
	received string // emoji put on when a message is taken
	pending  map[string]ackPending
}

// ackPending is one message still carrying the received emoji.
type ackPending struct {
	Channel string `json:"c"`
	Emoji   string `json:"e"`
}

// UnmarshalJSON also reads the older file format, where the value was just the
// channel ID and the emoji was always 👀.
func (a *ackPending) UnmarshalJSON(raw []byte) error {
	var channel string
	if err := json.Unmarshal(raw, &channel); err == nil {
		*a = ackPending{Channel: channel, Emoji: defaultAckEmoji}
		return nil
	}
	type plain ackPending
	var v plain
	if err := json.Unmarshal(raw, &v); err != nil {
		return err
	}
	*a = ackPending(v)
	return nil
}

var _ core.TurnReactor = (*Platform)(nil)

func newAckReactions(opts map[string]any) *ackReactions {
	a := &ackReactions{received: defaultAckEmoji, pending: map[string]ackPending{}}
	if e, _ := opts["ack_emoji"].(string); strings.TrimSpace(e) != "" {
		a.received = strings.TrimSpace(e)
	}
	if dir, _ := opts["cc_data_dir"].(string); dir != "" {
		project, _ := opts["cc_project"].(string)
		a.path = filepath.Join(dir, "discord_ack_pending_"+project+".json")
		if raw, err := os.ReadFile(a.path); err == nil {
			_ = json.Unmarshal(raw, &a.pending)
		}
	}
	return a
}

// saveLocked writes the pending set; callers hold a.mu.
func (a *ackReactions) saveLocked() {
	if a.path == "" {
		return
	}
	raw, _ := json.Marshal(a.pending)
	tmp := a.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err == nil {
		_ = os.Rename(tmp, a.path)
	}
}

func (a *ackReactions) set(msgID, channelID string, on bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if on {
		a.pending[msgID] = ackPending{Channel: channelID, Emoji: a.received}
	} else {
		delete(a.pending, msgID)
	}
	a.saveLocked()
}

// lookup returns the emoji put on msgID, if it is still marked.
func (a *ackReactions) lookup(msgID string) (string, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	p, ok := a.pending[msgID]
	return p.Emoji, ok
}

// clearStale takes this bot's received emoji off messages left marked by the previous run.
func (a *ackReactions) clearStale(s *discordgo.Session) {
	if a == nil || s == nil {
		return
	}
	a.mu.Lock()
	stale := make(map[string]ackPending, len(a.pending))
	for id, p := range a.pending {
		stale[id] = p
	}
	a.mu.Unlock()
	for id, p := range stale {
		if err := s.MessageReactionRemove(p.Channel, id, p.Emoji, "@me"); err != nil {
			slog.Debug("discord: clear stale ack reaction failed", "message", id, "error", err)
		}
		a.set(id, "", false)
	}
	if len(stale) > 0 {
		slog.Info("discord: cleared stale ack reactions", "count", len(stale))
	}
}

func (p *Platform) ackTarget(replyCtx any) (session *discordgo.Session, channelID, msgID string, ok bool) {
	if p.acks == nil {
		return nil, "", "", false
	}
	rc, isRC := replyCtx.(replyContext)
	if !isRC || rc.messageID == "" || rc.msgChannelID == "" {
		return nil, "", "", false
	}
	p.mu.RLock()
	session = p.session
	p.mu.RUnlock()
	if session == nil {
		return nil, "", "", false
	}
	return session, rc.msgChannelID, rc.messageID, true
}

// ReactReceived implements core.TurnReactor.
func (p *Platform) ReactReceived(replyCtx any) {
	s, ch, id, ok := p.ackTarget(replyCtx)
	if !ok {
		return
	}
	if err := s.MessageReactionAdd(ch, id, p.acks.received); err != nil {
		slog.Debug("discord: ack reaction failed", "message", id, "error", err)
		return
	}
	p.acks.set(id, ch, true)
}

// ReactTurnOutcome implements core.TurnReactor.
func (p *Platform) ReactTurnOutcome(replyCtx any, failed bool) {
	s, ch, id, ok := p.ackTarget(replyCtx)
	if !ok {
		return
	}
	received, marked := p.acks.lookup(id)
	if !marked {
		return
	}
	emoji := ackEmojiDone
	if failed {
		emoji = ackEmojiFailed
	}
	if err := s.MessageReactionAdd(ch, id, emoji); err != nil {
		slog.Debug("discord: outcome reaction failed", "message", id, "error", err)
	}
	if err := s.MessageReactionRemove(ch, id, received, "@me"); err != nil {
		slog.Debug("discord: remove ack reaction failed", "message", id, "error", err)
	}
	p.acks.set(id, "", false)
}
