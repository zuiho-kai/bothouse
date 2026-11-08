package core

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

// life_page (project option): one file that says how the role is doing right now — what is in her pocket, where
// she lives, what she promised, what she is working on. Each turn sent to the agent (user, cron, timer, queued,
// relay) gets the page before it, with a note that she edits the page in place when something changes instead of
// appending to it. A missing file is created from lifePageTemplate. Empty option = off, the default.

const (
	lifePageHead = "（我的小日子 "
	lifePageEnd  = "（小日子页到此）"
	// Spec asks for a length cap with truncation; the five hand-written pages of 2026-11-08 are 352–511 runes,
	// so 2000 (about 4x the largest) keeps any page that only says "how she is now".
	lifePageMaxRunes = 2000
	lifePageTemplate = "# 我的小日子\n\n## 兜里\n\n## 住在\n\n## 答应过\n\n## 手上在做\n"
)

// SetLifePage sets the life page file ("" = off). "~/" is expanded.
func (e *Engine) SetLifePage(path string) {
	path = strings.TrimSpace(path)
	if strings.HasPrefix(path, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			path = filepath.Join(home, path[2:])
		}
	}
	e.lifePage = path
}

// lifePageBlock renders the life page for this turn ("" when off or unreadable).
func (e *Engine) lifePageBlock() string {
	path := e.lifePage
	if path == "" {
		return ""
	}
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		if mkErr := os.MkdirAll(filepath.Dir(path), 0o755); mkErr == nil {
			if wErr := os.WriteFile(path, []byte(lifePageTemplate), 0o644); wErr == nil {
				slog.Info("life page: created template", "path", path)
			}
		}
		data, err = []byte(lifePageTemplate), nil
	}
	if err != nil {
		slog.Warn("life page: read failed", "path", path, "error", err)
		return ""
	}
	body := strings.TrimSpace(string(data))
	if n := utf8.RuneCountInString(body); n > lifePageMaxRunes {
		body = string([]rune(body)[:lifePageMaxRunes]) +
			fmt.Sprintf("\n…（页面共 %d 字，超过 %d 字只附前面部分，全文看文件；这页只写现在的样子，请精简）", n, lifePageMaxRunes)
	}
	shown := path
	if home, err := os.UserHomeDir(); err == nil && strings.HasPrefix(shown, home+"/") {
		shown = "~" + shown[len(home):]
	}
	return fmt.Sprintf("%s%s，系统每轮自动附上：这是你现在的样子；有变化直接改这个文件，不要往下追加）\n%s\n%s",
		lifePageHead, shown, body, lifePageEnd)
}
