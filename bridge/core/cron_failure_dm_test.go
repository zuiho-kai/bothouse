package core

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
)

// cronFailurePlatform is a QQ-like platform: group chats are quiet, the owner can be
// reached in a private chat, and every send records which chat it went to.
type cronFailurePlatform struct {
	n           string
	mu          sync.Mutex
	sent        []string // "<ctx>|<text>"
	openedFor   []string
	dmErr       error // returned by sends to the private chat
	normalGroup bool  // a group whose system notices are not quiet
}

func (p *cronFailurePlatform) Name() string               { return p.n }
func (p *cronFailurePlatform) Start(MessageHandler) error { return nil }
func (p *cronFailurePlatform) Stop() error                { return nil }
func (p *cronFailurePlatform) Reply(ctx context.Context, rc any, content string) error {
	return p.Send(ctx, rc, content)
}
func (p *cronFailurePlatform) Send(_ context.Context, rc any, content string) error {
	if rc == "private" && p.dmErr != nil {
		return p.dmErr
	}
	p.mu.Lock()
	p.sent = append(p.sent, rc.(string)+"|"+content)
	p.mu.Unlock()
	return nil
}
func (p *cronFailurePlatform) QuietSystemNotices(rc any) bool {
	return strings.Contains(rc.(string), ":g:") && !p.normalGroup
}
func (p *cronFailurePlatform) OpenDM(userID string) (string, error) {
	p.openedFor = append(p.openedFor, userID)
	return p.n + ":" + userID, nil
}

// qq:g:<id> is a group chat, qq:<id> a private chat (the QQ key shapes).
func (p *cronFailurePlatform) ReconstructReplyCtx(key string) (any, error) {
	if strings.Contains(key, ":g:") {
		return key, nil
	}
	return "private", nil
}
func (p *cronFailurePlatform) getSent() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]string(nil), p.sent...)
}

func newCronFailureFixture(t *testing.T, dmErr error) (*CronScheduler, *cronFailurePlatform) {
	t.Helper()
	store, err := NewCronStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	cs := NewCronScheduler(store)
	p := &cronFailurePlatform{n: "qq", dmErr: dmErr}
	e := NewEngine("p", &stubAgent{}, []Platform{p}, "", LangChinese)
	t.Cleanup(e.cancel)
	e.SetAdminFrom("10001")
	cs.RegisterEngine("p", e)
	return cs, p
}

// #258: in a quiet group the failure notice goes to the owner's private chat, not the group.
func TestCronFailureNotice_QuietGroupGoesToOwnerDM(t *testing.T) {
	cs, p := newCronFailureFixture(t, nil)
	cs.notifyFailure(&CronJob{ID: "j1", Project: "p", SessionKey: "qq:g:555", Description: "每日汇总"}, errors.New("exit status 1"))

	if len(p.openedFor) != 1 || p.openedFor[0] != "10001" {
		t.Fatalf("OpenDM called for %v, want the admin_from owner", p.openedFor)
	}
	want := "private|⚠️ 定时任务「每日汇总」失败：exit status 1"
	if got := p.getSent(); len(got) != 1 || got[0] != want {
		t.Fatalf("sent = %q, want only %q", got, want)
	}
}

// Private chats keep getting their notice directly.
func TestCronFailureNotice_PrivateChatUnchanged(t *testing.T) {
	cs, p := newCronFailureFixture(t, nil)
	cs.notifyFailure(&CronJob{ID: "j2", Project: "p", SessionKey: "qq:777", Description: "每日汇总"}, errors.New("boom"))

	if len(p.openedFor) != 0 {
		t.Fatalf("OpenDM should not be used outside quiet groups, got %v", p.openedFor)
	}
	if got := p.getSent(); len(got) != 1 || got[0] != "private|⚠️ 定时任务「每日汇总」失败：boom" {
		t.Fatalf("sent = %q", got)
	}
}

// A non-quiet group keeps the complete failure notice in its original group, without a DM.
func TestCronFailureNotice_NormalGroupUnchanged(t *testing.T) {
	cs, p := newCronFailureFixture(t, nil)
	p.normalGroup = true
	cs.notifyFailure(&CronJob{ID: "j4", Project: "p", SessionKey: "qq:g:777", Description: "每日汇总"}, errors.New("boom"))

	if len(p.openedFor) != 0 {
		t.Fatalf("OpenDM should not be used for a non-quiet group, got %v", p.openedFor)
	}
	if got := p.getSent(); len(got) != 1 || got[0] != "qq:g:777|⚠️ 定时任务「每日汇总」失败：boom" {
		t.Fatalf("sent = %q, want the original group notice only", got)
	}
}

// When the private message cannot be sent, the notice is logged and never falls back to the group.
func TestCronFailureNotice_DMFailureIsLoggedNotPostedToGroup(t *testing.T) {
	buf, restore := captureSlog(t)
	defer restore()
	cs, p := newCronFailureFixture(t, errors.New("not friends"))
	cs.notifyFailure(&CronJob{ID: "j3", Project: "p", SessionKey: "qq:g:555", Description: "每日汇总"}, errors.New("exit status 1"))

	if got := p.getSent(); len(got) != 0 {
		t.Fatalf("nothing should reach any chat, sent = %q", got)
	}
	logs := buf.String()
	for _, want := range []string{"j3", "not friends", "每日汇总"} {
		if !strings.Contains(logs, want) {
			t.Fatalf("log should mention %q, got:\n%s", want, logs)
		}
	}
}
