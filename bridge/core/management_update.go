package core

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// releasesPage is where users download a release by hand when the in-app update fails.
const releasesPage = "https://github.com/zuiho-kai/bothouse/releases/latest"

// Swappable in tests; production uses the existing updater (same path as `/upgrade confirm`).
var (
	updateCheckFn = CheckForUpdate
	selfUpdateFn  = SelfUpdate
	updateMu      sync.Mutex // one apply at a time
)

func isDevVersion(v string) bool { return v == "" || v == "dev" }

func downloadPage(r *ReleaseInfo) string {
	if r != nil && r.HTMLURL != "" {
		return r.HTMLURL
	}
	return releasesPage
}

// updateCheckTTL: how long a GitHub update check (result or error) is reused.
// 来源：用户没给数；GitHub 未登录 API 每 IP 每小时限 60 次（GitHub REST 文档 rate limit），
// 取 10 分钟，每个进程每小时最多 6 次，留给同一 IP 上别的工具。
const updateCheckTTL = 10 * time.Minute

var updateCheckCache struct {
	sync.Mutex
	at  time.Time
	cur string
	rel *ReleaseInfo
	err error
}

func cachedUpdateCheck(cur string) (*ReleaseInfo, error) {
	c := &updateCheckCache
	c.Lock()
	defer c.Unlock()
	if c.cur == cur && !c.at.IsZero() && time.Since(c.at) < updateCheckTTL {
		return c.rel, c.err
	}
	c.rel, c.err = updateCheckFn(cur, false)
	c.at, c.cur = time.Now(), cur
	return c.rel, c.err
}

func resetUpdateCheckCache() {
	updateCheckCache.Lock()
	updateCheckCache.at = time.Time{}
	updateCheckCache.Unlock()
}

// GET /api/v1/update → current version, latest version, whether an update exists.
func (m *ManagementServer) handleUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		mgmtError(w, http.StatusMethodNotAllowed, "GET only")
		return
	}
	cur := CurrentVersion
	resp := map[string]any{
		"current":      cur,
		"latest":       "",
		"has_update":   false,
		"dev":          false,
		"download_url": releasesPage,
		"error":        "",
	}
	// The rollback note is local state: report it whatever the GitHub check does (offline and
	// rate-limited are exactly when an update tends to fail).
	if lr := ReadUpdateResult(UpdateStateDir); lr != nil && lr.Status != "ok" {
		resp["last_result"] = lr
	}
	// ?local=1: the page polling during a restart only wants local state, no GitHub call.
	if r.URL.Query().Get("local") == "1" {
		resp["latest"] = ""
		mgmtJSON(w, http.StatusOK, resp)
		return
	}
	if isDevVersion(cur) {
		resp["dev"] = true
		resp["error"] = "开发版不检查更新 / development build: update check disabled"
		mgmtJSON(w, http.StatusOK, resp)
		return
	}
	rel, err := cachedUpdateCheck(cur)
	if err != nil {
		resp["error"] = err.Error()
		mgmtJSON(w, http.StatusOK, resp)
		return
	}
	if rel != nil {
		resp["latest"] = rel.TagName
		resp["has_update"] = true
		resp["download_url"] = downloadPage(rel)
	} else {
		resp["latest"] = cur
	}
	mgmtJSON(w, http.StatusOK, resp)
}

// POST /api/v1/update/ack clears the rollback note once the page showed it.
func (m *ManagementServer) handleUpdateAck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		mgmtError(w, http.StatusMethodNotAllowed, "POST only")
		return
	}
	ClearUpdateResult(UpdateStateDir)
	mgmtJSON(w, http.StatusOK, map[string]any{"status": "ok"})
}

// updateFailReason maps an update error to a kind the page explains in plain words:
// permission (cannot replace the program file), download, checksum, restart, other.
func updateFailReason(err error) string {
	switch {
	case errors.Is(err, os.ErrPermission):
		return "permission"
	case errors.Is(err, ErrUpdateChecksum):
		return "checksum"
	case errors.Is(err, ErrUpdateDownload):
		return "download"
	case errors.Is(err, errUpdateRestart):
		return "restart"
	}
	return "other"
}

var errUpdateRestart = errors.New("cannot start the update self-check")

// POST /api/v1/update/apply → download + replace the binary via SelfUpdate (blocks until done),
// then trigger the existing restart. On failure returns the reason and the download page.
func (m *ManagementServer) handleUpdateApply(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		mgmtError(w, http.StatusMethodNotAllowed, "POST only")
		return
	}
	cur := CurrentVersion
	fail := func(status int, msg, url string, reason ...string) {
		rs := "other"
		if len(reason) > 0 {
			rs = reason[0]
		}
		mgmtJSON(w, status, map[string]any{"status": "failed", "error": msg, "reason": rs, "download_url": url})
	}
	if isDevVersion(cur) {
		fail(http.StatusOK, "开发版不检查更新 / development build: update check disabled", releasesPage)
		return
	}
	if !updateMu.TryLock() {
		fail(http.StatusConflict, "update already in progress", releasesPage)
		return
	}
	defer updateMu.Unlock()

	rel, err := updateCheckFn(cur, false)
	if err != nil {
		fail(http.StatusOK, err.Error(), releasesPage, "download")
		return
	}
	if rel == nil {
		mgmtJSON(w, http.StatusOK, map[string]any{"status": "up_to_date", "version": cur})
		return
	}
	if err := selfUpdateFn(rel.TagName, false); err != nil {
		fail(http.StatusOK, err.Error(), downloadPage(rel), updateFailReason(err))
		return
	}
	// Self-check: the old binary watches the new one and puts itself back if it does not come up.
	if err := armUpdateGuard(m, rel.TagName, nil); err != nil {
		fail(http.StatusOK, err.Error(), downloadPage(rel), "restart")
		return
	}
	mgmtJSON(w, http.StatusOK, map[string]any{"status": "restarting", "version": rel.TagName})
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
	requestRestart(RestartRequest{})
}

// POST /update on the local socket: `bothouse update` asks the running bothouse to install tag
// (the CLI picked it, honouring --pre), so the CLI goes through the same replace → self-check →
// restart as the web button instead of swapping the file under a running process.
//
// It refuses (never with 404: an older CLI reads 404 as "no /update here" and installs its own
// copy, which is harmless; 403/409 make it stop and touch nothing):
//   - a development build, like the web button and chat /upgrade;
//   - a tag that is not newer than this version (no downgrade through the socket);
//   - a request from another program: the peer process (kernel credentials) or, where the
//     platform cannot tell, the exe named in the request must be this very binary.
func handleSocketUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Tag string `json:"tag"`
		Exe string `json:"exe"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Tag == "" {
		http.Error(w, "tag is required", http.StatusBadRequest)
		return
	}
	cur := CurrentVersion
	if isDevVersion(cur) {
		http.Error(w, "development build: update disabled", http.StatusConflict)
		return
	}
	if semverCompare(req.Tag, cur) <= 0 {
		http.Error(w, fmt.Sprintf("%s is not newer than the running %s", req.Tag, cur), http.StatusConflict)
		return
	}
	self := updateExePath()
	// The peer path must be absolute to mean anything: macOS kern.procargs2 holds the path as
	// passed to execve (`./bothouse update` → "./bothouse"), which would resolve against our cwd.
	// Then the peer counts as unknown and the exe the CLI names (os.Executable, absolute) decides.
	who, known := socketPeerExeFn(r)
	if !known || !filepath.IsAbs(who) {
		who = req.Exe
	}
	if !SameProgram(who, self) || (req.Exe != "" && !SameProgram(req.Exe, self)) {
		if who == "" {
			who = "(not given)"
		}
		slog.Warn("update: refused /update from another program", "from", who, "self", self, "tag", req.Tag)
		http.Error(w, fmt.Sprintf("this bothouse (%s) only updates itself for its own program; request came from %s", self, who), http.StatusForbidden)
		return
	}
	if !updateMu.TryLock() {
		http.Error(w, "update already in progress", http.StatusConflict)
		return
	}
	defer updateMu.Unlock()
	if err := selfUpdateFn(req.Tag, false); err != nil {
		apiJSON(w, http.StatusOK, map[string]string{"status": "failed", "error": err.Error(), "reason": updateFailReason(err)})
		return
	}
	if err := armUpdateGuard(activeMgmt.Load(), req.Tag, nil); err != nil {
		apiJSON(w, http.StatusOK, map[string]string{"status": "failed", "error": err.Error(), "reason": "restart"})
		return
	}
	apiJSON(w, http.StatusOK, map[string]string{"status": "restarting", "version": req.Tag})
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
	requestRestart(RestartRequest{})
}

// undoReplace puts the backup back when the self-check could not be started.
func undoReplace(spec updateGuardSpec) error {
	failed := spec.Exe + ".failed"
	if err := os.Rename(spec.Exe, failed); err != nil {
		return err
	}
	if err := os.Rename(spec.Backup, spec.Exe); err != nil {
		_ = os.Rename(failed, spec.Exe)
		return err
	}
	_ = os.Remove(failed)
	return nil
}
