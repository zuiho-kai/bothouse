package qq

import "testing"

// #258: OpenDM gives the private-chat key, and that key rebuilds a private reply context.
func TestOpenDMReturnsPrivateSessionKey(t *testing.T) {
	p := &Platform{}
	key, err := p.OpenDM(" 10001 ")
	if err != nil || key != "qq:10001" {
		t.Fatalf("OpenDM = %q, %v; want qq:10001", key, err)
	}
	rc, err := p.ReconstructReplyCtx(key)
	if err != nil {
		t.Fatal(err)
	}
	if r := rc.(*replyContext); r.messageType != "private" || r.userID != 10001 {
		t.Fatalf("reply context = %+v, want private chat with 10001", r)
	}
	if p.QuietSystemNotices(rc) {
		t.Fatal("the owner's private chat must not be quiet")
	}
	if _, err := p.OpenDM("abc"); err == nil {
		t.Fatal("a non-numeric ID must be rejected")
	}
}
