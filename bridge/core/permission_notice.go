package core

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// MissingPermissionError: the platform refused an action because the bot lacks a permission.
// Hint is the sentence for the people who can grant it (which permission, where to tick it).
// agentm 11-09/11-10: the task board failed to pin five times in three channels with only a log
// line, and nobody there knew whom to ask; now the channel is told once (permissionNotice).
type MissingPermissionError struct {
	Perm string
	Hint string
	Err  error
}

func (e *MissingPermissionError) Error() string { return e.Hint + " 原始错误：" + e.Err.Error() }
func (e *MissingPermissionError) Unwrap() error { return e.Err }

// Permission names as told to the user (the platform's settings label, then the English name).
const (
	PermManageChannels = "管理频道 (Manage Channels)"
	PermPinMessages    = "标注消息 (Pin Messages)" // Discord 中文界面里的名字（橘 11-10 看截图核过），不是「置顶消息」
)

var permissionNoticeMu sync.Mutex

func permissionNoticePath(dataDir string) string {
	return filepath.Join(dataDir, "permission_notices.json")
}

// loadPermissionNotices: chat session key -> permission -> when the channel was told.
func loadPermissionNotices(path string) map[string]map[string]time.Time {
	m := map[string]map[string]time.Time{}
	if b, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(b, &m)
	}
	return m
}

func savePermissionNotices(path string, m map[string]map[string]time.Time) {
	b, _ := json.MarshalIndent(m, "", "  ")
	tmp := path + ".tmp"
	if os.WriteFile(tmp, b, 0o600) == nil {
		_ = os.Rename(tmp, path)
	}
}

// permissionNotice tells chat sessionKey once, in plain words, that the bot lacks a permission
// (err wraps a MissingPermissionError). The same permission is not said again in that channel,
// across restarts; clearPermissionNotice forgets it once the action works, so losing it later
// is said again. Other errors do nothing. Returns whether a notice was posted.
func (e *Engine) permissionNotice(ctx context.Context, p Platform, sessionKey string, err error) bool {
	var mp *MissingPermissionError
	if !errors.As(err, &mp) || p == nil || e.dataDir == "" || sessionKey == "" {
		return false
	}
	rcr, ok := p.(ReplyContextReconstructor)
	if !ok {
		return false
	}
	path := permissionNoticePath(e.dataDir)
	permissionNoticeMu.Lock()
	defer permissionNoticeMu.Unlock()
	m := loadPermissionNotices(path)
	if _, told := m[sessionKey][mp.Perm]; told {
		return false
	}
	rc, rerr := rcr.ReconstructReplyCtx(sessionKey)
	if rerr != nil {
		return false
	}
	if serr := p.Send(ctx, rc, "⚠️ "+mp.Hint); serr != nil {
		// cannot even post here: nothing to remember, the next failure tries again
		slog.Warn("permission notice: post failed", "chat", sessionKey, "perm", mp.Perm, "error", serr)
		return false
	}
	if m[sessionKey] == nil {
		m[sessionKey] = map[string]time.Time{}
	}
	m[sessionKey][mp.Perm] = time.Now()
	savePermissionNotices(path, m)
	slog.Info("permission notice: told the channel once", "chat", sessionKey, "perm", mp.Perm)
	return true
}

// clearPermissionNotice: the action needing perm worked in sessionKey again.
func (e *Engine) clearPermissionNotice(sessionKey, perm string) {
	if e.dataDir == "" {
		return
	}
	path := permissionNoticePath(e.dataDir)
	permissionNoticeMu.Lock()
	defer permissionNoticeMu.Unlock()
	m := loadPermissionNotices(path)
	if _, ok := m[sessionKey][perm]; !ok {
		return
	}
	delete(m[sessionKey], perm)
	if len(m[sessionKey]) == 0 {
		delete(m, sessionKey)
	}
	savePermissionNotices(path, m)
}
