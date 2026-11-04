package core

import (
	"context"
	"crypto/sha256"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Images go back with a workspace's [report]/[ask] (user 11-04 「你老是没把图带进来，这个问题要修
// 一下」). A workspace's `bothouse send --image` lands in the workspace channel only, and the exit
// forward (team_exit.go) copied the text alone, so the chat channel saw a report that said the
// images were posted, with no image. Now the bridge keeps what a workspace session sent, and with
// the report it posts those images plus any image the report names by local path, after the post
// in the chat channel. This sits in the bridge, not in a CLI hook, so every CLI acting as
// workspace lead gets it, on every platform with an ImageSender (Discord, Feishu, DSH/cloud-web).

type exitImage struct {
	img ImageAttachment
	at  time.Time
}

var exitImageStore = struct {
	mu   sync.Mutex
	sent map[string][]exitImage // teamChatKey(workspace session) -> images sent there since the last exit
}{sent: map[string][]exitImage{}}

// noteWorkspaceImages remembers images a workspace session sent in its own channel.
func (e *Engine) noteWorkspaceImages(sessionKey string, images []ImageAttachment) {
	if len(images) == 0 || sessionKey == "" || !e.isTeamWorkspaceChat(sessionKey) {
		return
	}
	key := teamChatKey(sessionKey)
	now := time.Now()
	exitImageStore.mu.Lock()
	defer exitImageStore.mu.Unlock()
	for _, img := range images {
		if len(img.Data) > 0 {
			exitImageStore.sent[key] = append(exitImageStore.sent[key], exitImage{img: img, at: now})
		}
	}
}

// takeWorkspaceImages hands over and forgets the images the workspace sent; with a non-zero
// since, only those sent after it (the current handoff's binding).
func takeWorkspaceImages(sessionKey string, since time.Time) []ImageAttachment {
	key := teamChatKey(sessionKey)
	exitImageStore.mu.Lock()
	list := exitImageStore.sent[key]
	delete(exitImageStore.sent, key)
	exitImageStore.mu.Unlock()
	var out []ImageAttachment
	for _, it := range list {
		if since.IsZero() || !it.at.Before(since) {
			out = append(out, it.img)
		}
	}
	return out
}

var exitImagePathRe = regexp.MustCompile(`(?i)(?:~/|/)[^\s"'` + "`" + `<>()（）「」，。；：、]*\.(?:png|jpe?g|gif|webp)`)

// reportNamedImages reads the local image files body names by path (absolute or ~/).
func reportNamedImages(body string) []ImageAttachment {
	home, _ := os.UserHomeDir()
	seen := map[string]bool{}
	var out []ImageAttachment
	for _, m := range exitImagePathRe.FindAllStringIndex(body, -1) {
		if m[0] > 0 && !strings.ContainsAny(body[m[0]-1:m[0]], " \t\n:：(（「`'\"") {
			continue // part of a URL or a longer word, not a local path
		}
		path := body[m[0]:m[1]]
		if strings.HasPrefix(path, "~/") {
			if home == "" {
				continue
			}
			path = filepath.Join(home, path[2:])
		}
		if seen[path] {
			continue
		}
		seen[path] = true
		st, err := os.Stat(path)
		if err != nil || !st.Mode().IsRegular() || st.Size() == 0 {
			continue
		}
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		mime := http.DetectContentType(data)
		if !strings.HasPrefix(mime, "image/") {
			continue
		}
		out = append(out, ImageAttachment{MimeType: mime, Data: data, FileName: filepath.Base(path)})
	}
	return out
}

// exitImagesFor is what goes back with this exit: the workspace's sent images, then the images
// the body names, each once.
func exitImagesFor(sessionKey, body string, item *teamTaskBoardItem) []ImageAttachment {
	var since time.Time
	if item != nil && item.Bound != "" {
		since, _ = time.Parse(time.RFC3339Nano, item.Bound)
	}
	all := append(takeWorkspaceImages(sessionKey, since), reportNamedImages(body)...)
	seen := map[[sha256.Size]byte]bool{}
	var out []ImageAttachment
	for _, img := range all {
		sum := sha256.Sum256(img.Data)
		if seen[sum] {
			continue
		}
		seen[sum] = true
		out = append(out, img)
	}
	return out
}

// postExitImages posts this exit's images in the chat channel after its text. Best effort: the
// text already went; a failed image is logged.
func (e *Engine) postExitImages(ctx context.Context, p Platform, rc any, sessionKey, body string, item *teamTaskBoardItem) {
	images := exitImagesFor(sessionKey, body, item)
	if len(images) == 0 {
		return
	}
	sender, ok := p.(ImageSender)
	if !ok {
		slog.Warn("team exit: platform cannot send images; images stay in the workspace", "platform", p.Name(), "images", len(images))
		return
	}
	sent := 0
	for _, img := range images {
		if err := e.waitOutgoing(p); err != nil {
			slog.Warn("team exit: image send rate wait failed", "error", err)
			break
		}
		if err := authorizedOutput(ctx, func() error { return sender.SendImage(ctx, rc, img) }); err != nil {
			slog.Warn("team exit: image post failed", "file", img.FileName, "error", err)
			continue
		}
		sent++
	}
	slog.Info("team exit: images posted with the exit", "session", sessionKey, "images", sent, "of", len(images))
}
