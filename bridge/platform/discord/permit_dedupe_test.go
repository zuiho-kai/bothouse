package discord

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/bwmarrin/discordgo"
	"github.com/chenhg5/cc-connect/core"
)

const (
	dedupeRequester = "200" // bot that asked for approval
	dedupeWinner    = "101" // approver whose /permit won
	dedupeSelf      = "102" // this bot: the later approver
)

var dedupeID = strings.Repeat("ab", 16)

func dedupePlatform(approvers ...string) *Platform {
	p := &Platform{botID: dedupeSelf, permissionApprovers: approvers, shareSessionInChannel: true}
	p.botRoleIDs.Store("guild", "role")
	p.channelNameCache.Store("channel", "test")
	p.handler = func(core.Platform, *core.Message) {}
	return p
}

func receiptMessage(author, content string, ref *discordgo.Message) *discordgo.MessageCreate {
	return &discordgo.MessageCreate{Message: &discordgo.Message{
		ID: "receipt-" + author + content[len(content)-4:], GuildID: "guild", ChannelID: "channel", Timestamp: time.Now(),
		Type: discordgo.MessageTypeReply, Author: &discordgo.User{ID: author, Bot: true}, Content: content, ReferencedMessage: ref,
	}}
}

func winnerPermit(target, id string) *discordgo.Message {
	return &discordgo.Message{ID: "permit", Author: &discordgo.User{ID: dedupeWinner, Bot: true}, Content: "<@" + target + "> /permit " + id + " allow"}
}

func zhReceipt(id string) string {
	return "✅ 代批记录：审批账号=" + dedupeWinner + "，请求=" + id + "，决定=allow"
}

func TestPermitReceiptRecordsDecidedID(t *testing.T) {
	for _, tc := range []struct {
		name      string
		approvers []string
		allowBots string
		msg       *discordgo.MessageCreate
		want      bool
	}{
		{name: "requester allowed via allow_bots", approvers: []string{dedupeWinner, dedupeSelf}, allowBots: dedupeRequester,
			msg: receiptMessage(dedupeRequester, zhReceipt(dedupeID), winnerPermit(dedupeRequester, dedupeID)), want: true},
		// Same bot both approves for others and asks for approval itself.
		{name: "requester is itself an approver", approvers: []string{dedupeWinner, dedupeSelf, dedupeRequester},
			msg: receiptMessage(dedupeRequester, zhReceipt(dedupeID), winnerPermit(dedupeRequester, dedupeID)), want: true},
		{name: "english receipt, nick mention", approvers: []string{dedupeWinner, dedupeSelf}, allowBots: dedupeRequester,
			msg: receiptMessage(dedupeRequester, "✅ Delegated permission: actor=101 request="+dedupeID+" decision=deny",
				&discordgo.Message{Author: &discordgo.User{ID: dedupeWinner, Bot: true}, Content: "<@!" + dedupeRequester + "> /permit " + dedupeID + " deny"}), want: true},
		{name: "forged by a bot the /permit did not address", approvers: []string{dedupeWinner, dedupeSelf}, allowBots: dedupeRequester + ",300",
			msg: receiptMessage("300", zhReceipt(dedupeID), winnerPermit(dedupeRequester, dedupeID))},
		{name: "replied-to author not an approver", approvers: []string{dedupeSelf}, allowBots: dedupeRequester + "," + dedupeWinner,
			msg: receiptMessage(dedupeRequester, zhReceipt(dedupeID), winnerPermit(dedupeRequester, dedupeID))},
		{name: "id mismatch", approvers: []string{dedupeWinner, dedupeSelf}, allowBots: dedupeRequester,
			msg: receiptMessage(dedupeRequester, zhReceipt(dedupeID), winnerPermit(dedupeRequester, strings.Repeat("cd", 16)))},
		{name: "no replied-to message", approvers: []string{dedupeWinner, dedupeSelf}, allowBots: dedupeRequester,
			msg: receiptMessage(dedupeRequester, zhReceipt(dedupeID), nil)},
		{name: "not a success receipt", approvers: []string{dedupeWinner, dedupeSelf}, allowBots: dedupeRequester,
			msg: receiptMessage(dedupeRequester, "❌ 错误：请求="+dedupeID, winnerPermit(dedupeRequester, dedupeID))},
		// Precondition unmet: the requester is not allowed in this bot's config, so nothing is recorded and nothing breaks.
		{name: "requester not allowed", approvers: []string{dedupeWinner, dedupeSelf},
			msg: receiptMessage(dedupeRequester, zhReceipt(dedupeID), winnerPermit(dedupeRequester, dedupeID))},
		{name: "old message after restart", approvers: []string{dedupeWinner, dedupeSelf}, allowBots: dedupeRequester,
			msg: func() *discordgo.MessageCreate {
				m := receiptMessage(dedupeRequester, zhReceipt(dedupeID), winnerPermit(dedupeRequester, dedupeID))
				m.Timestamp = time.Now().Add(-time.Hour)
				return m
			}()},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := dedupePlatform(tc.approvers...)
			p.allowBots = tc.allowBots
			p.handleMessageCreate(nil, tc.msg)
			if got := p.decidedPermits.has(dedupeID); got != tc.want {
				t.Fatalf("decided=%v want %v", got, tc.want)
			}
		})
	}
}

// Another approver's /permit alone (the requester may have failed it or never seen it) does not count as decided.
func TestPermitAloneIsNotDecided(t *testing.T) {
	p := dedupePlatform(dedupeWinner, dedupeSelf)
	p.allowBots = dedupeRequester
	m := winnerPermit(dedupeRequester, dedupeID)
	m.GuildID, m.ChannelID, m.Timestamp = "guild", "channel", time.Now()
	p.handleMessageCreate(nil, &discordgo.MessageCreate{Message: m})
	if p.decidedPermits.has(dedupeID) {
		t.Fatal("a bare /permit marked the request decided")
	}
}

type recordedSends struct {
	mu     sync.Mutex
	bodies []string
}

func (r *recordedSends) server(t *testing.T) *httptest.Server {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		body, _ := io.ReadAll(req.Body)
		r.mu.Lock()
		r.bodies = append(r.bodies, string(body))
		r.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"sent","channel_id":"channel"}`))
	}))
	t.Cleanup(server.Close)
	return server
}

func (r *recordedSends) all() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.bodies...)
}

func decidedPlatform(t *testing.T) (*Platform, *recordedSends) {
	rec := &recordedSends{}
	p := dedupePlatform(dedupeWinner, dedupeSelf)
	p.session = newTestDiscordSession(t, rec.server(t))
	p.decidedPermits.add(dedupeID)
	return p, rec
}

func TestSendRefusesDecidedPermit(t *testing.T) {
	rc := replyContext{channelID: "channel"}
	for _, decision := range []string{"allow", "deny"} {
		p, rec := decidedPlatform(t)
		err := p.Send(context.Background(), rc, "<@"+dedupeRequester+"> /permit "+dedupeID+" "+decision)
		if err == nil || !strings.Contains(err.Error(), "already decided") {
			t.Fatalf("%s: err=%v", decision, err)
		}
		if len(rec.all()) != 0 {
			t.Fatalf("%s: sent %v", decision, rec.all())
		}
	}
	p, rec := decidedPlatform(t)
	other := strings.Repeat("cd", 16)
	for _, content := range []string{"<@" + dedupeRequester + "> /permit " + other + " allow", "<@" + dedupeRequester + "> /permit " + other + " deny", "hello"} {
		if err := p.Send(context.Background(), rc, content); err != nil {
			t.Fatalf("%q blocked: %v", content, err)
		}
	}
	if len(rec.all()) != 3 {
		t.Fatalf("undecided messages not sent: %v", rec.all())
	}
}

func TestReplyDropsDecidedPermitLine(t *testing.T) {
	rc := replyContext{channelID: "channel"}
	p, rec := decidedPlatform(t)
	if err := p.Reply(context.Background(), rc, "<@"+dedupeRequester+"> /permit "+dedupeID+" allow\n"); err != nil {
		t.Fatalf("reply returned error: %v", err)
	}
	if len(rec.all()) != 0 {
		t.Fatalf("decided-only reply was sent: %v", rec.all())
	}
	if err := p.Reply(context.Background(), rc, "looked fine\n<@"+dedupeRequester+"> /permit "+dedupeID+" allow\ndone"); err != nil {
		t.Fatalf("reply returned error: %v", err)
	}
	sent := rec.all()
	if len(sent) != 1 || strings.Contains(sent[0], "/permit") || !strings.Contains(sent[0], "looked fine") || !strings.Contains(sent[0], "done") {
		t.Fatalf("wrong reply: %v", sent)
	}
}

func TestDecidedPermitsRetention(t *testing.T) {
	start := time.Now()
	now := start
	d := &decidedPermits{now: func() time.Time { return now }}
	d.add(dedupeID)
	for _, after := range []time.Duration{2 * time.Minute, time.Hour, 5 * time.Hour} {
		now = start.Add(after)
		if !d.has(dedupeID) {
			t.Fatalf("forgotten after %v", after)
		}
	}
	now = start.Add(decidedPermitTTL + time.Second)
	if d.has(dedupeID) {
		t.Fatal("kept past the retention window")
	}

	now = start
	d = &decidedPermits{now: func() time.Time { return now }}
	ids := make([]string, decidedPermitLimit+1)
	for i := range ids {
		ids[i] = strings.Repeat("0", 28) + string("0123456789abcdef"[i/256%16]) + string("0123456789abcdef"[i/16%16]) + string("0123456789abcdef"[i%16]) + "f"
		d.add(ids[i])
	}
	if d.has(ids[0]) || !d.has(ids[1]) || !d.has(ids[len(ids)-1]) || len(d.at) != decidedPermitLimit {
		t.Fatalf("cap not enforced oldest-first: size=%d", len(d.at))
	}
}
