package core

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
)

// mockReplierPlatform implements PreviewReplier on top of the updater mock (#121).
type mockReplierPlatform struct {
	mockUpdaterPlatform
	rmu     sync.Mutex
	commits []string // "handle|ctx|content"
	deleted []any
	fail    bool
}

func (m *mockReplierPlatform) ReplyInPlace(_ context.Context, handle any, replyCtx any, content string) error {
	m.rmu.Lock()
	defer m.rmu.Unlock()
	if m.fail {
		return errors.New("wire down")
	}
	m.commits = append(m.commits, handle.(string)+"|"+replyCtx.(string)+"|"+content)
	return nil
}

func (m *mockReplierPlatform) DeletePreviewMessage(_ context.Context, handle any) error {
	m.rmu.Lock()
	defer m.rmu.Unlock()
	m.deleted = append(m.deleted, handle)
	return nil
}

func (m *mockReplierPlatform) MarkFinalReply(replyCtx any) any { return replyCtx.(string) + "+final" }

func (m *mockReplierPlatform) state() ([]string, []any) {
	m.rmu.Lock()
	defer m.rmu.Unlock()
	return append([]string(nil), m.commits...), append([]any(nil), m.deleted...)
}

func replierCfg() StreamPreviewCfg {
	return StreamPreviewCfg{Enabled: true, IntervalMs: 20, MinDeltaChars: 1, MaxChars: 10}
}

func TestStreamPreview_ReplyInPlace_FinishCommitsSameMessage(t *testing.T) {
	mp := &mockReplierPlatform{}
	sp := newStreamPreview(replierCfg(), mp, "ctx", context.Background(), nil)
	sp.appendText("Hello ")
	time.Sleep(60 * time.Millisecond)
	sp.appendText("world, more")
	time.Sleep(60 * time.Millisecond)
	if msgs := mp.getMessages(); len(msgs) < 2 || !strings.HasPrefix(msgs[0], "start:") || !strings.HasPrefix(msgs[1], "update:") {
		t.Fatalf("want a preview start then in-place updates, got %#v", msgs)
	}
	if !sp.finish("Hello world, more than ten chars <@222>", "*claude · 1k*") {
		t.Fatal("finish should report the reply delivered in place")
	}
	commits, deleted := mp.state()
	if len(commits) != 1 || len(deleted) != 0 {
		t.Fatalf("commits=%#v deleted=%#v", commits, deleted)
	}
	if !strings.HasPrefix(commits[0], "preview-handle|ctx+final|Hello world, more than ten chars <@222>") || !strings.Contains(commits[0], "*claude · 1k*") {
		t.Fatalf("final commit must be the full untruncated text with footer on the final ctx, got %q", commits[0])
	}
	if got := len(mp.sent); got != 0 {
		t.Fatalf("no separate reply expected, got %d", got)
	}
}

func TestStreamPreview_ReplyInPlace_FreezeKeepsFullSegment(t *testing.T) {
	mp := &mockReplierPlatform{}
	sp := newStreamPreview(replierCfg(), mp, "ctx", context.Background(), nil)
	sp.appendText("before the tool call <@222> take over")
	time.Sleep(60 * time.Millisecond)
	sp.freeze() // a tool call interrupts the text
	sp.detachPreview()
	commits, _ := mp.state()
	if len(commits) != 1 || commits[0] != "preview-handle|ctx|before the tool call <@222> take over" {
		t.Fatalf("freeze must commit the full segment (not the max_chars cut) as a reply, got %#v", commits)
	}
	sp.unfreeze()
	sp.appendText("after")
	time.Sleep(60 * time.Millisecond)
	if !sp.finish("after", "") {
		t.Fatal("finish after a tool call should commit the new preview")
	}
	commits, _ = mp.state()
	if len(commits) != 2 || commits[1] != "preview-handle|ctx+final|after" {
		t.Fatalf("want the post-tool segment committed as the final reply, got %#v", commits)
	}
}

func TestStreamPreview_ReplyInPlace_FailureDeletesPreviewAndFallsBack(t *testing.T) {
	mp := &mockReplierPlatform{fail: true}
	sp := newStreamPreview(replierCfg(), mp, "ctx", context.Background(), nil)
	sp.appendText("segment one")
	time.Sleep(60 * time.Millisecond)
	sp.freeze()
	sp.detachPreview()
	if _, deleted := mp.state(); len(deleted) != 1 {
		t.Fatalf("failed commit must delete the preview, deleted=%#v", deleted)
	}
	if len(mp.sent) != 1 || mp.sent[0] != "segment one" {
		t.Fatalf("a frozen segment whose commit failed is sent as a normal reply, sent=%#v", mp.sent)
	}
	sp.unfreeze()
	sp.appendText("final")
	time.Sleep(60 * time.Millisecond)
	if sp.finish("final", "") {
		t.Fatal("finish must report failure so the engine sends the reply")
	}
	if _, deleted := mp.state(); len(deleted) != 2 {
		t.Fatalf("failed final commit must delete the preview, deleted=%#v", deleted)
	}
}

func TestStreamPreview_ReplyInPlace_EmptyFinalDeletesPreview(t *testing.T) {
	mp := &mockReplierPlatform{}
	sp := newStreamPreview(replierCfg(), mp, "ctx", context.Background(), func(s string) string {
		if s == "NO_REPLY" {
			return ""
		}
		return s
	})
	sp.appendText("thinking aloud")
	time.Sleep(60 * time.Millisecond)
	sp.finish("NO_REPLY", "")
	commits, deleted := mp.state()
	if len(commits) != 0 || len(deleted) != 1 {
		t.Fatalf("an empty answer leaves no message: commits=%#v deleted=%#v", commits, deleted)
	}
}
