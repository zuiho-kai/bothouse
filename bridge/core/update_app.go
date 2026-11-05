package core

import (
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// A macOS release ships a signed Bothouse.app, not a bare program. The signature seals
// Contents/Info.plist, Contents/_CodeSignature, Contents/Resources and the program together, so
// replacing only Contents/MacOS/bothouse leaves a bundle whose seal no longer matches what was
// signed: codesign then reports "invalid Info.plist", the browser check calls the app damaged, and
// UpdateRefusal refuses every later update (v0.1.50 could not update itself).
// An update therefore replaces the whole bundle, and everything the updater keeps beside the
// program (backups, the update marker) lives outside the bundle so the seal stays valid.
//
// The swap takes two steps in the same directory: the new bundle is fully staged as a hidden
// sibling first, then one rename exchanges it with the installed bundle. The installed path is
// never missing in between, and the running process is unaffected because it holds the old inodes,
// not the path (measured: after exchanging the directories of a running program, os.Executable
// still names the installed path and the process keeps serving).

// errNoAtomicSwap: this platform cannot exchange two paths in one rename, so installUnitFrom
// falls back to moving the old unit aside first.
var errNoAtomicSwap = errors.New("atomic directory swap not supported")

// swapDirsFn exchanges two paths in one rename (RENAME_SWAP). Swappable in tests, which cover the
// fallback on every platform.
var swapDirsFn = swapDirs

// installedProgramPath is the running program file with symlinks resolved. Swappable in tests,
// which never touch the real test binary.
var installedProgramPath = func() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.EvalSymlinks(exe)
}

// verifyAppBundleFn checks a staged bundle's seal before it is installed. Swappable in tests,
// which have no release certificate.
var verifyAppBundleFn = verifyAppBundle

// attachDmgFn / detachDmgFn mount and unmount the downloaded dmg. Swappable in tests: building a
// dmg needs hdiutil create, which fails in this sandbox and in CI.
var (
	attachDmgFn = func(disk, mount string) error {
		out, err := exec.Command("hdiutil", "attach", "-readonly", "-nobrowse", "-mountpoint", mount, disk).CombinedOutput()
		if err != nil {
			return fmt.Errorf("mount dmg: %w: %s", err, out)
		}
		return nil
	}
	detachDmgFn = func(mount string) error {
		if out, err := exec.Command("hdiutil", "detach", mount).CombinedOutput(); err != nil {
			return fmt.Errorf("unmount dmg: %w: %s", err, out)
		}
		return nil
	}
)

// ReleasePayload is what an update installs: the single program a legacy archive carries, or the
// whole signed .app of a macOS dmg.
type ReleasePayload struct {
	Binary []byte // the program, for the formats that ship one file
	AppDir string // a staged .app (macOS dmg), released by Cleanup
	// Cleanup releases the payload's temporary space. Nil for a Binary payload, whose bytes the
	// caller owns.
	Cleanup func()
}

// ExtractReleasePayload accepts the release's native format and the legacy archives. Only the
// macOS dmg brings a bundle; the other formats keep their single-program shape.
func ExtractReleasePayload(data []byte, filename string) (*ReleasePayload, error) {
	if !strings.HasSuffix(filename, ".dmg") {
		b, err := ExtractReleaseBinary(data, filename)
		if err != nil {
			return nil, err
		}
		return &ReleasePayload{Binary: b}, nil
	}
	if runtime.GOOS != "darwin" {
		return nil, fmt.Errorf("dmg extraction requires macOS")
	}
	dir, err := os.MkdirTemp("", "bothouse-update-*")
	if err != nil {
		return nil, err
	}
	dst := filepath.Join(dir, "Bothouse.app")
	payload := &ReleasePayload{AppDir: dst, Cleanup: func() { _ = os.RemoveAll(dir) }}
	if err := extractAppFromDmg(data, dst); err != nil {
		payload.Cleanup()
		return nil, err
	}
	return payload, nil
}

// extractAppFromDmg writes the dmg, mounts it read-only, copies the whole .app out and unmounts.
// The copy is plain Go (no ditto/cp), measured to keep the seal intact; it finishes before the
// volume goes away, so nothing is read from a vanished mount.
func extractAppFromDmg(data []byte, dst string) error {
	dir := filepath.Dir(dst)
	disk := filepath.Join(dir, "bothouse.dmg")
	mount := filepath.Join(dir, "volume")
	if err := os.WriteFile(disk, data, 0o600); err != nil {
		return err
	}
	if err := attachDmgFn(disk, mount); err != nil {
		return err
	}
	// Copy before unmounting (the source is on the volume), and unmount even when the copy
	// failed: a mounted volume cannot be removed with the temporary directory.
	copyErr := CopyAppTree(dst, filepath.Join(mount, "Bothouse.app"))
	if detachErr := detachDmgFn(mount); detachErr != nil {
		return detachErr
	}
	if copyErr != nil {
		return fmt.Errorf("copy Bothouse.app from dmg: %w", copyErr)
	}
	return nil
}

// appSiblingKinds are the suffixes this package gives to a bundle's siblings:
// .Bothouse.app.old-<n> (backup), .Bothouse.app.failed-<n> (a version that did not come up),
// .Bothouse.app.new-<n> (staging, alive for a few milliseconds).
var appSiblingKinds = []string{".old-", ".failed-", ".new-"}

// stripSiblingSuffix turns our own sibling names back into the bundle name:
// ".Bothouse.app.old-123" → "Bothouse.app". Other names come back unchanged.
func stripSiblingSuffix(base string) string {
	for _, kind := range appSiblingKinds {
		i := strings.LastIndex(base, kind)
		if i <= 0 {
			continue
		}
		if rest := base[i+len(kind):]; rest != "" && strings.Trim(rest, "0123456789") == "" {
			return strings.TrimPrefix(base[:i], ".") // our siblings are hidden
		}
	}
	return base
}

// appBundleOf returns the .app directory that holds p, or false when p is not inside a bundle.
// A bundle's own siblings (".Bothouse.app.old-123", the backup of a previous update) count as
// that bundle: they have the same layout.
func appBundleOf(p string) (string, bool) {
	dir := p
	if !strings.HasSuffix(stripSiblingSuffix(filepath.Base(p)), ".app") {
		dir = filepath.Dir(p)
	}
	for {
		if strings.HasSuffix(stripSiblingSuffix(filepath.Base(dir)), ".app") {
			return dir, true
		}
		next := filepath.Dir(dir)
		if next == dir {
			return "", false
		}
		dir = next
	}
}

// installUnit is what an update moves for a program path: the enclosing .app bundle when there is
// one, else the program file itself (install.sh puts a bare program in place).
func installUnit(program string) string {
	if app, ok := appBundleOf(program); ok {
		return app
	}
	return program
}

// execProgramPath is the file to execute for a unit: a bundle's program inside it, or the unit
// itself when it is a plain file.
func execProgramPath(unit string) string {
	if fi, err := os.Stat(unit); err == nil && fi.IsDir() {
		return filepath.Join(unit, "Contents", "MacOS", "bothouse")
	}
	return unit
}

// markerPathFor is where the update marker of program goes. Inside a bundle it must sit beside the
// bundle: any extra file under Contents/ breaks the seal ("a sealed resource is missing or
// invalid", measured), and a marker that breaks the seal would fail the very check it protects.
func markerPathFor(program string) string {
	app, ok := appBundleOf(program)
	if !ok {
		return program + ".update-pending"
	}
	return filepath.Join(filepath.Dir(app), "."+stripSiblingSuffix(filepath.Base(app))+".update-pending")
}

// installedPathOfBackup maps a path inside a bundle backup back to the installed bundle:
// "/Applications/.Bothouse.app.old-77/Contents/MacOS/bothouse" →
// "/Applications/Bothouse.app/Contents/MacOS/bothouse". A plain program keeps the
// BinaryFromBackupPath mapping. Paths that are not ours come back unchanged.
func installedPathOfBackup(p string) string {
	app, ok := appBundleOf(p)
	if !ok {
		return binaryFromBackupPath(p)
	}
	base := stripSiblingSuffix(filepath.Base(app))
	if base == filepath.Base(app) {
		return p // already the installed bundle
	}
	rel, err := filepath.Rel(app, p)
	if err != nil {
		return p
	}
	return filepath.Join(filepath.Dir(app), base, rel)
}

// siblingPath returns a fresh name beside target, outside any bundle seal: ".<base>.<kind>-<n>".
// n follows BinaryBackupPath (Unix micro × 1000 + a per-process sequence; 沿用) so two updates in
// the same microsecond cannot collide.
func siblingPath(target, kind string) string {
	n := time.Now().UnixMicro()*1000 + backupSeq.Add(1)%1000
	for {
		p := filepath.Join(filepath.Dir(target), fmt.Sprintf(".%s.%s-%d", filepath.Base(target), kind, n))
		if _, err := os.Lstat(p); err != nil {
			return p
		}
		n++
	}
}

// backupPathFor is where the unit being replaced is kept: a sibling of a bundle, a
// "<target>.old-<n>" file for a plain program (unchanged from the file-only updater).
func backupPathFor(unit string) string {
	if strings.HasSuffix(stripSiblingSuffix(filepath.Base(unit)), ".app") {
		return siblingPath(unit, "old")
	}
	return BinaryBackupPath(unit)
}

// failedPathFor is where a unit that did not come up is parked before the old one returns.
func failedPathFor(unit string) string {
	if strings.HasSuffix(stripSiblingSuffix(filepath.Base(unit)), ".app") {
		return siblingPath(unit, "failed")
	}
	return strings.Replace(BinaryBackupPath(unit), ".old-", ".failed-", 1)
}

// removeInstallBackups removes backups and staged leftovers of earlier updates, one at a time,
// skipping the bundle this process runs from (it may still need it).
func removeInstallBackups(app string) {
	self, _ := os.Executable()
	dir, base := filepath.Dir(app), filepath.Base(app)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		name := e.Name()
		ours := false
		for _, kind := range appSiblingKinds {
			if strings.HasPrefix(name, "."+base+kind) {
				ours = true
				break
			}
		}
		if !ours {
			continue
		}
		p := filepath.Join(dir, name)
		if self != "" && strings.HasPrefix(filepath.Clean(self), p+string(filepath.Separator)) {
			continue
		}
		if err := os.RemoveAll(p); err != nil {
			slog.Warn("updater: cannot remove an earlier app bundle backup", "path", p, "error", err)
		}
	}
}

// checkWritableDir reports whether the updater may create files in dir — the bundle's parent.
// Tested by writing rather than by reading permission bits: the swap needs one rename beside the
// bundle, and the error the OS gives (not the mode bits) is what decides. The OS error is returned
// as is, so the page can answer "permission".
func checkWritableDir(dir string) error {
	f, err := os.CreateTemp(dir, ".bothouse-writable-*")
	if err != nil {
		return err
	}
	name := f.Name()
	f.Close()
	_ = os.Remove(name)
	return nil
}

// CopyAppTree copies a bundle directory to dst, keeping file modes and symlinks. The copy keeps a
// valid seal (measured: `cp -R`, `ditto` and a plain Go copy all verify with `codesign -v
// --strict`); the caller verifies it anyway before installing.
func CopyAppTree(dst, src string) error {
	return filepath.WalkDir(src, func(p string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(src, p)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		info, err := d.Info()
		if err != nil {
			return err
		}
		switch {
		case d.IsDir():
			return os.MkdirAll(target, info.Mode().Perm())
		case info.Mode()&os.ModeSymlink != 0:
			link, err := os.Readlink(p)
			if err != nil {
				return err
			}
			return os.Symlink(link, target)
		default:
			data, err := os.ReadFile(p)
			if err != nil {
				return err
			}
			if err := os.WriteFile(target, data, info.Mode().Perm()); err != nil {
				return err
			}
			return os.Chmod(target, info.Mode().Perm())
		}
	})
}

// installUnitFrom puts the staged unit at target and returns where the replaced unit went. The
// exchange asks for one rename; on platforms without it the old unit is moved aside first and put
// back if the second rename fails.
func installUnitFrom(staged, target string) (string, error) {
	if err := swapDirsFn(staged, target); err == nil {
		// staged now holds the unit that was installed; give it its backup name.
		old := backupPathFor(target)
		if err := os.Rename(staged, old); err != nil {
			return staged, nil // still one of ours (".<base>.new-<n>"); rollback and the next update handle it
		}
		return old, nil
	}
	old := backupPathFor(target)
	if err := os.Rename(target, old); err != nil {
		return "", err
	}
	if err := os.Rename(staged, target); err != nil {
		if restoreErr := os.Rename(old, target); restoreErr != nil {
			slog.Error("updater: failed to restore the old app bundle after install failed", "error", restoreErr)
		}
		return "", err
	}
	return old, nil
}

// verifyAppBundle checks that the bundle at app is sealed as signed: `codesign --verify --strict`
// covers every resource, and a release build additionally requires the release certificate, so a
// bundle re-signed by someone else is refused before it is installed.
func verifyAppBundle(app string) error {
	if runtime.GOOS != "darwin" {
		return nil
	}
	args := []string{"--verify", "--strict"}
	if ReleaseSignerID != "" && ReleaseSignerHash != "" {
		args = append(args, "-R="+releaseRequirement(ReleaseSignerID, ReleaseSignerHash))
	}
	out, err := exec.Command("/usr/bin/codesign", append(args, app)...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("codesign: %v: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// InstallReleasePayload installs an extracted release over the running program and releases the
// payload's temporary space.
func InstallReleasePayload(p *ReleasePayload) error {
	if p.Cleanup != nil {
		defer p.Cleanup()
	}
	if p.AppDir != "" {
		return ReplaceAppBundle(p.AppDir)
	}
	return replaceBinary(p.Binary)
}

// ReplaceAppBundle installs the staged .app over the running one and keeps the replaced bundle as
// lastBinaryBackup, the backup every rollback path (guard, update marker) restores from.
// A program installed as a bare file (install.sh) has no seal to keep, so it gets only the program
// from inside the bundle, as the file-only updater does.
func ReplaceAppBundle(staged string) error {
	exe, err := installedProgramPath()
	if err != nil {
		return fmt.Errorf("get executable path: %w", err)
	}
	app, bundled := appBundleOf(exe)
	if !bundled {
		b, err := os.ReadFile(filepath.Join(staged, "Contents", "MacOS", "bothouse"))
		if err != nil {
			return fmt.Errorf("read release binary: %w", err)
		}
		return replaceBinary(b)
	}
	parent := filepath.Dir(app)
	if err := checkWritableDir(parent); err != nil {
		// The bundle's folder is not ours to write, and both the swap and the backup beside it
		// need one rename there. Installing the program alone would break the seal (the v0.1.50
		// defect), so refuse and leave the running version untouched.
		return fmt.Errorf("cannot write the update beside %s (the folder is not writable; "+
			"install the new version from its .dmg): %w", parent, err)
	}
	if err := verifyAppBundleFn(staged); err != nil {
		return fmt.Errorf("release app is not sealed: %w", err)
	}
	removeInstallBackups(app)
	lastBinaryBackup = ""

	newApp := siblingPath(app, "new")
	if err := CopyAppTree(newApp, staged); err != nil {
		_ = os.RemoveAll(newApp)
		return fmt.Errorf("stage new app: %w", err)
	}
	// Verify the copy that is about to be installed, not only the download.
	if err := verifyAppBundleFn(newApp); err != nil {
		_ = os.RemoveAll(newApp)
		return fmt.Errorf("install new app: %w", err)
	}
	old, err := installUnitFrom(newApp, app)
	if err != nil {
		_ = os.RemoveAll(newApp)
		return fmt.Errorf("install new app: %w", err)
	}
	lastBinaryBackup = old
	slog.Info("updater: app bundle replaced", "path", app, "backup", old)
	return nil
}
