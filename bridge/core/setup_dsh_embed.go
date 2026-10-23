package core

import (
	"bytes"
	"context"
	"embed"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

//go:embed all:dsh_bundle
var embeddedDSH embed.FS

// ExtractEmbeddedDSH extracts the embedded DSH files into targetDir (default ~/.bothouse/dsh).
// It respects os.UserHomeDir() so HOME overrides in tests or isolated environments work.
func ExtractEmbeddedDSH(targetDir string) (string, error) {
	if targetDir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("resolve user home dir: %w", err)
		}
		targetDir = filepath.Join(home, ".bothouse", "dsh")
	}

	sub, err := fs.Sub(embeddedDSH, "dsh_bundle")
	if err != nil {
		return "", fmt.Errorf("get embedded dsh_bundle sub fs: %w", err)
	}

	err = fs.WalkDir(sub, ".", func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		dest := filepath.Join(targetDir, path)
		if d.IsDir() {
			return os.MkdirAll(dest, 0755)
		}
		data, err := fs.ReadFile(sub, path)
		if err != nil {
			return fmt.Errorf("read embedded file %s: %w", path, err)
		}
		mode := os.FileMode(0644)
		if filepath.Ext(path) == ".sh" || d.Name() == "install.sh" {
			mode = 0755
		}
		if err := os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
			return err
		}
		return os.WriteFile(dest, data, mode)
	})
	if err != nil {
		return "", fmt.Errorf("unpack embedded dsh to %s: %w", targetDir, err)
	}

	scriptPath := filepath.Join(targetDir, "install.sh")
	_ = os.Chmod(scriptPath, 0755)
	_ = os.WriteFile(filepath.Join(targetDir, dshVersionFile), []byte(CurrentVersion), 0644)
	return scriptPath, nil
}

// dshVersionFile records which program version last unpacked ~/.bothouse/dsh.
const dshVersionFile = ".version"

// keepIfExists lists bundle files the user (or the wizard) may edit after install; a refresh
// never overwrites them once present.
func keepIfExists(rel string) bool {
	base := filepath.Base(rel)
	return base == "cordis.patch.yml" || filepath.Ext(base) == ".env"
}

// RefreshEmbeddedDSH re-unpacks the embedded plugin code into targetDir (default ~/.bothouse/dsh)
// when it was installed by a different program version, so plugin fixes reach users after an
// upgrade. It only runs for an existing install (install.sh present), writes only bundle files,
// keeps cordis.patch.yml / *.env that already exist, and never touches node_modules, the
// per-project .env/.patch.yml beside it, or the collab database (~/.conest-collab).
// Returns true when files were refreshed.
func RefreshEmbeddedDSH(targetDir, version string) (bool, error) {
	if targetDir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return false, fmt.Errorf("resolve user home dir: %w", err)
		}
		targetDir = filepath.Join(home, ".bothouse", "dsh")
	}
	if _, err := os.Stat(filepath.Join(targetDir, "install.sh")); err != nil {
		return false, nil // not installed yet; first install extracts everything
	}
	stamp := filepath.Join(targetDir, dshVersionFile)
	if old, err := os.ReadFile(stamp); err == nil && string(old) == version {
		return false, nil
	}
	// One refresh at a time per plugin dir (two starts, or a leftover from before a restart).
	unlock, ok := lockDSHRefresh(targetDir)
	if !ok {
		slog.Info("dsh refresh: another refresh is running, skipped", "dir", targetDir)
		return false, nil
	}
	defer unlock()
	cleanStaleStaging(targetDir)
	sub, err := fs.Sub(embeddedDSH, "dsh_bundle")
	if err != nil {
		return false, err
	}
	// Dependencies changed (collab package.json / pnpm-lock.yaml): install them now in a staged
	// copy and swap it in, so a failed install leaves the old plugin and its node_modules as they
	// were. On failure nothing else is refreshed and .version stays old (retried next start).
	staged := false
	if newDeps, changed := collabDepsChanged(sub, targetDir); changed {
		if err := refreshCollabStaged(sub, targetDir, newDeps); err != nil {
			return false, fmt.Errorf("dsh plugin dependencies changed but reinstall failed, kept the old plugin: %w", err)
		}
		staged = true
	}
	err = fs.WalkDir(sub, ".", func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if staged && path == "collab" && d.IsDir() {
			return fs.SkipDir // already in place from the staged copy
		}
		dest := filepath.Join(targetDir, path)
		if d.IsDir() {
			return os.MkdirAll(dest, 0755)
		}
		if keepIfExists(path) {
			if _, err := os.Stat(dest); err == nil {
				return nil
			}
		}
		data, err := fs.ReadFile(sub, path)
		if err != nil {
			return err
		}
		mode := os.FileMode(0644)
		if filepath.Ext(path) == ".sh" {
			mode = 0755
		}
		return os.WriteFile(dest, data, mode)
	})
	if err != nil {
		return false, fmt.Errorf("refresh embedded dsh in %s: %w", targetDir, err)
	}
	_ = os.Chmod(filepath.Join(targetDir, "install.sh"), 0755)
	if err := os.WriteFile(stamp, []byte(version), 0644); err != nil {
		return true, err
	}
	return true, nil
}

// collabDepsStamp is written by install.sh (and by the staged refresh): a copy of
// collab/package.json + collab/pnpm-lock.yaml as they were when node_modules was installed.
const collabDepsStamp = ".bothouse-deps"

func embeddedCollabDeps(sub fs.FS) []byte {
	pkg, _ := fs.ReadFile(sub, "collab/package.json")
	lock, _ := fs.ReadFile(sub, "collab/pnpm-lock.yaml")
	return append(append([]byte{}, pkg...), lock...)
}

// collabDepsChanged: deps were installed (node_modules exists) and the embedded package.json /
// lockfile differ from what they were installed from. No node_modules = never installed; that
// is install.sh's job (the wizard), not the refresh's.
func collabDepsChanged(sub fs.FS, targetDir string) ([]byte, bool) {
	nm := filepath.Join(targetDir, "collab", "node_modules")
	if fi, err := os.Stat(nm); err != nil || !fi.IsDir() {
		return nil, false
	}
	want := embeddedCollabDeps(sub)
	have, err := os.ReadFile(filepath.Join(nm, collabDepsStamp))
	if err == nil && bytes.Equal(have, want) {
		return nil, false
	}
	return want, true
}

// dshDepsInstallTimeout bounds pnpm install. 来源：无给数；refresh 在后台跑、不挡启动，
// 取 10 分钟让慢网络能装完，又不会让卡住的 pnpm 永远占着。
var dshDepsInstallTimeout = 10 * time.Minute

// installCollabDeps runs the same install as install.sh's deps step. Swappable in tests.
var installCollabDeps = func(dir string) error {
	pnpm, err := exec.LookPath("pnpm")
	if err != nil {
		return fmt.Errorf("pnpm not found on PATH: %w", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), dshDepsInstallTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, pnpm, "install", "--frozen-lockfile", "--config.minimum-release-age=0")
	cmd.Dir = dir
	ownProcessGroup(cmd) // on timeout kill pnpm and everything it started, not just pnpm
	out, err := cmd.CombinedOutput()
	if err != nil {
		tail := string(out)
		if len(tail) > 800 {
			tail = tail[len(tail)-800:]
		}
		return fmt.Errorf("pnpm install: %w: %s", err, strings.TrimSpace(tail))
	}
	return nil
}

const (
	dshRefreshLock = ".refresh.lock"
	stagingPrefix  = ".collab-staging-"
	prevPrefix     = ".collab-prev-"
)

// lockDSHRefresh takes <targetDir>/.refresh.lock (O_EXCL, holds our PID). A lock whose PID is
// dead — or is our own PID, left by the process we exec'd from — is stale and taken over.
func lockDSHRefresh(targetDir string) (func(), bool) {
	p := filepath.Join(targetDir, dshRefreshLock)
	for i := 0; i < 2; i++ {
		f, err := os.OpenFile(p, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
		if err == nil {
			fmt.Fprint(f, os.Getpid())
			f.Close()
			return func() { _ = os.Remove(p) }, true
		}
		if !os.IsExist(err) {
			return nil, false
		}
		if b, rerr := os.ReadFile(p); rerr == nil {
			var pid int
			if _, serr := fmt.Sscan(strings.TrimSpace(string(b)), &pid); serr == nil && pid > 0 && pid != os.Getpid() && processAlive(pid) {
				return nil, false
			}
		}
		_ = os.Remove(p)
	}
	return nil, false
}

// cleanStaleStaging removes staging / prev dirs of earlier runs (called under the lock, so none
// of them is in use by a live refresh), plus the fixed names used before.
func cleanStaleStaging(targetDir string) {
	ents, err := os.ReadDir(targetDir)
	if err != nil {
		return
	}
	for _, e := range ents {
		n := e.Name()
		if n == ".collab-staging" || n == ".collab-prev" || strings.HasPrefix(n, stagingPrefix) || strings.HasPrefix(n, prevPrefix) {
			_ = os.RemoveAll(filepath.Join(targetDir, n))
		}
	}
}

// refreshCollabStaged builds the new collab next to the old one and swaps it in:
//  1. copy the installed collab (without node_modules) to .collab-staging-<pid>-<ns> — keeps any user files
//  2. lay the new bundle files over it (keepIfExists files stay)
//  3. pnpm install there, write the deps stamp
//  4. collab → .collab-prev-<pid>-<ns>, staging → collab (renamed back if the second rename fails)
//
// Any failure before step 4 only removes the staging directory.
func refreshCollabStaged(sub fs.FS, targetDir string, deps []byte) (err error) {
	live := filepath.Join(targetDir, "collab")
	// Unique per run: a pnpm left over from a killed run keeps writing into its own staging dir,
	// never into the one that becomes collab.
	tag := fmt.Sprintf("%d-%d", os.Getpid(), time.Now().UnixNano())
	stage := filepath.Join(targetDir, stagingPrefix+tag)
	prev := filepath.Join(targetDir, prevPrefix+tag)
	defer func() {
		if err != nil {
			_ = os.RemoveAll(stage)
		}
	}()
	if err := copyTreeExcept(live, stage, "node_modules"); err != nil {
		return fmt.Errorf("stage copy: %w", err)
	}
	collabSub, err := fs.Sub(sub, "collab")
	if err != nil {
		return err
	}
	err = fs.WalkDir(collabSub, ".", func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		dest := filepath.Join(stage, path)
		if d.IsDir() {
			return os.MkdirAll(dest, 0o755)
		}
		if keepIfExists(path) {
			if _, err := os.Stat(dest); err == nil {
				return nil
			}
		}
		data, err := fs.ReadFile(collabSub, path)
		if err != nil {
			return err
		}
		mode := os.FileMode(0o644)
		if filepath.Ext(path) == ".sh" {
			mode = 0o755
		}
		return os.WriteFile(dest, data, mode)
	})
	if err != nil {
		return fmt.Errorf("stage files: %w", err)
	}
	if err := installCollabDeps(stage); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(stage, "node_modules"), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(stage, "node_modules", collabDepsStamp), deps, 0o644); err != nil {
		return err
	}
	if err := os.Rename(live, prev); err != nil {
		return fmt.Errorf("move old plugin aside: %w", err)
	}
	if err := os.Rename(stage, live); err != nil {
		if rerr := os.Rename(prev, live); rerr != nil {
			slog.Error("dsh refresh: could not put the old plugin back", "error", rerr)
		}
		return fmt.Errorf("swap in new plugin: %w", err)
	}
	if err := os.RemoveAll(prev); err != nil {
		slog.Warn("dsh refresh: old plugin copy left behind", "path", prev, "error", err)
	}
	return nil
}

// copyTreeExcept copies src to dst, skipping top-level entries named skip. Symlinks are copied
// as links.
func copyTreeExcept(src, dst, skip string) error {
	return filepath.WalkDir(src, func(p string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(src, p)
		if err != nil {
			return err
		}
		if rel == skip || strings.HasPrefix(rel, skip+string(filepath.Separator)) {
			if d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		dest := filepath.Join(dst, rel)
		info, err := d.Info()
		if err != nil {
			return err
		}
		switch {
		case d.IsDir():
			return os.MkdirAll(dest, info.Mode().Perm()|0o700)
		case info.Mode()&os.ModeSymlink != 0:
			target, err := os.Readlink(p)
			if err != nil {
				return err
			}
			return os.Symlink(target, dest)
		default:
			data, err := os.ReadFile(p)
			if err != nil {
				return err
			}
			return os.WriteFile(dest, data, info.Mode().Perm())
		}
	})
}
