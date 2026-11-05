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
