package core

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core/team"
)

// #988 (user 11-22 「谁布置的任务 需要拍板或者做完了要@他」): the final report opens with the
// mention of whoever set the task — on the lead's pass and on the unchecked post after the timeout.
// A bot or timer assigner gets the owner (admin_from); a row from before the field gets none.
func TestReportMentionsAssigner(t *testing.T) {
	for _, tc := range []struct {
		name     string
		assigner *teamTaskAssigner
		want     string
	}{
		{"person", &teamTaskAssigner{ID: "1498", Name: "zz", Kind: CallerHuman}, "<@1498> 📬「验证报告」"},
		{"timer", &teamTaskAssigner{ID: "timer", Name: "timer", Kind: CallerScheduled}, "<@777> 📬「验证报告」"},
		{"bot", &teamTaskAssigner{ID: "555", Name: "G哥", Kind: CallerBot}, "<@777> 📬「验证报告」"},
		{"old row", nil, "📬「验证报告」"},
	} {
		for _, timeout := range []bool{false, true} {
			t.Run(tc.name+map[bool]string{false: "/pass", true: "/timeout"}[timeout], func(t *testing.T) {
				e, p, _, item := heldFixture(t)
				e.SetAdminFrom("777")
				item.Assigner = tc.assigner
				writeReviewBoard(t, e, *item)
				holdForTest(t, e, p, item, "")
				if timeout {
					key := e.heldReportFor(46).Key
					e.teamExit.mu.Lock()
					e.teamExit.reports[key].CreatedAt = time.Now().Add(-leadAcceptTimeout - time.Second)
					e.teamExit.mu.Unlock()
					e.recoverPendingReports(true)
				} else if w := verdictCall(t, e, 46, "pass", "逐条：做到了"); w.Code != 200 {
					t.Fatalf("pass = %d %s", w.Code, w.Body)
				}
				got := p.sentTo("discord:chat1")
				if len(got) != 1 || !strings.HasPrefix(got[0], tc.want) || strings.Count(got[0], "<@") > 1 {
					t.Fatalf("post = %q, want it to open with %q and mention once", got, tc.want)
				}
				if tc.assigner == nil && strings.Contains(got[0], "<@") {
					t.Fatalf("old row mentioned someone: %q", got[0])
				}
			})
		}
	}
}

// The question passed on to the user (ws-forward --ask-user) calls the person who set the task;
// a timer-set task calls the owner, as do rows from before the field.
func TestAskCallsAssigner(t *testing.T) {
	for _, tc := range []struct{ name, assigner, want string }{
		{"person", `,"assigner":{"id":"999","name":"zz","kind":"human"}`, "999"},
		{"timer", `,"assigner":{"id":"timer","name":"timer","kind":"scheduled"}`, "123"},
		{"old row", "", "123"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e, p, dir := forumRoutingEngine(t)
			e.SetAdminFrom("123")
			row := func(extra string) {
				writeTaskBoard(t, dir, team.TaskBoardFile, `{"id":195,"what":"升 vLLM","status":"在做","chat":"discord:111","ws":"discord:222","dispatcher":"lead"`+tc.assigner+extra+"}\n")
			}
			row("")
			e.syncTaskForum()
			row(`,"wait_kind":"user","paused":"11-19 09:55","pause_why":"等待用户答复：要不要推 PR","ask":{"title":"要不要推 PR","to":"user","kind":"权限"}`)
			e.syncTaskForum()
			if len(p.mentions) != 1 || p.mentions[0] != tc.want {
				t.Fatalf("mentions=%v, want [%s]", p.mentions, tc.want)
			}
		})
	}
}

type ownerTestPlatform struct {
	*reportTestPlatform
	owner string
}

func (p ownerTestPlatform) OwnerUserID() string { return p.owner }

// With no admin_from the owner is the first user ID in the platform's allow_from (this machine's
// lead); admin_from wins when set; a person who set the task is never replaced by the owner.
func TestAssignerOwnerFallback(t *testing.T) {
	e, rp := reportFixture(t)
	p := ownerTestPlatform{rp, "1498"}
	timer := &teamTaskBoardItem{Assigner: &teamTaskAssigner{ID: "timer", Kind: CallerScheduled}}
	person := &teamTaskBoardItem{Assigner: &teamTaskAssigner{ID: "42", Kind: CallerHuman}}
	if got := e.assignerUser(p, timer); got != "1498" {
		t.Fatalf("no admin_from: %q, want the allow_from owner", got)
	}
	if got := e.withAssignerMention(p, timer, "📬"); got != "<@1498> 📬" {
		t.Fatalf("mention = %q", got)
	}
	if got := e.assignerUser(p, person); got != "42" {
		t.Fatalf("person = %q", got)
	}
	if got := e.assignerUser(p, &teamTaskBoardItem{}); got != "" {
		t.Fatalf("old row = %q", got)
	}
	e.SetAdminFrom("777")
	if got := e.assignerUser(p, timer); got != "777" {
		t.Fatalf("admin_from set: %q", got)
	}
}

// ws-pass posting the finished files (send --mention-assigner) is the result too (lead 11-23: 「很多活的
// 最终结果就是视频、图片这类附件」): the message opens with the assigner's mention, once; a row from
// before the field gets none.
func TestSendMentionAssigner(t *testing.T) {
	for _, tc := range []struct {
		name     string
		assigner *teamTaskAssigner
		want     string
	}{
		{"person", &teamTaskAssigner{ID: "1498", Kind: CallerHuman}, "<@1498> 成片给你看"},
		{"timer", &teamTaskAssigner{ID: "timer", Kind: CallerScheduled}, "<@777> 成片给你看"},
		{"old row", nil, "成片给你看"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e, p, _, item := heldFixture(t)
			e.SetAdminFrom("777")
			item.Assigner = tc.assigner
			writeReviewBoard(t, e, *item)
			s := &APIServer{engines: map[string]*Engine{e.name: e}}
			b, _ := json.Marshal(SendRequest{Project: e.name, SessionKey: "discord:chat1", Message: "成片给你看",
				MentionAssigner: 46}) // the test platform takes no images; the mention goes on the text either way
			w := httptest.NewRecorder()
			s.handleSend(w, httptest.NewRequest(http.MethodPost, "/send", bytes.NewReader(b)))
			if w.Code != http.StatusOK {
				t.Fatalf("send = %d %s", w.Code, w.Body)
			}
			got := p.sentTo("discord:chat1")
			if len(got) != 1 || got[0] != tc.want {
				t.Fatalf("post = %q, want [%q]", got, tc.want)
			}
		})
	}
}
