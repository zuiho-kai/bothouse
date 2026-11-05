package qq

import "testing"

func TestQuietSystemNoticesOnlyInGroups(t *testing.T) {
	p := &Platform{}
	for key, want := range map[string]bool{"qq:g:795722872": true, "qq:795722872:42": true, "qq:42": false} {
		rc, err := p.ReconstructReplyCtx(key)
		if err != nil {
			t.Fatal(err)
		}
		if got := p.QuietSystemNotices(rc); got != want {
			t.Errorf("%s: QuietSystemNotices = %v, want %v", key, got, want)
		}
	}
	if p.QuietSystemNotices("not a qq reply ctx") {
		t.Error("foreign reply context must not be quieted")
	}
}

// The insert acknowledgement is the one notice QQ keeps out of private chats too.
func TestQuietInsertReceiptInGroupsAndPrivate(t *testing.T) {
	p := &Platform{}
	for key := range map[string]bool{"qq:g:795722872": true, "qq:795722872:42": true, "qq:42": true} {
		rc, err := p.ReconstructReplyCtx(key)
		if err != nil {
			t.Fatal(err)
		}
		if !p.QuietInsertReceipt(rc) {
			t.Errorf("%s: QuietInsertReceipt = false, want true", key)
		}
	}
	if p.QuietInsertReceipt("not a qq reply ctx") {
		t.Error("foreign reply context must not be quieted")
	}
}
