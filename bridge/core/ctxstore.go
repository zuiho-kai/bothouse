package core

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// The context store (user 2026-11-04 「做」 on 「所有塞进去的材料只给标题加一句话加编号，正文 AI 需要时用一条命令按编号取」):
// what used to be injected whole is written here under a short id, and the turn carries only a title, one
// line and [#id]; `bothouse ctx <id>` prints it. The gate (contrib/gate/ctxsvc.py stash) writes the same
// directory, so one command fetches gate blocks, wiki entries and the old-session handoff alike.

// CtxStoreDir is <dataDir>/ctx (ctxsvc.store_dir).
func CtxStoreDir(dataDir string) string { return filepath.Join(dataDir, "ctx") }

var ctxIDRe = regexp.MustCompile(`^[0-9a-f]{6,16}$`)

// StashCtx writes body to the store and returns its id (first 8 hex of its sha1), "" when it cannot.
func StashCtx(dataDir, body string) string {
	if dataDir == "" {
		return ""
	}
	sum := sha1.Sum([]byte(body))
	id := hex.EncodeToString(sum[:])[:8]
	dir := CtxStoreDir(dataDir)
	f := filepath.Join(dir, id+".md")
	if _, err := os.Stat(f); err == nil {
		return id
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return ""
	}
	tmp := fmt.Sprintf("%s.%d.tmp", f, os.Getpid())
	if err := os.WriteFile(tmp, []byte(body), 0o644); err != nil {
		return ""
	}
	if err := os.Rename(tmp, f); err != nil {
		_ = os.Remove(tmp)
		return ""
	}
	return id
}

// ReadCtx returns the body stored under id (a leading "#" and surrounding brackets are allowed).
func ReadCtx(dataDir, id string) (string, error) {
	id = strings.ToLower(strings.Trim(strings.TrimSpace(id), "[]#"))
	if !ctxIDRe.MatchString(id) {
		return "", fmt.Errorf("编号 %q 不对：应是 [#…] 里的 6–16 位十六进制", id)
	}
	b, err := os.ReadFile(filepath.Join(CtxStoreDir(dataDir), id+".md"))
	if err != nil {
		if os.IsNotExist(err) {
			return "", fmt.Errorf("没有编号 #%s 的正文（可能已过期清掉）；wiki 条可按推送里的页路径和行号读", id)
		}
		return "", err
	}
	return string(b), nil
}
