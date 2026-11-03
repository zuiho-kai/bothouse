package qq

import "testing"

// Only a real QQ group context batches its busy queue; a private chat or an unknown context keeps
// the plain queue (core.GroupQueueBatcher).
func TestBatchGroupQueueFollowsReplyContext(t *testing.T) {
	p := &Platform{}
	for _, c := range []struct {
		name string
		ctx  any
		want bool
	}{
		{"group", &replyContext{messageType: "group", groupID: 1, userID: 2}, true},
		{"private", &replyContext{messageType: "private", userID: 2}, false},
		{"empty type", &replyContext{groupID: 1}, false},
		{"nil replyContext", (*replyContext)(nil), false},
		{"nil", nil, false},
		{"foreign context", "group", false},
	} {
		if got := p.BatchGroupQueue(c.ctx); got != c.want {
			t.Errorf("%s: BatchGroupQueue = %v, want %v", c.name, got, c.want)
		}
	}
}
