package core

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type exitImgPlatform struct {
	exitTestPlatform
	imu  sync.Mutex
	imgs []exitSent // rc, file name
}

func (p *exitImgPlatform) SendImage(_ context.Context, rc any, img ImageAttachment) error {
	p.imu.Lock()
	defer p.imu.Unlock()
	s, _ := rc.(string)
	p.imgs = append(p.imgs, exitSent{s, img.FileName})
	return nil
}

func (p *exitImgPlatform) imagesTo(rc string) []string {
	p.imu.Lock()
	defer p.imu.Unlock()
	var out []string
	for _, s := range p.imgs {
		if s.rc == rc {
			out = append(out, s.text)
		}
	}
	return out
}

// A workspace's sent images and the images its report names reach the chat channel with the
// [report] (user 11-04 「你老是没把图带进来」).
func TestWorkspaceReportCarriesImages(t *testing.T) {
	p := &exitImgPlatform{exitTestPlatform: exitTestPlatform{inputTestPlatform: inputTestPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}}}
	as := &inputTestSession{events: make(chan Event, 32), prompts: make(chan string, 32), id: "t1"}
	ag := &inputTestAgent{session: as, requested: make(chan string, 32)}
	e := NewEngine("orange", ag, []Platform{p}, "", LangEnglish)
	e.dataDir = t.TempDir()
	e.SetWorkspaceParentResolver(mapParent{"ws1": "chat1"})
	e.workspaceChatForTest = func(s string) bool { return strings.Contains(s, "ws1") }
	t.Cleanup(func() { e.cancel(); _ = e.Stop() })
	exitBoardItem(t, e, 7, "对照图")

	png := []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00")
	dir := t.TempDir()
	named := filepath.Join(dir, "cmp-zh-1.png")
	if err := os.WriteFile(named, append(append([]byte{}, png...), 'a'), 0o600); err != nil {
		t.Fatal(err)
	}
	e.noteWorkspaceImages(exitWSKey, []ImageAttachment{{MimeType: "image/png", Data: png, FileName: "sent.png"}})
	e.noteWorkspaceImages(exitChatKey, []ImageAttachment{{MimeType: "image/png", Data: png, FileName: "not-a-workspace.png"}})

	e.forwardWorkspaceExit(p, exitWSKey, "[report] #7 背景：你要看对照图。\n对照图做好了\n要你做的：没有。\n我加的：无\n细节：对照图在 "+named+" 和 https://x.test/a.png")
	inputWait(t, func() bool { return len(p.imagesTo("discord:chat1")) == 2 })
	got := p.imagesTo("discord:chat1")
	if got[0] != "sent.png" || got[1] != "cmp-zh-1.png" {
		t.Fatalf("images = %v", got)
	}
	if len(p.sentTo("discord:chat1")) != 1 {
		t.Fatalf("text posts = %v", p.sentTo("discord:chat1"))
	}
	// taken once: a later exit does not repeat them
	if left := takeWorkspaceImages(exitWSKey, time.Time{}); len(left) != 0 {
		t.Fatalf("images left = %d", len(left))
	}
}

// #1617 (11-14): its report quoted a hook's output listing #1614's contact sheet (another chat
// channel's picture) as a test sample; the bridge posted that picture under #1617's report
// (user 「你发错频道了，修一下，这个不是第一次」). A picture the report only names by path, shown
// in another chat channel before, stays a path; the task's own pictures still go.
func TestWorkspaceReportLeavesOutAnotherChannelsImage(t *testing.T) {
	p := &exitImgPlatform{exitTestPlatform: exitTestPlatform{inputTestPlatform: inputTestPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}}}
	as := &inputTestSession{events: make(chan Event, 32), prompts: make(chan string, 32), id: "t1"}
	ag := &inputTestAgent{session: as, requested: make(chan string, 32)}
	e := NewEngine("orange", ag, []Platform{p}, "", LangEnglish)
	e.dataDir = t.TempDir()
	e.SetWorkspaceParentResolver(mapParent{"ws1": "chat1", "ws2": "chat2"})
	e.workspaceChatForTest = func(s string) bool { return strings.Contains(s, "ws1") || strings.Contains(s, "ws2") }
	t.Cleanup(func() { e.cancel(); _ = e.Stop() })
	exitBoardItem(t, e, 1614, "宣传片 1080p")
	exitBoardItem(t, e, 1617, "验收看图闸")

	png := []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00")
	dir := t.TempDir()
	write := func(name string, tail byte) string {
		path := filepath.Join(dir, name)
		if err := os.WriteFile(path, append(append([]byte{}, png...), tail), 0o600); err != nil {
			t.Fatal(err)
		}
		return path
	}
	sheet := write("borrow-claude-r13-1080p-sheet.png", 'a')
	own := write("gate-before-after.png", 'b')

	// #1614 hands its contact sheet back to its own chat channel.
	e.forwardWorkspaceExit(p, exitWSKey, "[report] #1614 背景：你要 1080p 下载链接。\n1080p 成片好了。\n要你做的：点链接看片。\n我加的：无\n细节：\n每秒一帧拼图 "+sheet)
	inputWait(t, func() bool { return len(p.imagesTo("discord:chat1")) == 1 })

	// #1617, from another chat channel, quotes that path as a test sample and names its own picture.
	// The first copy sits in quoted output (the real report); the second is in plain words.
	body := "[report] #1617 背景：你要我验收更自主。\n没看图时放行被拦。\n要你做的：没有\n我加的：无\n细节：\n入口自验：旧汇报是已贴出的 #1614。\n```\n$ ws-pass --id 1614 --verdict 逐条\ndeny：【没看过截图】#1614 的汇报里列了 1 张图，你这个会话还没打开过 1 张：\n  " + sheet + "\n```\n试的那份旧汇报的图是 " + sheet + " 。\n截图 " + own
	e.forwardWorkspaceExit(p, "discord:ws2:u1", body)
	inputWait(t, func() bool { return len(p.imagesTo("discord:chat2")) == 1 })
	time.Sleep(50 * time.Millisecond)
	if got := p.imagesTo("discord:chat2"); len(got) != 1 || got[0] != "gate-before-after.png" {
		t.Fatalf("chat2 images = %v, want only the task's own picture", got)
	}
	if got := p.imagesTo("discord:chat1"); len(got) != 1 || got[0] != "borrow-claude-r13-1080p-sheet.png" {
		t.Fatalf("chat1 images = %v", got)
	}

	// The same chat channel may show its picture again (a follow-up task's 改前 picture).
	exitBoardItem(t, e, 1620, "宣传片再改")
	e.forwardWorkspaceExit(p, exitWSKey, "[report] #1620 背景：你要再改一处。\n改好了。\n要你做的：没有\n我加的：无\n细节：\n改前 "+sheet)
	inputWait(t, func() bool { return len(p.imagesTo("discord:chat1")) == 2 })
}

// A path inside quoted output is not the report naming an image; an unclosed ``` quotes nothing.
func TestReportNamedImagesSkipsQuotedOutput(t *testing.T) {
	png := []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00")
	f := filepath.Join(t.TempDir(), "sheet.png")
	if err := os.WriteFile(f, png, 0o600); err != nil {
		t.Fatal(err)
	}
	if got := reportNamedImages("细节：\n```\ndeny：还没打开过 1 张：\n  " + f + "\n```\n"); len(got) != 0 {
		t.Fatalf("quoted path attached: %v", got)
	}
	if got := reportNamedImages("细节：\n```\nok\n```\n截图 " + f); len(got) != 1 {
		t.Fatalf("path after the block = %d images, want 1", len(got))
	}
	if got := reportNamedImages("细节：\n```\n截图 " + f); len(got) != 1 {
		t.Fatalf("unclosed block = %d images, want 1", len(got))
	}
}

// The ledger behind the cut: shown in another chat channel only -> left out; shown here, in
// both, or nowhere yet -> goes.
func TestNamedImagesOfChat(t *testing.T) {
	dataDir := t.TempDir()
	a := ImageAttachment{MimeType: "image/png", Data: []byte("a"), FileName: "a.png"}
	b := ImageAttachment{MimeType: "image/png", Data: []byte("b"), FileName: "b.png"}
	noteExitImagesShown(dataDir, "discord:chat1", []ImageAttachment{a})
	if got := namedImagesOfChat(dataDir, "discord:chat2", []ImageAttachment{a, b}); len(got) != 1 || got[0].FileName != "b.png" {
		t.Fatalf("chat2 gets %v, want b.png only", got)
	}
	if got := namedImagesOfChat(dataDir, "discord:chat1", []ImageAttachment{a, b}); len(got) != 2 {
		t.Fatalf("chat1 gets %v, want both", got)
	}
	if got := namedImagesOfChat(dataDir, "", []ImageAttachment{a}); len(got) != 1 {
		t.Fatalf("unknown chat drops nothing, got %v", got)
	}
	// shown in both: either channel may show it
	noteExitImagesShown(dataDir, "discord:chat2", []ImageAttachment{a})
	if got := namedImagesOfChat(dataDir, "discord:chat2", []ImageAttachment{a}); len(got) != 1 {
		t.Fatalf("after chat2 showed it, got %v", got)
	}
}
