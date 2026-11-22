package core

import (
	"context"
	"regexp"
	"strings"
	"sync"
	"time"
)

// #2091: human mentions are gated at the bridge so ordinary bot replies never ping a human
// (the <@id> text stays visible, while Discord allowed_mentions omits human users). Only two
// explicit exits allow human pings: task release posts (ws-pass / timeout report, controlled by
// mention_assigner) and decision asks (ws-forward --ask-user / bothouse send --ask-user).

type allowHumanMentionsKey struct{}

// WithAllowHumanMentions marks ctx so the platform may let mentions of userIDs notify on this
// single send call. Empty IDs are skipped and duplicates are removed.
func WithAllowHumanMentions(ctx context.Context, userIDs ...string) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	existing := AllowedHumanMentions(ctx)
	seen := make(map[string]struct{}, len(existing)+len(userIDs))
	out := make([]string, 0, len(existing)+len(userIDs))
	for _, id := range existing {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	for _, id := range userIDs {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	if len(out) == 0 {
		return ctx
	}
	return context.WithValue(ctx, allowHumanMentionsKey{}, out)
}

// AllowedHumanMentions returns the human user IDs explicitly allowed to notify on this send call.
func AllowedHumanMentions(ctx context.Context) []string {
	if ctx == nil {
		return nil
	}
	ids, _ := ctx.Value(allowHumanMentionsKey{}).([]string)
	if len(ids) == 0 {
		return nil
	}
	out := make([]string, len(ids))
	copy(out, ids)
	return out
}

// humanMentionDedupWindow: within this window after a task's release post mentioned the assigner,
// another @ to the same human by the same bot in the same channel is suppressed so the same item
// does not ping twice (#2091).
// 来源：沿用 teamReportRecoveryGrace（2 分钟，汇报刚放行/投递的紧跟窗口）。
var humanMentionDedupWindow = teamReportRecoveryGrace

type humanMentionKey struct {
	channel string
	user    string
}

type humanMentionRecord struct {
	taskID int
	at     time.Time
}

type humanMentionGate struct {
	mu      sync.Mutex
	records map[humanMentionKey]humanMentionRecord
	now     func() time.Time
}

func (g *humanMentionGate) currentTime() time.Time {
	if g.now != nil {
		return g.now()
	}
	return time.Now()
}

func (g *humanMentionGate) pruneLocked(now time.Time) {
	for k, rec := range g.records {
		if now.Sub(rec.at) > humanMentionDedupWindow {
			delete(g.records, k)
		}
	}
}

func (g *humanMentionGate) isDeduped(sessionKey, userID string, taskID int) bool {
	userID = strings.TrimSpace(userID)
	ch := teamChatKey(sessionKey)
	if userID == "" || ch == "" {
		return false
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if len(g.records) == 0 {
		return false
	}
	now := g.currentTime()
	g.pruneLocked(now)
	rec, ok := g.records[humanMentionKey{channel: ch, user: userID}]
	if !ok || now.Sub(rec.at) > humanMentionDedupWindow {
		return false
	}
	// Suppress the same task or an untagged follow-up right after a mention; a different
	// board item (taskID > 0 && rec.taskID > 0 && taskID != rec.taskID) still notifies.
	return taskID == 0 || rec.taskID == 0 || taskID == rec.taskID
}

func (g *humanMentionGate) record(sessionKey, userID string, taskID int) {
	userID = strings.TrimSpace(userID)
	ch := teamChatKey(sessionKey)
	if userID == "" || ch == "" {
		return
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.records == nil {
		g.records = make(map[humanMentionKey]humanMentionRecord)
	}
	now := g.currentTime()
	g.pruneLocked(now)
	g.records[humanMentionKey{channel: ch, user: userID}] = humanMentionRecord{
		taskID: taskID,
		at:     now,
	}
}

func (e *Engine) isHumanMentionDeduped(sessionKey, userID string, taskID int) bool {
	return e.humanMentions.isDeduped(sessionKey, userID, taskID)
}

func (e *Engine) recordHumanMention(sessionKey, userID string, taskID int) {
	e.humanMentions.record(sessionKey, userID, taskID)
}

var discordMentionRe = regexp.MustCompile(`<@!?(\d+)>`)

func extractMentionUserIDs(text string) []string {
	matches := discordMentionRe.FindAllStringSubmatch(text, -1)
	if len(matches) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(matches))
	out := make([]string, 0, len(matches))
	for _, m := range matches {
		id := m[1]
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

func (e *Engine) ownerUserForSession(sessionKey string) (string, string) {
	var p Platform
	if name, _, err := parseSessionKeyParts(sessionKey); err == nil {
		p = e.platformForName(name)
	}
	if p == nil && len(e.platforms) > 0 {
		p = e.platforms[0]
	}
	platName := ""
	if p != nil {
		platName = p.Name()
	}
	if u := e.dmUser(); u != "" {
		return platName, u
	}
	if o, ok := p.(PlatformOwner); ok {
		return platName, o.OwnerUserID()
	}
	return platName, ""
}

// prepareAskUserMention prepares an explicit --ask-user send: it allows mentions of the named
// human(s) (from atUsers or <@id> in message), or prepends the project owner when none is named.
// Any user already mentioned by this bot in this channel within humanMentionDedupWindow stays as
// plain text without triggering a second notification.
func (e *Engine) prepareAskUserMention(sessionKey, message string, atUsers []string, taskID int) (string, []string) {
	seen := map[string]struct{}{}
	var targets []string
	add := func(id string) {
		id = strings.TrimSpace(id)
		if id == "" {
			return
		}
		if _, ok := seen[id]; ok {
			return
		}
		seen[id] = struct{}{}
		targets = append(targets, id)
	}
	for _, id := range atUsers {
		add(id)
	}
	for _, id := range extractMentionUserIDs(message) {
		add(id)
	}
	if len(targets) == 0 {
		if platName, owner := e.ownerUserForSession(sessionKey); owner != "" {
			add(owner)
			if m := watchMention(platName, owner); m != "" && message != "" {
				message = m + " " + message
			}
		}
	}
	var allowed []string
	for _, id := range targets {
		if !e.isHumanMentionDeduped(sessionKey, id, taskID) {
			allowed = append(allowed, id)
		}
	}
	return message, allowed
}
