package feishu

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	lark "github.com/larksuite/oapi-sdk-go/v3"
	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"

	"github.com/chenhg5/cc-connect/core"
)

// teamTestServer answers the token call and every other Feishu API call with success, and keeps
// the bodies posted to the message create / reply endpoints.
type teamTestServer struct {
	*httptest.Server
	mu   sync.Mutex
	sent []string
}

func newTeamTestServer(t *testing.T) *teamTestServer {
	ts := &teamTestServer{}
	ts.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/open-apis/auth/v3/tenant_access_token/internal" {
			writeJSON(t, w, map[string]any{"code": 0, "msg": "success", "expire": 7200, "tenant_access_token": "tok"})
			return
		}
		if r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/open-apis/im/v1/messages") {
			raw, _ := io.ReadAll(r.Body)
			ts.mu.Lock()
			ts.sent = append(ts.sent, string(raw))
			ts.mu.Unlock()
			writeJSON(t, w, map[string]any{"code": 0, "data": map[string]any{"message_id": "om_sent"}})
			return
		}
		writeJSON(t, w, map[string]any{"code": 0, "msg": "success", "data": map[string]any{}})
	}))
	t.Cleanup(ts.Close)
	return ts
}

func (ts *teamTestServer) sentBodies() []string {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	return append([]string(nil), ts.sent...)
}

// sentText is the text of the n-th posted message (msg_type must be text).
func (ts *teamTestServer) sentText(t *testing.T, n int) string {
	t.Helper()
	bodies := ts.sentBodies()
	if n >= len(bodies) {
		t.Fatalf("only %d messages sent, want index %d", len(bodies), n)
	}
	var req struct {
		MsgType string `json:"msg_type"`
		Content string `json:"content"`
	}
	if err := json.Unmarshal([]byte(bodies[n]), &req); err != nil {
		t.Fatalf("sent body %q: %v", bodies[n], err)
	}
	if req.MsgType != larkim.MsgTypeText {
		t.Fatalf("msg_type = %q, want text (only text <at> notifies): %s", req.MsgType, bodies[n])
	}
	var c struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal([]byte(req.Content), &c); err != nil {
		t.Fatalf("sent content %q: %v", req.Content, err)
	}
	return c.Text
}

func (ts *teamTestServer) platform(received chan *core.Message) *Platform {
	return &Platform{
		platformName: "feishu", domain: ts.URL, appID: "cli_team", appSecret: "s", botOpenID: "ou_self",
		dedup:   &core.MessageDedup{},
		client:  lark.NewClient("cli_team", "s", lark.WithOpenBaseUrl(ts.URL), lark.WithHttpClient(ts.Client())),
		handler: func(_ core.Platform, msg *core.Message) { received <- msg },
	}
}

var teamTestMsgSeq int

// teamGroupEvent is a group text message from senderID that @-s every id in mentioned.
func teamGroupEvent(senderType, senderID string, mentioned ...string) *larkim.P2MessageReceiveV1 {
	teamTestMsgSeq++
	chatType, ct := "group", strconv.FormatInt(time.Now().UnixMilli(), 10)
	text := ""
	var mentions []*larkim.MentionEvent
	for i, id := range mentioned {
		key := "@_user_" + strconv.Itoa(i+1)
		text += key + " "
		mentions = append(mentions, &larkim.MentionEvent{Key: stringPtr(key), Id: &larkim.UserId{OpenId: stringPtr(id)}, Name: stringPtr(id)})
	}
	content := `{"text":"` + text + `把注册页修了"}`
	return &larkim.P2MessageReceiveV1{Event: &larkim.P2MessageReceiveV1Data{
		Sender: &larkim.EventSender{SenderId: &larkim.UserId{OpenId: stringPtr(senderID)}, SenderType: &senderType},
		Message: &larkim.EventMessage{MessageId: stringPtr("om_team_" + strconv.Itoa(teamTestMsgSeq)), ChatId: stringPtr("oc_chat"),
			ChatType: &chatType, MessageType: stringPtr("text"), Content: &content, CreateTime: &ct, Mentions: mentions},
	}}
}

func deliver(t *testing.T, p *Platform, received chan *core.Message, ev *larkim.P2MessageReceiveV1) *core.Message {
	t.Helper()
	if err := p.onMessage(context.Background(), ev); err != nil {
		t.Fatalf("onMessage: %v", err)
	}
	select {
	case msg := <-received:
		return msg
	case <-time.After(500 * time.Millisecond):
		return nil
	}
}

func TestSenderIsBotAcceptsAppAndBot(t *testing.T) {
	for st, want := range map[string]bool{"app": true, "bot": true, "user": false, "": false} {
		st := st
		if got := senderIsBot(&larkim.EventSender{SenderType: &st}); got != want {
			t.Errorf("senderIsBot(%q) = %v, want %v", st, got, want)
		}
	}
	if senderIsBot(nil) || senderIsBot(&larkim.EventSender{}) {
		t.Error("a sender without a type is not a bot")
	}
}

// A bot listed in allow_bots that @-s this bot gets in, marked FromBot and Mentioned, whichever
// of the two bot sender types the event carries, and without having to be in allow_from.
func TestOnMessageAllowedBotMentioningSelfGetsIn(t *testing.T) {
	ts := newTeamTestServer(t)
	for _, senderType := range []string{"app", "bot"} {
		received := make(chan *core.Message, 1)
		p := ts.platform(received)
		p.allowBots, p.allowFrom = "ou_other, ou_lead", "ou_owner"
		msg := deliver(t, p, received, teamGroupEvent(senderType, "ou_lead", "ou_self"))
		if msg == nil {
			t.Fatalf("sender_type %q: allowed bot's @ was dropped", senderType)
		}
		if !msg.FromBot || !msg.Mentioned || msg.UserID != "ou_lead" || msg.Content != "把注册页修了" {
			t.Errorf("sender_type %q: got FromBot=%v Mentioned=%v UserID=%q Content=%q", senderType, msg.FromBot, msg.Mentioned, msg.UserID, msg.Content)
		}
	}
	if sent := ts.sentBodies(); len(sent) != 0 {
		t.Errorf("an allowed bot outside allow_from must not get the unauthorized reply: %v", sent)
	}
}

func TestOnMessageDropsOtherBotMessages(t *testing.T) {
	ts := newTeamTestServer(t)
	cases := []struct {
		name          string
		allowBots     string
		groupReplyAll bool
		ev            *larkim.P2MessageReceiveV1
	}{
		{"no allow_bots", "", false, teamGroupEvent("app", "ou_lead", "ou_self")},
		{"not listed, app", "ou_other", false, teamGroupEvent("app", "ou_lead", "ou_self")},
		{"not listed, bot", "ou_other", false, teamGroupEvent("bot", "ou_lead", "ou_self")},
		{"listed, no mention", "ou_lead", false, teamGroupEvent("bot", "ou_lead")},
		{"listed, mentions someone else", "ou_lead", false, teamGroupEvent("bot", "ou_lead", "ou_third")},
		{"listed, no mention, group_reply_all", "ou_lead", true, teamGroupEvent("app", "ou_lead")},
	}
	for _, tc := range cases {
		received := make(chan *core.Message, 1)
		p := ts.platform(received)
		p.allowBots, p.groupReplyAll = tc.allowBots, tc.groupReplyAll
		if msg := deliver(t, p, received, tc.ev); msg != nil {
			t.Errorf("%s: bot message dispatched: %+v", tc.name, msg)
		}
	}
	if sent := ts.sentBodies(); len(sent) != 0 {
		t.Errorf("a dropped bot message must not be answered: %v", sent)
	}
}

func TestTeamOptionsParsed(t *testing.T) {
	anyP, err := newPlatform("feishu", lark.FeishuBaseUrl, map[string]any{
		"app_id": "cli_team", "app_secret": "s", "allow_bots": "ou_a,ou_b", "team_lead_bot": "ou_lead",
	})
	if err != nil {
		t.Fatalf("newPlatform: %v", err)
	}
	p := anyP.(*interactivePlatform).Platform
	if !p.botAllowed("ou_b") || p.botAllowed("ou_c") {
		t.Errorf("allow_bots = %q not applied", p.allowBots)
	}
	if p.teamLead != "ou_lead" {
		t.Errorf("team_lead_bot = %q", p.teamLead)
	}
	if _, ok := anyP.(core.ConfiguredTeamLead); !ok {
		t.Error("the platform core gets must implement core.ConfiguredTeamLead")
	}
	if _, ok := anyP.(core.ConfiguredTeamLeadSelf); !ok {
		t.Error("the platform core gets must implement core.ConfiguredTeamLeadSelf")
	}
	if _, ok := anyP.(core.FinalReplyMarker); !ok {
		t.Error("the platform core gets must implement core.FinalReplyMarker")
	}
	if _, ok := anyP.(core.InjectedReplyMerger); !ok {
		t.Error("the platform core gets must implement core.InjectedReplyMerger")
	}
}

func TestConfiguredTeamLead(t *testing.T) {
	cases := []struct {
		lead, self      string
		hasLead, isSelf bool
	}{
		{"", "ou_self", false, false},
		{"ou_lead", "ou_self", true, false},
		{"ou_self", "ou_self", true, true},
		{"", "", false, false},
	}
	for _, tc := range cases {
		p := &Platform{teamLead: tc.lead, botOpenID: tc.self}
		if p.HasConfiguredTeamLead() != tc.hasLead || p.IsConfiguredTeamLead() != tc.isSelf {
			t.Errorf("lead=%q self=%q: Has=%v Is=%v, want %v %v", tc.lead, tc.self,
				p.HasConfiguredTeamLead(), p.IsConfiguredTeamLead(), tc.hasLead, tc.isSelf)
		}
	}
}

// Which inbound messages mark the turn as dispatched by the lead.
func TestOnMessageMarksLeadDispatch(t *testing.T) {
	ts := newTeamTestServer(t)
	cases := []struct {
		name     string
		teamLead string
		ev       *larkim.P2MessageReceiveV1
		want     string
	}{
		{"lead bot @-s this sub", "ou_lead", teamGroupEvent("bot", "ou_lead", "ou_self"), "ou_lead"},
		{"another allowed bot @-s this sub", "ou_lead", teamGroupEvent("bot", "ou_other", "ou_self"), ""},
		{"person @-s this sub and the lead", "ou_lead", teamGroupEvent("user", "ou_user", "ou_self", "ou_lead"), "ou_lead"},
		{"person @-s this sub only", "ou_lead", teamGroupEvent("user", "ou_user", "ou_self"), ""},
		{"no team_lead_bot", "", teamGroupEvent("user", "ou_user", "ou_self", "ou_lead"), ""},
		{"this bot is the lead", "ou_self", teamGroupEvent("bot", "ou_other", "ou_self"), ""},
	}
	for _, tc := range cases {
		received := make(chan *core.Message, 1)
		p := ts.platform(received)
		p.allowBots, p.teamLead = "ou_lead,ou_other", tc.teamLead
		msg := deliver(t, p, received, tc.ev)
		if msg == nil {
			t.Fatalf("%s: message dropped", tc.name)
		}
		if got := msg.ReplyCtx.(replyContext).lead; got != tc.want {
			t.Errorf("%s: lead = %q, want %q", tc.name, got, tc.want)
		}
	}
}

// The final answer of a lead-dispatched turn @-s the lead, once per trigger message; interim
// posts and turns nobody dispatched go out as written.
func TestFinalReplyReturnsToLead(t *testing.T) {
	ts := newTeamTestServer(t)
	p := ts.platform(nil)
	ctx := context.Background()
	const at = `<at user_id="ou_lead"></at> `

	dispatched := replyContext{chatID: "oc_chat", messageID: "om_1", lead: "ou_lead"}
	if err := p.Reply(ctx, dispatched, "还在查"); err != nil {
		t.Fatalf("Reply: %v", err)
	}
	if got := ts.sentText(t, 0); got != "还在查" {
		t.Errorf("interim post = %q, want no @", got)
	}
	final := p.MarkFinalReply(dispatched)
	if err := p.Reply(ctx, final, "修好了"); err != nil {
		t.Fatalf("Reply: %v", err)
	}
	if got := ts.sentText(t, 1); got != at+"修好了" {
		t.Errorf("final answer = %q, want %q", got, at+"修好了")
	}
	if err := p.Reply(ctx, final, "补一句"); err != nil {
		t.Fatalf("Reply: %v", err)
	}
	if got := ts.sentText(t, 2); got != "补一句" {
		t.Errorf("second final post for the same trigger = %q, want no second @", got)
	}

	// Send without a trigger message id to reply to still needs one to key the hand-back on.
	if err := p.Send(ctx, p.MarkFinalReply(replyContext{chatID: "oc_chat", messageID: "om_2", lead: "ou_lead"}), "**表格**在下面"); err != nil {
		t.Fatalf("Send: %v", err)
	}
	if got := ts.sentText(t, 3); got != at+"**表格**在下面" {
		t.Errorf("markdown final answer = %q, want the @ and plain text", got)
	}
	if err := p.SendWithStatusFooter(ctx, p.MarkFinalReply(replyContext{chatID: "oc_chat", messageID: "om_3", lead: "ou_lead"}), "交回", "耗时 3s"); err != nil {
		t.Fatalf("SendWithStatusFooter: %v", err)
	}
	if got := ts.sentText(t, 4); got != at+"交回\n\n耗时 3s" {
		t.Errorf("final answer with footer = %q", got)
	}
	already := `<at user_id="ou_lead">橘</at> 交回`
	if err := p.Reply(ctx, p.MarkFinalReply(replyContext{chatID: "oc_chat", messageID: "om_4", lead: "ou_lead"}), already); err != nil {
		t.Fatalf("Reply: %v", err)
	}
	if got := ts.sentText(t, 5); got != already {
		t.Errorf("answer that already @-s the lead = %q, want it unchanged", got)
	}
	if err := p.Reply(ctx, p.MarkFinalReply(replyContext{chatID: "oc_chat", messageID: "om_5"}), "没人派的活"); err != nil {
		t.Fatalf("Reply: %v", err)
	}
	if got := ts.sentText(t, 6); got != "没人派的活" {
		t.Errorf("final answer of an undispatched turn = %q, want no @", got)
	}
}

func TestMarkFinalReplyLeavesOtherContextsAlone(t *testing.T) {
	p := &Platform{}
	if rc := p.MarkFinalReply(replyContext{messageID: "m", lead: "ou_lead"}).(replyContext); !rc.final || rc.lead != "ou_lead" || rc.messageID != "m" {
		t.Errorf("MarkFinalReply = %+v", rc)
	}
	if got := p.MarkFinalReply("other"); got != "other" {
		t.Errorf("foreign context changed: %v", got)
	}
}

// A lead's @ injected into a running turn marks that turn as lead-dispatched; the turn keeps
// answering its own trigger.
func TestMergeInjectedReplyKeepsLead(t *testing.T) {
	p := &Platform{}
	turn := replyContext{messageID: "om_turn", chatID: "oc_chat"}
	injected := replyContext{messageID: "om_injected", chatID: "oc_chat", lead: "ou_lead"}

	got := p.MergeInjectedReply(turn, injected).(replyContext)
	if got.lead != "ou_lead" || got.messageID != "om_turn" {
		t.Errorf("merged = %+v, want the turn's context with lead ou_lead", got)
	}
	got = p.MergeInjectedReply(replyContext{messageID: "om_turn", lead: "ou_lead"}, replyContext{messageID: "om_injected"}).(replyContext)
	if got.lead != "ou_lead" || got.messageID != "om_turn" {
		t.Errorf("an injected message without the mark must not clear it: %+v", got)
	}
	got = p.MergeInjectedReply(turn, replyContext{messageID: "om_injected"}).(replyContext)
	if got.lead != "" {
		t.Errorf("nothing dispatched, lead = %q", got.lead)
	}
	if got := p.MergeInjectedReply("other", injected); got != "other" {
		t.Errorf("foreign turn context changed: %v", got)
	}
}

func TestRichCardContinuationReplyTargetsInsertedMessage(t *testing.T) {
	p := &Platform{}
	turn := replyContext{messageID: "om_turn", chatID: "oc_chat", sessionKey: "turn-session"}
	inserted := replyContext{messageID: "om_inserted", chatID: "oc_chat", lead: "ou_lead"}
	got, ok := p.RichCardContinuationReply(turn, inserted)
	if !ok {
		t.Fatal("no continuation target for the inserted Feishu message")
	}
	if rc := got.(replyContext); rc.messageID != inserted.messageID || rc.sessionKey != turn.sessionKey || rc.lead != inserted.lead {
		t.Errorf("continuation = %+v, want inserted message with the running session and lead", rc)
	}
	if _, ok := p.RichCardContinuationReply(turn, replyContext{chatID: turn.chatID}); ok {
		t.Error("synthetic input without a message ID should not move the card")
	}
}
