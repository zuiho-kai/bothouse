package core

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
)

type recordedSend struct {
	target      string
	content     string
	allowHumans []string
	gateOn      bool
}

// notifiedHumans mirrors Discord's mention-notification rule for a recorded send:
// when mention_human_gate is off, any <@id> in content notifies; when on, only IDs both
// present in content and explicitly listed in allowHumans notify.
func (r recordedSend) notifiedHumans() []string {
	inText := extractMentionUserIDs(r.content)
	if !r.gateOn {
		return inText
	}
	var out []string
	for _, id := range inText {
		if slices.Contains(r.allowHumans, id) {
			out = append(out, id)
		}
	}
	return out
}

type mentionGateTestPlatform struct {
	*reportTestPlatform
	owner  string
	gateFn func() bool
	recMu  sync.Mutex
	sends  []recordedSend
}

func (p *mentionGateTestPlatform) OwnerUserID() string { return p.owner }

func (p *mentionGateTestPlatform) SetHumanMentionGate(enabled func() bool) {
	p.recMu.Lock()
	p.gateFn = enabled
	p.recMu.Unlock()
}

func (p *mentionGateTestPlatform) Send(ctx context.Context, rc any, content string) error {
	p.recMu.Lock()
	gateOn := p.gateFn != nil && p.gateFn()
	p.sends = append(p.sends, recordedSend{
		target:      rc.(string),
		content:     content,
		allowHumans: AllowedHumanMentions(ctx),
		gateOn:      gateOn,
	})
	p.recMu.Unlock()
	return p.reportTestPlatform.Send(ctx, rc, content)
}

func (p *mentionGateTestPlatform) sentRecords() []recordedSend {
	p.recMu.Lock()
	defer p.recMu.Unlock()
	out := make([]recordedSend, len(p.sends))
	copy(out, p.sends)
	return out
}

func postSendReq(t *testing.T, e *Engine, req SendRequest) {
	t.Helper()
	s := &APIServer{engines: map[string]*Engine{e.name: e}}
	b, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	s.handleSend(w, httptest.NewRequest(http.MethodPost, "/send", bytes.NewReader(b)))
	if w.Code != http.StatusOK {
		t.Fatalf("POST /send = %d %s", w.Code, w.Body)
	}
}

// #2091: with both mention_human_gate and mention_assigner enabled, ordinary replies containing
// <@human> do not allow human notifications; a release post (ws-pass) notifies the assigner once;
// follow-up mentions of the same human by the same bot in the same channel within
// humanMentionDedupWindow are suppressed (both same-task --mention-assigner and untagged
// --ask-user), while a different task or a post after the window notifies normally.
func TestMentionGateReleaseAndDedup(t *testing.T) {
	e, rp, _, item := heldFixture(t)
	mp := &mentionGateTestPlatform{reportTestPlatform: rp, owner: "1498"}
	e.platforms = []Platform{mp}
	e.SetMentionAssigner(true)
	e.SetMentionHumanGate(true)

	now := time.Date(2026, 11, 23, 5, 0, 0, 0, time.UTC)
	e.humanMentions.now = func() time.Time { return now }

	item.Assigner = &teamTaskAssigner{ID: "1498", Name: "zz", Kind: CallerHuman}
	item47 := *item
	item47.ID = 47
	item47.What = "另一件活"
	writeReviewBoard(t, e, *item, item47)

	// 1. Ordinary text send containing <@human>: visible text stays, human notification is NOT allowed.
	postSendReq(t, e, SendRequest{Project: e.name, SessionKey: "discord:chat1", Message: "<@1498> 打回去返工了"})
	recs := mp.sentRecords()
	if len(recs) != 1 || !strings.Contains(recs[0].content, "<@1498>") || len(recs[0].notifiedHumans()) != 0 {
		t.Fatalf("ordinary send = %+v, want text kept and no human notified", recs)
	}

	// 2. Release post (ws-pass) notifies assigner once.
	holdForTest(t, e, mp, item, "")
	if w := verdictCall(t, e, 46, "pass", "逐条：做到了"); w.Code != http.StatusOK {
		t.Fatalf("pass = %d %s", w.Code, w.Body)
	}
	recs = mp.sentRecords()
	if len(recs) != 2 || !strings.HasPrefix(recs[1].content, "<@1498> 📬") || !slices.Equal(recs[1].notifiedHumans(), []string{"1498"}) {
		t.Fatalf("release post = %+v, want prefix <@1498> and notified=[1498]", recs[1])
	}

	// 3. Immediate duplicate --mention-assigner for the same task #46 within the window: suppressed.
	now = now.Add(30 * time.Second)
	postSendReq(t, e, SendRequest{Project: e.name, SessionKey: "discord:chat1", Message: "补充成品", MentionAssigner: 46})
	recs = mp.sentRecords()
	if len(recs) != 3 || recs[2].content != "补充成品" || len(recs[2].notifiedHumans()) != 0 {
		t.Fatalf("duplicate same-task send = %+v, want no mention and no notified humans", recs[2])
	}

	// 4. Immediate untagged --ask-user to the same human in the same channel within the window:
	// text keeps <@1498>, notification is suppressed.
	now = now.Add(15 * time.Second)
	postSendReq(t, e, SendRequest{Project: e.name, SessionKey: "discord:chat1", Message: "<@1498> 顺便补充一句", AskUser: true})
	recs = mp.sentRecords()
	if len(recs) != 4 || !strings.Contains(recs[3].content, "<@1498>") || len(recs[3].notifiedHumans()) != 0 {
		t.Fatalf("immediate follow-up ask = %+v, want text kept and notification suppressed", recs[3])
	}

	// 5. A different task #47 released in the same channel still notifies once.
	postSendReq(t, e, SendRequest{Project: e.name, SessionKey: "discord:chat1", Message: "第二件活成品", MentionAssigner: 47})
	recs = mp.sentRecords()
	if len(recs) != 5 || recs[4].content != "<@1498> 第二件活成品" || !slices.Equal(recs[4].notifiedHumans(), []string{"1498"}) {
		t.Fatalf("different task #47 = %+v, want mention allowed", recs[4])
	}

	// 6. After humanMentionDedupWindow expires, #46 notifies again.
	now = now.Add(humanMentionDedupWindow + time.Second)
	postSendReq(t, e, SendRequest{Project: e.name, SessionKey: "discord:chat1", Message: "返工后成品", MentionAssigner: 46})
	recs = mp.sentRecords()
	if len(recs) != 6 || recs[5].content != "<@1498> 返工后成品" || !slices.Equal(recs[5].notifiedHumans(), []string{"1498"}) {
		t.Fatalf("after window expiry = %+v, want mention allowed again", recs[5])
	}
}

// #2091: both decision-ask exits allow human mentions when mention_human_gate is on
// (ws-forward --ask-user via taskForumCallInChat, and direct lead ask via bothouse send --ask-user),
// regardless of mention_assigner switch state.
func TestMentionGateAskUserExit(t *testing.T) {
	t.Run("send_ask_user_auto_and_explicit", func(t *testing.T) {
		e, rp, _, _ := heldFixture(t)
		mp := &mentionGateTestPlatform{reportTestPlatform: rp, owner: "1498"}
		e.platforms = []Platform{mp}
		e.SetMentionHumanGate(true)
		// mention_assigner stays off (default): --ask-user still notifies the human.

		now := time.Date(2026, 11, 23, 5, 10, 0, 0, time.UTC)
		e.humanMentions.now = func() time.Time { return now }

		// No <@id> in text: auto-prepends the owner and allows them.
		postSendReq(t, e, SendRequest{Project: e.name, SessionKey: "discord:chat1", Message: "开关默认关，要不要打开？", AskUser: true})
		// Explicit <@id> in another channel: keeps text as-is and allows that human.
		postSendReq(t, e, SendRequest{Project: e.name, SessionKey: "discord:chat2", Message: "<@999> 这个方案你拍板一下？", AskUser: true})

		recs := mp.sentRecords()
		if len(recs) != 2 {
			t.Fatalf("sent %d messages, want 2", len(recs))
		}
		if recs[0].content != "<@1498> 开关默认关，要不要打开？" || !slices.Equal(recs[0].notifiedHumans(), []string{"1498"}) {
			t.Fatalf("auto owner ask = %+v", recs[0])
		}
		if recs[1].content != "<@999> 这个方案你拍板一下？" || !slices.Equal(recs[1].notifiedHumans(), []string{"999"}) {
			t.Fatalf("explicit ask = %+v", recs[1])
		}
	})

	t.Run("ws_forward_ask_user_chat_call", func(t *testing.T) {
		e, rp, _, item := heldFixture(t)
		mp := &mentionGateTestPlatform{reportTestPlatform: rp, owner: "1498"}
		e.platforms = []Platform{mp}
		e.SetMentionHumanGate(true)
		now := time.Date(2026, 11, 23, 5, 20, 0, 0, time.UTC)
		e.humanMentions.now = func() time.Time { return now }

		if ok := e.taskForumCallInChat(t.Context(), mp, "discord:chat1", "1498", *item); !ok {
			t.Fatal("first taskForumCallInChat returned false")
		}
		// Immediate duplicate call for the same task within the window does not ping again.
		if ok := e.taskForumCallInChat(t.Context(), mp, "discord:chat1", "1498", *item); !ok {
			t.Fatal("second taskForumCallInChat returned false")
		}
		recs := mp.sentRecords()
		if len(recs) != 2 {
			t.Fatalf("sent %d messages, want 2", len(recs))
		}
		if !slices.Equal(recs[0].notifiedHumans(), []string{"1498"}) {
			t.Fatalf("first ask-user chat call notified = %v, want [1498]", recs[0].notifiedHumans())
		}
		if len(recs[1].notifiedHumans()) != 0 {
			t.Fatalf("duplicate ask-user chat call notified = %v, want empty", recs[1].notifiedHumans())
		}
	})
}

// #2091: mention_human_gate and mention_assigner are independent switches (both default off).
// Every one of the four combinations must behave cleanly without conflict:
//   - (off, off): bridge does not gate or auto-mention; role rules with <@human> ping freely.
//   - (off, on):  bridge auto-mentions assigner on release without gating or dedup (same as #2090).
//   - (on, off):  ordinary replies and rule-written <@human> in release posts stay quiet; decision
//                 asks (--ask-user / ws-forward --ask-user) ping once and dedup within the window.
//   - (on, on):   ordinary replies stay quiet; release posts and decision asks ping once and dedup.
func TestMentionSwitchFourCombinations(t *testing.T) {
	cases := []struct {
		name               string
		gateOn             bool
		assignerOn         bool
		wantOrdinaryPing   bool
		wantReleasePrefix  bool
		wantReleasePing    bool
		wantDupReleasePing bool
		wantAskPing        bool
		wantDupAskPing     bool
	}{
		{
			name:               "gate_off__assigner_off_default",
			gateOn:             false,
			assignerOn:         false,
			wantOrdinaryPing:   true,  // role rule <@1498> pings freely when gate is off
			wantReleasePrefix:  false, // mention_assigner is off
			wantReleasePing:    false,
			wantDupReleasePing: false,
			wantAskPing:        true,
			wantDupAskPing:     true, // no dedup while gate is off
		},
		{
			name:               "gate_off__assigner_on",
			gateOn:             false,
			assignerOn:         true,
			wantOrdinaryPing:   true, // role rule <@1498> pings freely when gate is off
			wantReleasePrefix:  true,
			wantReleasePing:    true,
			wantDupReleasePing: true, // no dedup while gate is off (exact #2090 behavior)
			wantAskPing:        true,
			wantDupAskPing:     true,
		},
		{
			name:               "gate_on__assigner_off",
			gateOn:             true,
			assignerOn:         false,
			wantOrdinaryPing:   false, // gate suppresses ordinary reply <@1498>
			wantReleasePrefix:  false, // mention_assigner is off
			wantReleasePing:    false,
			wantDupReleasePing: false,
			wantAskPing:        true,
			wantDupAskPing:     false, // dedup active while gate is on
		},
		{
			name:               "gate_on__assigner_on",
			gateOn:             true,
			assignerOn:         true,
			wantOrdinaryPing:   false, // gate suppresses ordinary reply <@1498>
			wantReleasePrefix:  true,
			wantReleasePing:    true,
			wantDupReleasePing: false, // dedup active while gate is on
			wantAskPing:        true,
			wantDupAskPing:     false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			e, rp, _, item := heldFixture(t)
			mp := &mentionGateTestPlatform{reportTestPlatform: rp, owner: "1498"}
			e.platforms = []Platform{mp}
			// Wire predicate through SetMentionHumanGate (both false and true) just like applyProjectSettings.
			e.SetMentionAssigner(tc.assignerOn)
			e.SetMentionHumanGate(tc.gateOn)

			now := time.Date(2026, 11, 23, 5, 30, 0, 0, time.UTC)
			e.humanMentions.now = func() time.Time { return now }

			item.Assigner = &teamTaskAssigner{ID: "1498", Name: "zz", Kind: CallerHuman}
			writeReviewBoard(t, e, *item)

			// 1. Ordinary reply containing <@1498> (e.g., from a role rule).
			postSendReq(t, e, SendRequest{Project: e.name, SessionKey: "discord:chat1", Message: "<@1498> 规则触发的普通回复"})
			rec0 := mp.sentRecords()[0]
			if !strings.Contains(rec0.content, "<@1498>") {
				t.Fatalf("ordinary reply stripped <@1498>: %q", rec0.content)
			}
			if got := slices.Contains(rec0.notifiedHumans(), "1498"); got != tc.wantOrdinaryPing {
				t.Fatalf("ordinary reply ping=%v, want %v (rec=%+v)", got, tc.wantOrdinaryPing, rec0)
			}

			// 2. Release post (ws-pass).
			holdForTest(t, e, mp, item, "")
			if w := verdictCall(t, e, 46, "pass", "逐条：做到了"); w.Code != http.StatusOK {
				t.Fatalf("pass = %d %s", w.Code, w.Body)
			}
			rec1 := mp.sentRecords()[1]
			if gotPrefix := strings.HasPrefix(rec1.content, "<@1498> 📬"); gotPrefix != tc.wantReleasePrefix {
				t.Fatalf("release prefix=%v, want %v (content=%q)", gotPrefix, tc.wantReleasePrefix, rec1.content)
			}
			if gotPing := slices.Contains(rec1.notifiedHumans(), "1498"); gotPing != tc.wantReleasePing {
				t.Fatalf("release ping=%v, want %v (rec=%+v)", gotPing, tc.wantReleasePing, rec1)
			}

			// 3. Immediate same-task --mention-assigner follow-up within dedup window.
			now = now.Add(20 * time.Second)
			postSendReq(t, e, SendRequest{Project: e.name, SessionKey: "discord:chat1", Message: "成品附件", MentionAssigner: 46})
			rec2 := mp.sentRecords()[2]
			if gotPing := slices.Contains(rec2.notifiedHumans(), "1498"); gotPing != tc.wantDupReleasePing {
				t.Fatalf("dup release ping=%v, want %v (rec=%+v)", gotPing, tc.wantDupReleasePing, rec2)
			}

			// 4. Decision ask in a fresh channel (ws-forward --ask-user via taskForumCallInChat)
			// followed immediately by a duplicate ask in the same channel.
			if ok := e.taskForumCallInChat(t.Context(), mp, "discord:chat2", "1498", *item); !ok {
				t.Fatal("first taskForumCallInChat returned false")
			}
			rec3 := mp.sentRecords()[3]
			if gotPing := slices.Contains(rec3.notifiedHumans(), "1498"); gotPing != tc.wantAskPing {
				t.Fatalf("first ask ping=%v, want %v (rec=%+v)", gotPing, tc.wantAskPing, rec3)
			}

			if ok := e.taskForumCallInChat(t.Context(), mp, "discord:chat2", "1498", *item); !ok {
				t.Fatal("second taskForumCallInChat returned false")
			}
			rec4 := mp.sentRecords()[4]
			if gotPing := slices.Contains(rec4.notifiedHumans(), "1498"); gotPing != tc.wantDupAskPing {
				t.Fatalf("dup ask ping=%v, want %v (rec=%+v)", gotPing, tc.wantDupAskPing, rec4)
			}
		})
	}
}

// #2091: hot reload toggling SetMentionHumanGate takes effect immediately, and in a team
// enabling mention_human_gate on the lead applies to teammate engines as well.
func TestMentionHumanGateHotReloadAndTeamLeadInheritance(t *testing.T) {
	dir := t.TempDir()
	rm := NewRelayManager("")

	lead := &Engine{name: "lead", relayManager: rm, team: &teamState{dir: dir, name: "C酱", inject: true}}
	sub := &Engine{name: "sub", relayManager: rm, team: &teamState{dir: dir, name: "大豆包", inject: false}}
	rm.RegisterEngine("lead", lead)
	rm.RegisterEngine("sub", sub)

	if lead.mentionHumanGateEnabled() || sub.mentionHumanGateEnabled() {
		t.Fatal("default should be off for both lead and sub")
	}

	// Enabling on lead applies to sub immediately.
	lead.SetMentionHumanGate(true)
	if !lead.mentionHumanGateEnabled() || !sub.mentionHumanGateEnabled() {
		t.Fatalf("lead=true should gate both lead (%v) and sub (%v)", lead.mentionHumanGateEnabled(), sub.mentionHumanGateEnabled())
	}

	// Hot-reloading lead back to false turns both off immediately.
	lead.SetMentionHumanGate(false)
	if lead.mentionHumanGateEnabled() || sub.mentionHumanGateEnabled() {
		t.Fatalf("lead=false should ungate both lead (%v) and sub (%v)", lead.mentionHumanGateEnabled(), sub.mentionHumanGateEnabled())
	}

	// Enabling only on sub gates sub without affecting lead.
	sub.SetMentionHumanGate(true)
	if lead.mentionHumanGateEnabled() || !sub.mentionHumanGateEnabled() {
		t.Fatalf("sub=true should gate only sub (lead=%v sub=%v)", lead.mentionHumanGateEnabled(), sub.mentionHumanGateEnabled())
	}
}
