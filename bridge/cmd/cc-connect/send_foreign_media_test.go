package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// #1152 self-test: #1148's finished video (promo channel) was posted into the test channel.
func writeForeignMediaFixture(t *testing.T) (dataDir, video string) {
	t.Helper()
	root := t.TempDir()
	dataDir = filepath.Join(root, "data")
	notes := filepath.Join(root, "notes")
	handoff := filepath.Join(notes, "code-art-metaphor-video-20261125.handoff.md")
	video = filepath.Join(notes, "code-art-metaphor-video-20261125", "deliver", "A版纯古琴.mp4")
	for _, d := range []string{dataDir, filepath.Dir(video)} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(video, []byte("video"), 0o644); err != nil {
		t.Fatal(err)
	}
	last := `{"tasks":{"` + handoff + `@ws9@task1148":{"file":"` + handoff + `","chat":"discord:1571341010225729617","ws_key":"discord:1575000482429014116","board":[1148]}}}`
	if err := os.WriteFile(filepath.Join(dataDir, "ws-handoff-last.json"), []byte(last), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CC_SESSION_KEY", "")
	t.Setenv("CC_SESSION", "")
	return dataDir, video
}

func TestParseSendArgs_RefusesOtherChannelsDeliverable(t *testing.T) {
	dataDir, video := writeForeignMediaFixture(t)
	link := filepath.Join(t.TempDir(), "1148_A_chunguqin.mp4") // renamed link, as the self-test did
	if err := os.Symlink(video, link); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{video, link} {
		_, _, err := parseSendArgs([]string{"--data-dir", dataDir, "-s", "discord:1562782851852800020", "--video", p, "-m", "自测"})
		if err == nil || !strings.Contains(err.Error(), "#1148") || !strings.Contains(err.Error(), "不能发到 discord:1562782851852800020") {
			t.Fatalf("send of %s to test channel: err = %v, want refusal naming #1148", p, err)
		}
	}
}

func TestParseSendArgs_AllowsDeliverableInItsOwnChannels(t *testing.T) {
	dataDir, video := writeForeignMediaFixture(t)
	for _, s := range []string{"discord:1571341010225729617", "discord:1575000482429014116"} {
		if _, _, err := parseSendArgs([]string{"--data-dir", dataDir, "-s", s, "--video", video, "-m", "成片"}); err != nil {
			t.Fatalf("send to %s: %v", s, err)
		}
	}
	own := filepath.Join(t.TempDir(), "test-clip.mp4")
	if err := os.WriteFile(own, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, _, err := parseSendArgs([]string{"--data-dir", dataDir, "-s", "discord:1562782851852800020", "--video", own, "-m", "自测"}); err != nil {
		t.Fatalf("own test clip to test channel: %v", err)
	}
}
