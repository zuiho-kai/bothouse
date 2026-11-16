package discord

import (
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"sync"

	"github.com/bwmarrin/discordgo"

	"github.com/chenhg5/cc-connect/core"
)

// ack_reaction (config, default off; user 2026-11-16「第二个做成可选 可选打开或者关闭
// 这个功能」): 👀 on the person's message once the bridge accepts it, swapped for ✅
// or ❌ when its turn ends. Messages still marked 👀 are kept in a small file, so a
// restart that cut a turn short takes its own 👀 off at the next Ready.
const (
	ackEmojiReceived = "👀"
	ackEmojiDone     = "✅"
	ackEmojiFailed   = "❌"
)

type ackReactions struct {
	mu      sync.Mutex
	path    string            // "" = keep in memory only
	pending map[string]string // message ID → channel ID, while 👀 is on
}

var _ core.TurnReactor = (*Platform)(nil)

func newAckReactions(opts map[string]any) *ackReactions {
	a := &ackReactions{pending: map[string]string{}}
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
		a.pending[msgID] = channelID
	} else {
		delete(a.pending, msgID)
	}
	a.saveLocked()
}

func (a *ackReactions) has(msgID string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	_, ok := a.pending[msgID]
	return ok
}

// clearStale takes this bot's 👀 off messages left marked by the previous run.
func (a *ackReactions) clearStale(s *discordgo.Session) {
	if a == nil || s == nil {
		return
	}
	a.mu.Lock()
	stale := make(map[string]string, len(a.pending))
	for id, ch := range a.pending {
		stale[id] = ch
	}
	a.mu.Unlock()
	for id, ch := range stale {
		if err := s.MessageReactionRemove(ch, id, ackEmojiReceived, "@me"); err != nil {
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
	if err := s.MessageReactionAdd(ch, id, ackEmojiReceived); err != nil {
		slog.Debug("discord: ack reaction failed", "message", id, "error", err)
		return
	}
	p.acks.set(id, ch, true)
}

// ReactTurnOutcome implements core.TurnReactor.
func (p *Platform) ReactTurnOutcome(replyCtx any, failed bool) {
	s, ch, id, ok := p.ackTarget(replyCtx)
	if !ok || !p.acks.has(id) {
		return
	}
	emoji := ackEmojiDone
	if failed {
		emoji = ackEmojiFailed
	}
	if err := s.MessageReactionAdd(ch, id, emoji); err != nil {
		slog.Debug("discord: outcome reaction failed", "message", id, "error", err)
	}
	if err := s.MessageReactionRemove(ch, id, ackEmojiReceived, "@me"); err != nil {
		slog.Debug("discord: remove ack reaction failed", "message", id, "error", err)
	}
	p.acks.set(id, "", false)
}
