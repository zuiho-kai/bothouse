package core

import (
	"strings"
	"testing"
	"time"
)

// #2042: the progress card says the turn is waiting on the model, and when the
// CLI is retrying, which attempt; a running tool is not a model wait.
func TestModelWaitText(t *testing.T) {
	cases := []struct {
		last   EventType
		waited time.Duration
		retry  int
		want   string
	}{
		{"", 5 * time.Second, 0, ""},
		{"", 20 * time.Second, 0, "在等模型 20 秒"},
		{EventToolResult, 31 * time.Second, 0, "在等模型 31 秒"},
		{EventToolUse, 90 * time.Second, 0, ""},
		{EventPermissionRequest, 90 * time.Second, 0, ""},
		{"", 3 * time.Second, 2, "接口无响应，重试中（第 2 次，已等 3 秒）"},
	}
	for _, c := range cases {
		if got := modelWaitText(true, c.last, c.waited, c.retry); got != c.want {
			t.Errorf("modelWaitText(%q, %v, %d) = %q, want %q", c.last, c.waited, c.retry, got, c.want)
		}
	}
	if got := modelWaitText(false, "", 20*time.Second, 0); !strings.Contains(got, "Waiting on the model") {
		t.Errorf("en: %q", got)
	}
}

type fakeRetrier int

func (f fakeRetrier) APIRetryAttempt() int { return int(f) }

// A queued message restarts the wait: the previous message's last tool call
// no longer counts.
func TestModelWaitRestartsWithQueuedMessage(t *testing.T) {
	turn := &interactiveTurn{}
	turn.lastEvtType, turn.lastEvtAt = EventToolUse, time.Now().Add(-time.Minute)
	turn.waitStart = time.Now().Add(-20 * time.Second)
	if got := turn.modelWait(true, nil); !strings.HasPrefix(got, "在等模型 ") {
		t.Fatalf("got %q", got)
	}
	turn.lastEvtType, turn.lastEvtAt = EventToolUse, time.Now().Add(-time.Second)
	if got := turn.modelWait(true, nil); got != "" {
		t.Fatalf("tool running, got %q", got)
	}
	if got := turn.modelWait(true, fakeRetrier(1)); !strings.Contains(got, "第 1 次") {
		t.Fatalf("retry, got %q", got)
	}
}
