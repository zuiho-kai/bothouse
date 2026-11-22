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
}

type mentionGateTestPlatform struct {
	*reportTestPlatform
	owner string
	recMu sync.Mutex
	sends []recordedSend
}

func (p *mentionGateTestPlatform) OwnerUserID() string { return p.owner }

func (p *mentionGateTestPlatform) Send(ctx context.Context, rc any, content string) error {
	p.recMu.Lock()
	p.sends = append(p.sends, recordedSend{
		target:      rc.(string),
		content:     content,
		allowHumans: AllowedHumanMentions(ctx),
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

// #2091: ordinary replies containing <@human> do not allow human notifications; a release post
// (ws-pass) notifies the assigner once; follow-up mentions of the same human by the same bot in
// the same channel within humanMentionDedupWindow are suppressed (both same-task --mention-assigner
// and untagged --ask-user), while a different task or a post after the window notifies normally.
func TestMentionGateReleaseAndDedup(t *testing.T) {
	e, rp, _, item := heldFixture(t)
	mp := &mentionGateTestPlatform{reportTestPlatform: rp, owner: "1498"}
	e.platforms = []Platform{mp}
	e.SetMentionAssigner(true)

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
	if len(recs) != 1 || !strings.Contains(recs[0].content, "<@1498>") || len(recs[0].allowHumans) != 0 {
		t.Fatalf("ordinary send = %+v, want text kept and no allowed humans", recs)
	}

	// 2. Release post (ws-pass) notifies assigner once.
	holdForTest(t, e, mp, item, "")
	if w := verdictCall(t, e, 46, "pass", "逐条：做到了"); w.Code != http.StatusOK {
		t.Fatalf("pass = %d %s", w.Code, w.Body)
	}
	recs = mp.sentRecords()
	if len(recs) != 2 || !strings.HasPrefix(recs[1].content, "<@1498> 📬") || !slices.Equal(recs[1].allowHumans, []string{"1498"}) {
		t.Fatalf("release post = %+v, want prefix <@1498> and allowHumans=[1498]", recs[1])
	}

	// 3. Immediate duplicate --mention-assigner for the same task #46 within the window: suppressed.
	now = now.Add(30 * time.Second)
	postSendReq(t, e, SendRequest{Project: e.name, SessionKey: "discord:chat1", Message: "补充成品", MentionAssigner: 46})
	recs = mp.sentRecords()
	if len(recs) != 3 || recs[2].content != "补充成品" || len(recs[2].allowHumans) != 0 {
		t.Fatalf("duplicate same-task send = %+v, want no mention and no allowed humans", recs[2])
	}

	// 4. Immediate untagged --ask-user to the same human in the same channel within the window:
	// text keeps <@1498>, notification is suppressed.
	now = now.Add(15 * time.Second)
	postSendReq(t, e, SendRequest{Project: e.name, SessionKey: "discord:chat1", Message: "<@1498> 顺便补充一句", AskUser: true})
	recs = mp.sentRecords()
	if len(recs) != 4 || !strings.Contains(recs[3].content, "<@1498>") || len(recs[3].allowHumans) != 0 {
		t.Fatalf("immediate follow-up ask = %+v, want text kept and notification suppressed", recs[3])
	}

	// 5. A different task #47 released in the same channel still notifies once.
	postSendReq(t, e, SendRequest{Project: e.name, SessionKey: "discord:chat1", Message: "第二件活成品", MentionAssigner: 47})
	recs = mp.sentRecords()
	if len(recs) != 5 || recs[4].content != "<@1498> 第二件活成品" || !slices.Equal(recs[4].allowHumans, []string{"1498"}) {
		t.Fatalf("different task #47 = %+v, want mention allowed", recs[4])
	}

	// 6. After humanMentionDedupWindow expires, #46 notifies again.
	now = now.Add(humanMentionDedupWindow + time.Second)
	postSendReq(t, e, SendRequest{Project: e.name, SessionKey: "discord:chat1", Message: "返工后成品", MentionAssigner: 46})
	recs = mp.sentRecords()
	if len(recs) != 6 || recs[5].content != "<@1498> 返工后成品" || !slices.Equal(recs[5].allowHumans, []string{"1498"}) {
		t.Fatalf("after window expiry = %+v, want mention allowed again", recs[5])
	}
}

// #2091: both decision-ask exits allow human mentions (ws-forward --ask-user via taskForumCallInChat,
// and direct lead ask via bothouse send --ask-user), regardless of mention_assigner switch state.
func TestMentionGateAskUserExit(t *testing.T) {
	t.Run("send_ask_user_auto_and_explicit", func(t *testing.T) {
		e, rp, _, _ := heldFixture(t)
		mp := &mentionGateTestPlatform{reportTestPlatform: rp, owner: "1498"}
		e.platforms = []Platform{mp}
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
		if recs[0].content != "<@1498> 开关默认关，要不要打开？" || !slices.Equal(recs[0].allowHumans, []string{"1498"}) {
			t.Fatalf("auto owner ask = %+v", recs[0])
		}
		if recs[1].content != "<@999> 这个方案你拍板一下？" || !slices.Equal(recs[1].allowHumans, []string{"999"}) {
			t.Fatalf("explicit ask = %+v", recs[1])
		}
	})

	t.Run("ws_forward_ask_user_chat_call", func(t *testing.T) {
		e, rp, _, item := heldFixture(t)
		mp := &mentionGateTestPlatform{reportTestPlatform: rp, owner: "1498"}
		e.platforms = []Platform{mp}
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
		if !slices.Equal(recs[0].allowHumans, []string{"1498"}) {
			t.Fatalf("first ask-user chat call allowHumans = %v, want [1498]", recs[0].allowHumans)
		}
		if len(recs[1].allowHumans) != 0 {
			t.Fatalf("duplicate ask-user chat call allowHumans = %v, want empty", recs[1].allowHumans)
		}
	})
}

// #2091: when mention_assigner is off, release posts stay unmentioned and allow no human pings.
func TestMentionGateSwitchOffKeepsReleaseQuiet(t *testing.T) {
	e, rp, _, item := heldFixture(t)
	mp := &mentionGateTestPlatform{reportTestPlatform: rp, owner: "1498"}
	e.platforms = []Platform{mp}
	item.Assigner = &teamTaskAssigner{ID: "1498", Name: "zz", Kind: CallerHuman}
	writeReviewBoard(t, e, *item)

	holdForTest(t, e, mp, item, "")
	if w := verdictCall(t, e, 46, "pass", "逐条：做到了"); w.Code != http.StatusOK {
		t.Fatalf("pass = %d %s", w.Code, w.Body)
	}
	postSendReq(t, e, SendRequest{Project: e.name, SessionKey: "discord:chat1", Message: "成品附件", MentionAssigner: 46})

	recs := mp.sentRecords()
	if len(recs) != 2 {
		t.Fatalf("sent %d messages, want 2", len(recs))
	}
	for i, r := range recs {
		if strings.Contains(r.content, "<@") || len(r.allowHumans) != 0 {
			t.Fatalf("send[%d] with mention_assigner off = %+v, want no mention and no allowed humans", i, r)
		}
	}
}
