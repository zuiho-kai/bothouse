package core

import (
	"context"
	"log/slog"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Documents go back with a workspace's [report]/[ask], like its images (team_exit_images.go).
// agentm #36 (11-10): the workspace wrote a review report, named its path in the report and
// registered it as the task's output, yet the chat channel got only the text, because the exit
// forward carried images alone; the user could not open a server path (「这个老是不发文件上去」).
// Now the post also carries: the files the workspace sent with `bothouse send --file`, the local
// documents the report names by path, and, when the report names none, the documents the handoff
// file names that were written after the handoff was bound. A report that says it produced a
// document but has no file and no link goes back to the workspace to add one.

// exitFileMaxBytes keeps an attachment under Discord's default 10 MiB upload limit; exitFileMax
// keeps a report that names many evidence files from flooding the channel.
const (
	exitFileMaxBytes = 8 << 20
	exitFileMax      = 5
)

type exitFile struct {
	file FileAttachment
	at   time.Time
}

var exitFileStore = struct {
	m map[string][]exitFile // teamChatKey(workspace session) -> files sent there since the last exit
}{m: map[string][]exitFile{}}

// noteWorkspaceFiles remembers files a workspace session sent in its own channel.
func (e *Engine) noteWorkspaceFiles(sessionKey string, files []FileAttachment) {
	if len(files) == 0 || sessionKey == "" || !e.isTeamWorkspaceChat(sessionKey) {
		return
	}
	key := teamChatKey(sessionKey)
	now := time.Now()
	exitImageStore.mu.Lock()
	defer exitImageStore.mu.Unlock()
	for _, f := range files {
		if len(f.Data) > 0 {
			exitFileStore.m[key] = append(exitFileStore.m[key], exitFile{file: f, at: now})
		}
	}
}

// takeWorkspaceFiles hands over and forgets the files the workspace sent after since; peek keeps them.
func takeWorkspaceFiles(sessionKey string, since time.Time, peek bool) []FileAttachment {
	key := teamChatKey(sessionKey)
	exitImageStore.mu.Lock()
	list := exitFileStore.m[key]
	if !peek {
		delete(exitFileStore.m, key)
	}
	exitImageStore.mu.Unlock()
	var out []FileAttachment
	for _, it := range list {
		if since.IsZero() || !it.at.Before(since) {
			out = append(out, it.file)
		}
	}
	return out
}

// exitDocPathRe: a local path to a document-like file (absolute or ~/). Images are handled by
// exitImagePathRe; source code is not a deliverable and stays a path.
var exitDocPathRe = regexp.MustCompile(`(?i)(?:~/|/)[^\s"'` + "`" + `<>()（）「」，。；：、]*\.(?:md|markdown|txt|pdf|html?|csv|docx?|xlsx?|pptx?)`)

// exitURLRe: a link the user can open (a PR, a page, a gist).
var exitURLRe = regexp.MustCompile(`https?://[^\s<>()（）「」，。；]+`)

// namedDocPaths lists the existing local document files text names, each once, in order.
func namedDocPaths(text string) []string {
	seen := map[string]bool{}
	var out []string
	for _, m := range exitDocPathRe.FindAllStringIndex(text, -1) {
		if m[0] > 0 && !strings.ContainsAny(text[m[0]-1:m[0]], " \t\n:：(（「`'\"*-—") {
			continue // part of a URL or a longer word, not a local path
		}
		path := expandHome(text[m[0]:m[1]])
		if seen[path] {
			continue
		}
		seen[path] = true
		st, err := os.Stat(path)
		if err != nil || !st.Mode().IsRegular() || st.Size() == 0 || st.Size() > exitFileMaxBytes {
			continue
		}
		out = append(out, path)
	}
	return out
}

func readExitFile(path string) (FileAttachment, bool) {
	data, err := os.ReadFile(path)
	if err != nil || len(data) == 0 {
		return FileAttachment{}, false
	}
	mt := mime.TypeByExtension(strings.ToLower(filepath.Ext(path)))
	if mt == "" {
		mt = http.DetectContentType(data)
	}
	return FileAttachment{MimeType: mt, Data: data, FileName: filepath.Base(path)}, true
}

// notesProducedDocs: the documents the handoff file names that were written after the handoff
// was bound (what this handoff produced), not the handoff itself or its exported words.
func notesProducedDocs(where string, since time.Time) []string {
	notes := readNotes(where)
	if notes == "" || since.IsZero() {
		return nil
	}
	self := expandHome(strings.TrimSpace(where))
	var out []string
	for _, p := range namedDocPaths(notes) {
		if p == self || strings.HasSuffix(p, ".原话.md") {
			continue
		}
		if st, err := os.Stat(p); err == nil && st.ModTime().After(since) {
			out = append(out, p)
		}
	}
	return out
}

// exitDocPaths is where this exit's documents come from: the ones the body names, else the ones
// its handoff produced.
func exitDocPaths(body string, item *teamTaskBoardItem) []string {
	if paths := namedDocPaths(body); len(paths) > 0 {
		return paths
	}
	if item == nil {
		return nil
	}
	return notesProducedDocs(item.Where, boundTime(item))
}

// exitFilesFor is what goes back with this exit besides images: kept (files the workspace sent,
// taken earlier) or the ones it sent now, then the documents found by path; each once.
func exitFilesFor(sessionKey, body string, item *teamTaskBoardItem, kept []FileAttachment, take bool) []FileAttachment {
	all := append([]FileAttachment{}, kept...)
	if take {
		all = append(all, takeWorkspaceFiles(sessionKey, boundTime(item), false)...)
	}
	for _, p := range exitDocPaths(body, item) {
		if f, ok := readExitFile(p); ok {
			all = append(all, f)
		}
	}
	seen := map[string]bool{}
	var out []FileAttachment
	for _, f := range all {
		k := f.FileName + "\x00" + strconv.Itoa(len(f.Data))
		if seen[k] {
			continue
		}
		seen[k] = true
		out = append(out, f)
		if len(out) == exitFileMax {
			break
		}
	}
	return out
}

// postExitFiles posts files in the chat channel after the exit's text. Best effort.
func (e *Engine) postExitFiles(ctx context.Context, p Platform, rc any, files []FileAttachment) {
	if len(files) == 0 {
		return
	}
	sender, ok := p.(FileSender)
	if !ok {
		slog.Warn("team exit: platform cannot send files; documents stay as paths", "platform", p.Name(), "files", len(files))
		return
	}
	sent := 0
	for _, f := range files {
		if err := e.waitOutgoing(p); err != nil {
			slog.Warn("team exit: file send rate wait failed", "error", err)
			break
		}
		if err := authorizedOutput(ctx, func() error { return sender.SendFile(ctx, rc, f) }); err != nil {
			slog.Warn("team exit: file post failed", "file", f.FileName, "error", err)
			continue
		}
		sent++
	}
	slog.Info("team exit: documents posted with the exit", "files", sent, "of", len(files))
}

// reportDocClaimRe: the user-facing part says a document was produced.
var reportDocClaimRe = regexp.MustCompile(`(?i)(产出|写了|写好|写成|写完|整理了|整理好|生成了?|出了|完成了?|交付|附上)[^。\n]{0,16}(报告|文档|文稿|报文|纪要|手册|说明书|方案稿|草稿|report|document)|(报告|文档|文稿|纪要|report)[^。\n]{0,6}(已产出|已生成|已写好|已完成|写好了|已出)`)

// reportDeliverableProblems: a report that says it produced a document must carry it — a local
// file (named, sent, or found through its handoff) or a link. Only when the bridge finds none
// does the workspace get it back.
func reportDeliverableProblems(sessionKey, body string, item *teamTaskBoardItem) []string {
	head, _ := exitSplit(body)
	m := reportDocClaimRe.FindString(head)
	if m == "" {
		return nil
	}
	if exitURLRe.MatchString(body) || len(exitDocPaths(body, item)) > 0 ||
		len(takeWorkspaceFiles(sessionKey, boundTime(item), true)) > 0 {
		return nil
	}
	return []string{"汇报说「" + m + "」，但没带上成品：本机文件写出完整路径（桥会作为附件一起发到聊天频道），已发到 PR 或网页的写出链接"}
}
