package core

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// agentm 11-09: five pin failures in three channels, each only a log line. The channel is told
// once per permission; after the permission works again, losing it is told again.
func TestPermissionNoticeOncePerChannel(t *testing.T) {
	e, _, p := exitFixture(t, nil)
	denied := &MissingPermissionError{Perm: PermPinMessages, Hint: "Discord bot 缺「标注消息 (Pin Messages)」权限，任务板置顶不上。", Err: errors.New("50013")}
	wrapped := errors.Join(errors.New("discord: pin board"), denied)
	ctx := context.Background()
	if !e.permissionNotice(ctx, p, exitChatKey, wrapped) {
		t.Fatal("first failure not told")
	}
	if e.permissionNotice(ctx, p, exitChatKey, wrapped) {
		t.Fatal("same permission told twice in one channel")
	}
	if e.permissionNotice(ctx, p, exitChatKey, errors.New("timeout")) {
		t.Fatal("an unrelated error was told")
	}
	if !e.permissionNotice(ctx, p, exitWSKey, wrapped) {
		t.Fatal("another channel not told")
	}
	e.clearPermissionNotice(exitChatKey, PermPinMessages)
	if !e.permissionNotice(ctx, p, exitChatKey, wrapped) {
		t.Fatal("not told again after the permission came back and went")
	}
	var told int
	for _, s := range p.out {
		if strings.Contains(s.text, "标注消息") {
			told++
		}
	}
	if told != 3 {
		t.Fatalf("told %d times, want 3: %+v", told, p.out)
	}
}
