package discord

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// TestMeetingVideoSim runs contrib/discord-voice/sim/video_sim.mjs as the meeting's listener: real
// video.mjs / golive.mjs code receives made-up camera (VP8) and screen share (H264) pictures with
// numbers on them — encrypted RTP like Discord's, the screen share through a fake gateway — and the
// stills must come out as the camera and screen lines of the minutes. Real Discord is not involved.
// Needs node, ffmpeg (with drawtext) and the listener's npm dependencies:
//
//	BOTHOUSE_VOICE_SIM_MODULES=<a node_modules with @discordjs/voice and ws> go test -run TestMeetingVideoSim ./platform/discord/
//
// BOTHOUSE_VOICE_SIM_SHOTS=<dir> keeps the stills to look at.
func TestMeetingVideoSim(t *testing.T) {
	modules := os.Getenv("BOTHOUSE_VOICE_SIM_MODULES")
	if modules == "" {
		t.Skip("set BOTHOUSE_VOICE_SIM_MODULES to run the video simulation")
	}
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("needs node")
	}
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("needs ffmpeg")
	}
	src := filepath.Join("..", "..", "contrib", "discord-voice")
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "sim"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, f := range []string{"video.mjs", "golive.mjs", filepath.Join("sim", "video_sim.mjs")} {
		b, err := os.ReadFile(filepath.Join(src, f))
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, f), b, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Symlink(modules, filepath.Join(dir, "node_modules")); err != nil {
		t.Fatal(err)
	}
	shots := os.Getenv("BOTHOUSE_VOICE_SIM_SHOTS")
	if shots == "" {
		shots = t.TempDir()
	}

	var got *core.Message
	p := &Platform{meetingOn: true, handler: func(_ core.Platform, m *core.Message) { got = m }}
	p.channelNameCache.Store("c1", "常规")
	start := time.Now()
	mt := &meeting{guildID: "111", voiceID: "222", textID: "c1", starterID: "333", starterName: "小红", startMsgID: "m1",
		voiceName: "常规", startedAt: start, readyCh: make(chan struct{}), failCh: make(chan string, 1),
		present: map[string]bool{}, names: map[string]string{"333": "小红", "444": "阿明"}}
	p.meetings = map[string]*meeting{"111": mt}
	cmd := exec.Command(node, filepath.Join(dir, "sim", "video_sim.mjs"), shots)
	cmd.Dir = dir
	l, err := p.runVoiceListener(mt, cmd)
	if err != nil {
		t.Fatal(err)
	}
	defer l.kill()
	mt.listener = l
	deadline := time.Now().Add(90 * time.Second)
	for {
		mt.mu.Lock()
		n, seg := len(mt.frames), len(mt.segments)
		mt.mu.Unlock()
		if n >= 4 && seg >= 2 {
			break
		}
		select {
		case why := <-mt.failCh:
			t.Fatalf("simulation failed: %s", why)
		case <-l.exited:
			t.Fatalf("simulation exited early with %d stills", n)
		case <-time.After(100 * time.Millisecond):
		}
		if time.Now().After(deadline) {
			t.Fatalf("only %d stills after 90s", n)
		}
	}
	if mt.watcherID != "555" {
		t.Errorf("watcher = %q, want the screen watcher's account", mt.watcherID)
	}
	p.endMeeting(mt, "大家都离开了语音频道", "")

	if got == nil {
		t.Fatal("no minutes prompt")
	}
	if len(got.Images) != 4 {
		t.Fatalf("images = %d, want 2 camera + 2 screen", len(got.Images))
	}
	for i, im := range got.Images {
		if len(im.Data) < 2 || im.Data[0] != 0xff || im.Data[1] != 0xd8 || im.MimeType != "image/jpeg" {
			t.Errorf("image %d is not a JPEG", i+1)
		}
	}
	for _, want := range []string{
		"小红 的摄像头（图1）", "小红 的摄像头（图2）", "阿明 的屏幕共享（图3）", "阿明 的屏幕共享（图4）",
		"小红：大家看我摄像头上的数字", "阿明：这是我共享的屏幕",
		"这个人就是在共享的人", "最后 4 张",
	} {
		if !strings.Contains(got.Content, want) {
			t.Errorf("prompt lacks %q:\n%s", want, got.Content)
		}
	}
	t.Logf("minutes prompt:\n%s", got.Content)
}
