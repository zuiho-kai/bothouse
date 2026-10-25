package discord

import (
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/bwmarrin/discordgo"
)

// Delegated-approval dedupe (maomao fork).
//
// Every permission approver is asked to approve the same request, so each of their
// agents may send its own "/permit <id> allow". The requester only honours the first
// one (core/permission_delegation.go), but the later ones still cost a message and an
// agent turn. A request counts as decided here only once the requester's own success
// receipt (MsgPermissionDelegatedDecision, sent as a reply to the winning /permit) is
// seen; a /permit alone is not enough, because the requester may have failed it or
// never received it. Once decided, this bot drops its own /permit for that id.

const (
	// Source: reviewed design 584-B v2 (keep ≥1h, 6h suggested; an approver's late
	// /permit came 2 minutes after the winner in the field data, an LLM turn can be longer).
	decidedPermitTTL = 6 * time.Hour
	// Source: reviewed design 584-B v2 (cap 512, drop oldest).
	decidedPermitLimit = 512
)

// permitReceiptRe matches the request-id field of MsgPermissionDelegatedDecision in
// every language (core/i18n.go).
var permitReceiptRe = regexp.MustCompile(`(?:request|请求|請求|要求|solicitud)=([0-9a-fA-F]{32})`)

// outgoingPermitRe matches a /permit decision inside outgoing text.
var outgoingPermitRe = regexp.MustCompile(`/permit\s+([0-9a-fA-F]{32})\s+(?:allow|deny)\b`)

type decidedPermits struct {
	mu    sync.Mutex
	at    map[string]time.Time
	order []string // insertion order, oldest first
	now   func() time.Time
}

func (d *decidedPermits) clock() time.Time {
	if d.now != nil {
		return d.now()
	}
	return time.Now()
}

func (d *decidedPermits) add(id string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.at == nil {
		d.at = map[string]time.Time{}
	}
	now := d.clock()
	d.pruneLocked(now)
	if _, ok := d.at[id]; ok {
		return
	}
	d.at[id] = now
	d.order = append(d.order, id)
	for len(d.order) > decidedPermitLimit {
		delete(d.at, d.order[0])
		d.order = d.order[1:]
	}
}

func (d *decidedPermits) has(id string) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	t, ok := d.at[id]
	return ok && d.clock().Sub(t) < decidedPermitTTL
}

func (d *decidedPermits) pruneLocked(now time.Time) {
	for len(d.order) > 0 {
		t, ok := d.at[d.order[0]]
		if ok && now.Sub(t) < decidedPermitTTL {
			return
		}
		delete(d.at, d.order[0])
		d.order = d.order[1:]
	}
}

// notePermitReceipt records the request id when m is a requester's success receipt for
// a delegated approval. It must run before isBotNotice drops ✅ messages and before
// ReferencedMessage is cleared. Only a receipt that replies to a /permit from a listed
// approver, and comes from the very bot that /permit @-ed, is trusted; so the requester
// may itself be in permission_approvers, and other bots cannot forge a receipt.
func (p *Platform) notePermitReceipt(m *discordgo.Message) {
	if m == nil || m.Author == nil || !strings.HasPrefix(strings.TrimSpace(m.Content), "✅") {
		return
	}
	match := permitReceiptRe.FindStringSubmatch(m.Content)
	if match == nil {
		return
	}
	ref := m.ReferencedMessage
	if ref == nil || ref.Author == nil || !p.CanApprovePermission(ref.Author.ID) {
		return
	}
	author := m.Author.ID
	if !strings.Contains(ref.Content, "<@"+author+">") && !strings.Contains(ref.Content, "<@!"+author+">") {
		return
	}
	id, _, ok := parsePermissionDecision(stripDiscordMention(ref.Content, author))
	if !ok || id != match[1] {
		return
	}
	p.decidedPermits.add(id)
}

// decidedPermitIn returns the first already-decided request id that content tries to
// approve or deny, or "".
func (p *Platform) decidedPermitIn(content string) string {
	if !strings.Contains(content, "/permit") {
		return ""
	}
	for _, match := range outgoingPermitRe.FindAllStringSubmatch(content, -1) {
		if p.decidedPermits.has(match[1]) {
			return match[1]
		}
	}
	return ""
}

// dropDecidedPermits removes lines carrying a /permit for an already-decided request.
func (p *Platform) dropDecidedPermits(content string) string {
	if p.decidedPermitIn(content) == "" {
		return content
	}
	var kept []string
	for _, line := range strings.Split(content, "\n") {
		if p.decidedPermitIn(line) == "" {
			kept = append(kept, line)
		}
	}
	return strings.Join(kept, "\n")
}

func errPermitDecided(id string) error {
	return fmt.Errorf("permission %s already decided; do not send another", id)
}
