package core

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
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

// fencedSpans are the byte ranges of body inside closed ``` blocks. What a report puts there is
// quoted command output or a log, not the report speaking: #1617 quoted a hook's refusal that
// listed another task's picture, and the path in that quote was posted as #1617's image.
func fencedSpans(body string) [][2]int {
	var spans [][2]int
	open, pos := -1, 0
	for _, line := range strings.SplitAfter(body, "\n") {
		if strings.HasPrefix(strings.TrimLeft(line, " \t"), "```") {
			if open < 0 {
				open = pos
			} else {
				spans = append(spans, [2]int{open, pos + len(line)})
				open = -1
			}
		}
		pos += len(line)
	}
	return spans
}

// reportNamedImages reads the local image files body names by path (absolute or ~/), outside
// quoted blocks (fencedSpans).
func reportNamedImages(body string) []ImageAttachment {
	home, _ := os.UserHomeDir()
	seen := map[string]bool{}
	fenced := fencedSpans(body)
	var out []ImageAttachment
	for _, m := range exitImagePathRe.FindAllStringIndex(body, -1) {
		quoted := false
		for _, f := range fenced {
			if m[0] >= f[0] && m[0] < f[1] {
				quoted = true
				break
			}
		}
		if quoted {
			continue
		}
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

// Which chat channel an image was shown in. #1617 (11-14): its report quoted a hook's output
// that listed another task's picture (#1614's contact sheet, a different chat channel) as a test
// sample, and the bridge posted that picture under #1617's report (user 「你发错频道了…这个不是
// 第一次」). A path in the text says the file exists, not that this task made it. So the bridge
// remembers, by content, the chat channel each exit image went to; an image the report only
// names by path, already shown in another chat channel and never in this one, is that
// channel's picture and stays a path. Images the workspace sent itself (`bothouse send
// --image`) always go: sending is saying 「this is mine to show」. #1404 (11-10) made the same
// cut for documents (exitDocPaths); images were left as they were then.
const (
	exitImageOwnersFile = "exit-image-owners.json"
	exitImageOwnerKeep  = 30 * 24 * time.Hour
)

var exitImageOwnersMu sync.Mutex

func exitImageOwnersPath(dataDir string) string {
	if dataDir == "" {
		return ""
	}
	return filepath.Join(dataDir, teamReportDir, exitImageOwnersFile)
}

// loadExitImageOwners: content hash -> chat channel -> when it was last shown there.
// Callers hold exitImageOwnersMu.
func loadExitImageOwners(dataDir string) map[string]map[string]time.Time {
	owners := map[string]map[string]time.Time{}
	if path := exitImageOwnersPath(dataDir); path != "" {
		if b, err := os.ReadFile(path); err == nil {
			_ = json.Unmarshal(b, &owners)
		}
	}
	return owners
}

func exitImageSum(img ImageAttachment) string {
	sum := sha256.Sum256(img.Data)
	return hex.EncodeToString(sum[:])
}

// exitImageChat names the chat channel an exit goes to, the same on every engine.
func exitImageChat(platform, chat string) string {
	if chat == "" {
		return ""
	}
	return teamChatKey(platform + ":" + chat)
}

// namedImagesOfChat drops, from the images a report names by path, those already shown in
// another chat channel and never in chat. An unknown chat or data dir drops nothing.
func namedImagesOfChat(dataDir, chat string, named []ImageAttachment) []ImageAttachment {
	if dataDir == "" || chat == "" || len(named) == 0 {
		return named
	}
	exitImageOwnersMu.Lock()
	owners := loadExitImageOwners(dataDir)
	exitImageOwnersMu.Unlock()
	var out []ImageAttachment
	for _, img := range named {
		shown := owners[exitImageSum(img)]
		if _, here := shown[chat]; len(shown) > 0 && !here {
			slog.Info("team exit: image the report names was shown in another chat channel; left as a path", "file", img.FileName, "chat", chat)
			continue
		}
		out = append(out, img)
	}
	return out
}

// noteExitImagesShown records that images went to chat with an exit.
func noteExitImagesShown(dataDir, chat string, images []ImageAttachment) {
	path := exitImageOwnersPath(dataDir)
	if path == "" || chat == "" || len(images) == 0 {
		return
	}
	now := time.Now()
	exitImageOwnersMu.Lock()
	defer exitImageOwnersMu.Unlock()
	owners := loadExitImageOwners(dataDir)
	for sum, shown := range owners {
		for c, at := range shown {
			if now.Sub(at) > exitImageOwnerKeep {
				delete(shown, c)
			}
		}
		if len(shown) == 0 {
			delete(owners, sum)
		}
	}
	for _, img := range images {
		sum := exitImageSum(img)
		if owners[sum] == nil {
			owners[sum] = map[string]time.Time{}
		}
		owners[sum][chat] = now
	}
	b, err := json.Marshal(owners)
	if err != nil {
		return
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		slog.Warn("team exit: image owners dir failed", "error", err)
		return
	}
	if err := AtomicWriteFile(path, b, 0o600); err != nil {
		slog.Warn("team exit: image owners save failed", "error", err)
	}
}

// exitImagesFor is what goes back with this exit to chat: the workspace's sent images, then the
// images the body names that are not another chat channel's (namedImagesOfChat), each once.
func exitImagesFor(dataDir, chat, sessionKey, body string, item *teamTaskBoardItem) []ImageAttachment {
	var since time.Time
	if item != nil && item.Bound != "" {
		since, _ = time.Parse(time.RFC3339Nano, item.Bound)
	}
	all := append(takeWorkspaceImages(sessionKey, since), namedImagesOfChat(dataDir, chat, reportNamedImages(body))...)
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

// postExitImages posts this exit's images, then its documents (team_exit_files.go), in chat
// channel parent after its text. Best effort: the text already went; a failed one is logged.
func (e *Engine) postExitImages(ctx context.Context, p Platform, rc any, parent, sessionKey, body string, item *teamTaskBoardItem) {
	defer func() { e.postExitFiles(ctx, p, rc, exitFilesFor(sessionKey, body, item, nil, true)) }()
	chat := exitImageChat(p.Name(), parent)
	images := exitImagesFor(e.dataDir, chat, sessionKey, body, item)
	if len(images) == 0 {
		return
	}
	sender, ok := p.(ImageSender)
	if !ok {
		slog.Warn("team exit: platform cannot send images; images stay in the workspace", "platform", p.Name(), "images", len(images))
		return
	}
	var sent []ImageAttachment
	for _, img := range images {
		if err := e.waitOutgoing(p); err != nil {
			slog.Warn("team exit: image send rate wait failed", "error", err)
			break
		}
		if err := authorizedOutput(ctx, func() error { return sender.SendImage(ctx, rc, img) }); err != nil {
			slog.Warn("team exit: image post failed", "file", img.FileName, "error", err)
			continue
		}
		sent = append(sent, img)
	}
	noteExitImagesShown(e.dataDir, chat, sent)
	slog.Info("team exit: images posted with the exit", "session", sessionKey, "images", len(sent), "of", len(images))
}
