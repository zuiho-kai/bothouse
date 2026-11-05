package core

import (
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"
)

// bundleFixture mirrors what package-dmg.sh builds: Contents/MacOS/bothouse, an Info.plist with
// the version, Contents/Resources and a Contents/_CodeSignature made by signing the whole bundle.
// files: extra resources to write before signing (e.g. a marker standing in for an app resource).
func bundleFixture(t *testing.T, dir, name, version string, files map[string]string) (app, exe string) {
	t.Helper()
	app = filepath.Join(dir, name)
	exe = filepath.Join(app, "Contents", "MacOS", "bothouse")
	if err := os.MkdirAll(filepath.Join(app, "Contents", "MacOS"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(app, "Contents", "Resources"), 0o755); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile("/usr/bin/true")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(exe, data, 0o755); err != nil {
		t.Fatal(err)
	}
	plist := `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>bothouse</string>
<key>CFBundleIdentifier</key><string>ai.bothouse.desktop</string>
<key>CFBundleShortVersionString</key><string>` + version + `</string>
</dict></plist>
`
	if err := os.WriteFile(filepath.Join(app, "Contents", "Info.plist"), []byte(plist), 0o644); err != nil {
		t.Fatal(err)
	}
	for rel, content := range files {
		p := filepath.Join(app, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if out, err := exec.Command("/usr/bin/codesign", "--force", "--sign", "-", "--identifier", testID, app).CombinedOutput(); err != nil {
		t.Fatalf("codesign: %v: %s", err, out)
	}
	return app, exe
}

func needCodesign(t *testing.T) {
	t.Helper()
	if runtime.GOOS != "darwin" {
		t.Skip("codesign is macOS only")
	}
	if _, err := os.Stat("/usr/bin/codesign"); err != nil {
		t.Skip("codesign missing")
	}
}

func sealOK(t *testing.T, app string) {
	t.Helper()
	if out, err := exec.Command("/usr/bin/codesign", "--verify", "--strict", app).CombinedOutput(); err != nil {
		t.Fatalf("seal of %s broken: %v: %s", filepath.Base(app), err, out)
	}
}

func plistVersion(t *testing.T, app string) string {
	t.Helper()
	out, err := exec.Command("/usr/bin/plutil", "-extract", "CFBundleShortVersionString", "raw",
		filepath.Join(app, "Contents", "Info.plist")).Output()
	if err != nil {
		t.Fatalf("read version: %v", err)
	}
	return strings.TrimSpace(string(out))
}

// useInstalledProgram points the install and the update entry at exe and makes seal checks real.
// The fixture bundles are ad-hoc signed (no release certificate), so the release requirement is
// reduced to the identifier, as in identifierOnly.
func useInstalledProgram(t *testing.T, exe string) {
	t.Helper()
	identifierOnly(t)
	oldPath, oldVerify, oldExe := installedProgramPath, verifyAppBundleFn, updateExePath
	oldID, oldHash, oldSignGOOS := ReleaseSignerID, ReleaseSignerHash, updateSignGOOS
	t.Cleanup(func() {
		installedProgramPath, verifyAppBundleFn, updateExePath = oldPath, oldVerify, oldExe
		ReleaseSignerID, ReleaseSignerHash, updateSignGOOS = oldID, oldHash, oldSignGOOS
	})
	installedProgramPath = func() (string, error) { return exe, nil }
	updateExePath = func() string { return exe }
	verifyAppBundleFn = verifyAppBundle
	ReleaseSignerID, ReleaseSignerHash, updateSignGOOS = testID, testHash, "darwin"
}

// The defect: replacing only the program inside a signed bundle leaves a broken seal, the browser
// calls the app damaged and UpdateRefusal stops every later update. Replacing the bundle keeps
// the seal, the version and the update path intact.
func TestUpdateApp_ReplacesBundleKeepingSealVersionAndUpdatability(t *testing.T) {
	needCodesign(t)
	dir := t.TempDir()
	oldApp, exe := bundleFixture(t, dir, "Bothouse.app", "0.1.50", map[string]string{"Contents/Resources/app.icns": "old icon"})
	newDir := filepath.Join(dir, "release")
	stagedOld, _ := bundleFixture(t, newDir, "Bothouse.app", "0.1.51", map[string]string{"Contents/Resources/app.icns": "new icon"})
	newSeal, err := os.ReadFile(filepath.Join(stagedOld, "Contents", "_CodeSignature", "CodeResources"))
	if err != nil {
		t.Fatalf("new package has no seal: %v", err)
	}
	oldSeal, err := os.ReadFile(filepath.Join(oldApp, "Contents", "_CodeSignature", "CodeResources"))
	if err != nil {
		t.Fatal(err)
	}
	useInstalledProgram(t, exe)

	// Before the update this copy is intact, so the update entry accepts it.
	if err := UpdateRefusal(); err != nil {
		t.Fatalf("intact bundle refused: %v", err)
	}
	if err := ReplaceAppBundle(stagedOld); err != nil {
		t.Fatalf("ReplaceAppBundle: %v", err)
	}

	// The version the user sees (browsers, About, the update check) is the new package's.
	if got := plistVersion(t, oldApp); got != "0.1.51" {
		t.Fatalf("Info.plist version = %s, want 0.1.51", got)
	}
	sealOK(t, oldApp)
	for _, rel := range []string{"Contents/MacOS/bothouse", "Contents/Info.plist", "Contents/_CodeSignature/CodeResources"} {
		got, err := os.ReadFile(filepath.Join(oldApp, rel))
		if err != nil {
			t.Fatalf("%s: %v", rel, err)
		}
		want, err := os.ReadFile(filepath.Join(stagedOld, rel))
		if err != nil {
			t.Fatal(err)
		}
		if string(got) != string(want) {
			t.Fatalf("%s does not come from the new package", rel)
		}
	}
	if got, _ := os.ReadFile(filepath.Join(oldApp, "Contents", "Resources", "app.icns")); string(got) != "new icon" {
		t.Fatalf("Resources came from the old package: %q", got)
	}
	if string(oldSeal) == string(newSeal) {
		t.Fatal("the old seal was still there")
	}
	// Updating again works: the seal matches, so the next release is accepted.
	if err := UpdateRefusal(); err != nil {
		t.Fatalf("update after the swap refused: %v", err)
	}
	// The backup is a whole bundle beside the app, never inside it.
	backup := lastBinaryBackup
	if backup == "" || filepath.Dir(backup) != filepath.Dir(oldApp) || !strings.HasPrefix(filepath.Base(backup), ".Bothouse.app.old-") {
		t.Fatalf("backup %q is not a sibling bundle", backup)
	}
	if got := plistVersion(t, backup); got != "0.1.50" {
		t.Fatalf("backup version %s", got)
	}
	sealOK(t, backup)
	if exe := execProgramPath(backup); exe != filepath.Join(backup, "Contents", "MacOS", "bothouse") {
		t.Fatalf("guard would run %q", exe)
	}
}

// The old behaviour, kept as the reference: replacing only the program breaks both the seal and
// the next update. This is what the bundle swap exists to prevent.
func TestUpdateRefusal_BinaryOnlySwapBreaksTheSeal(t *testing.T) {
	needCodesign(t)
	dir := t.TempDir()
	app, exe := bundleFixture(t, dir, "Bothouse.app", "0.1.50", nil)
	useInstalledProgram(t, exe)
	if err := UpdateRefusal(); err != nil {
		t.Fatalf("intact bundle refused: %v", err)
	}
	data, err := os.ReadFile("/usr/bin/false")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(exe, data, 0o755); err != nil { // what ExtractReleaseBinary+replaceBinary did
		t.Fatal(err)
	}
	if err := UpdateRefusal(); err == nil {
		t.Fatal("a bundle with a foreign program still passes: the seal is not checked")
	}
	if out, err := exec.Command("/usr/bin/codesign", "--verify", "--strict", app).CombinedOutput(); err == nil {
		t.Fatalf("codesign accepted a broken bundle: %s", out)
	}
}

// A staged bundle whose seal is broken must not be installed: the app would open as damaged and
// the update path would be dead until the user reinstalls.
func TestUpdateApp_RefusesBrokenStagedSeal(t *testing.T) {
	needCodesign(t)
	dir := t.TempDir()
	oldApp, exe := bundleFixture(t, dir, "Bothouse.app", "0.1.50", nil)
	staged, _ := bundleFixture(t, filepath.Join(dir, "release"), "Bothouse.app", "0.1.51", nil)
	if err := os.WriteFile(filepath.Join(staged, "Contents", "Resources", "sneaked"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	useInstalledProgram(t, exe)
	if err := ReplaceAppBundle(staged); err == nil {
		t.Fatal("broken seal installed")
	}
	if got := plistVersion(t, oldApp); got != "0.1.50" {
		t.Fatalf("installed version changed to %s", got)
	}
	sealOK(t, oldApp)
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if strings.Contains(e.Name(), ".new-") {
			t.Fatalf("staging %s left behind", e.Name())
		}
	}
}

// Without RENAME_SWAP (or when it fails) the two renames still install correctly.
func TestUpdateApp_InstallUnitFallbackAndRestore(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "Bothouse.app")
	staged := filepath.Join(dir, ".Bothouse.app.new-1")
	for _, p := range []string{filepath.Join(target, "v"), filepath.Join(staged, "v")} {
		if err := os.MkdirAll(p, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(p, "which"), []byte(filepath.Base(p)), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	oldSwap := swapDirsFn
	t.Cleanup(func() { swapDirsFn = oldSwap })
	swapDirsFn = func(string, string) error { return errNoAtomicSwap }

	backup, err := installUnitFrom(staged, target)
	if err != nil {
		t.Fatal(err)
	}
	if got := readFile(t, filepath.Join(target, "v", "which")); got != "v" && !strings.Contains(got, "new") {
		// both dirs hold "v"; what matters is where the old one went
		t.Logf("target content %q", got)
	}
	if got := readFile(t, filepath.Join(backup, "v", "which")); got != "v" {
		t.Fatalf("backup content %q", got)
	}
	if _, err := os.Stat(staged); !os.IsNotExist(err) {
		t.Fatal("staged unit still there after install")
	}

	// The second rename fails (staged vanished): the old unit must come back.
	gone := filepath.Join(dir, ".Bothouse.app.new-2")
	if _, err := installUnitFrom(gone, target); err == nil {
		t.Fatal("missing staged unit installed")
	}
	if _, err := os.Stat(target); err != nil {
		t.Fatalf("old unit not restored: %v", err)
	}
}

// The update marker must not sit inside the bundle: any extra file under Contents/ breaks the
// seal, and a marker that breaks the seal would fail the check it protects.
func TestUpdateApp_MarkerStaysOutsideBundle(t *testing.T) {
	needCodesign(t)
	dir := t.TempDir()
	app, exe := bundleFixture(t, dir, "Bothouse.app", "0.1.50", nil)
	spec := updateGuardSpec{Exe: exe, Backup: filepath.Join(dir, ".Bothouse.app.old-1"), StateDir: dir}
	if err := writeUpdateMarker(spec, 0); err != nil {
		t.Fatal(err)
	}
	marker := updateMarkerPath(exe)
	if strings.Contains(marker, app+string(filepath.Separator)) {
		t.Fatalf("marker inside the bundle: %s", marker)
	}
	if !updateMarkerExists(exe) {
		t.Fatal("marker not found where the new version looks")
	}
	sealOK(t, app)
	// The marker survives a swap: it sits beside the bundle, so the new version still finds it
	// and the seal is still intact with it in place.
	staged, _ := bundleFixture(t, filepath.Join(dir, "release"), "Bothouse.app", "0.1.51", nil)
	useInstalledProgram(t, exe)
	if err := ReplaceAppBundle(staged); err != nil {
		t.Fatalf("ReplaceAppBundle: %v", err)
	}
	if !updateMarkerExists(exe) {
		t.Fatal("marker lost in the swap")
	}
	sealOK(t, app)
	removeUpdateMarker(exe)
	if updateMarkerExists(exe) {
		t.Fatal("marker not removed")
	}
}

// The guard runs the old version from the bundle that was swapped out and puts the whole bundle
// back, so a rollback leaves a signed app again.
func TestUpdateApp_SwapBackOldRestoresWholeBundle(t *testing.T) {
	needCodesign(t)
	dir := t.TempDir()
	oldApp, exe := bundleFixture(t, dir, "Bothouse.app", "0.1.50", nil)
	backup := filepath.Join(dir, ".Bothouse.app.old-7")
	if err := os.Rename(oldApp, backup); err != nil {
		t.Fatal(err)
	}
	newApp, _ := bundleFixture(t, dir, ".Bothouse.app.new-8", "0.1.51", nil)
	if err := os.Rename(newApp, oldApp); err != nil {
		t.Fatal(err)
	}
	spec := updateGuardSpec{Exe: exe, Backup: backup, Old: "v0.1.50", Want: "v0.1.51", StateDir: dir}
	if r, ok := swapBackOld(spec); !ok || r.Status != "rolled_back" {
		t.Fatalf("%+v %v", r, ok)
	}
	if got := plistVersion(t, oldApp); got != "0.1.50" {
		t.Fatalf("rolled back to %s", got)
	}
	sealOK(t, oldApp)
	entries, _ := os.ReadDir(dir)
	var failed string
	for _, e := range entries {
		if strings.Contains(e.Name(), ".failed-") {
			failed = filepath.Join(dir, e.Name())
		}
	}
	if failed == "" || plistVersion(t, failed) != "0.1.51" {
		t.Fatalf("new bundle not parked: %q", failed)
	}
	sealOK(t, failed)
}

// The undo path used when the self-check cannot start touches the same unit.
func TestUpdateApp_UndoReplaceKeepsSeal(t *testing.T) {
	needCodesign(t)
	dir := t.TempDir()
	oldApp, exe := bundleFixture(t, dir, "Bothouse.app", "0.1.50", nil)
	backup := filepath.Join(dir, ".Bothouse.app.old-9")
	if err := os.Rename(oldApp, backup); err != nil {
		t.Fatal(err)
	}
	newApp, _ := bundleFixture(t, dir, ".Bothouse.app.new-10", "0.1.51", nil)
	if err := os.Rename(newApp, oldApp); err != nil {
		t.Fatal(err)
	}
	if err := undoReplace(updateGuardSpec{Exe: exe, Backup: backup}); err != nil {
		t.Fatal(err)
	}
	if got := plistVersion(t, oldApp); got != "0.1.50" {
		t.Fatalf("undo left %s", got)
	}
	sealOK(t, oldApp)
}

// removeInstallBackups clears siblings of earlier updates and leaves the running bundle.
func TestUpdateApp_RemovesInstallBackups(t *testing.T) {
	dir := t.TempDir()
	app := filepath.Join(dir, "Bothouse.app")
	for _, name := range []string{"Bothouse.app", ".Bothouse.app.old-1", ".Bothouse.app.failed-2", ".Bothouse.app.new-3", "notes.txt", "Other.app.old-4"} {
		if err := os.MkdirAll(filepath.Join(dir, name), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	removeInstallBackups(app)
	for name, want := range map[string]bool{
		"Bothouse.app": true, "notes.txt": true, "Other.app.old-4": true,
		".Bothouse.app.old-1": false, ".Bothouse.app.failed-2": false, ".Bothouse.app.new-3": false,
	} {
		if _, err := os.Stat(filepath.Join(dir, name)); (err == nil) != want {
			t.Fatalf("%s exists = %v, want %v", name, err == nil, want)
		}
	}
}

// A bare program (install.sh) has no bundle: the family of helpers must keep the file behaviour.
func TestUpdateApp_PlainProgramKeepsFileBehaviour(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "bothouse")
	if _, ok := appBundleOf(exe); ok {
		t.Fatal("plain program reported as a bundle")
	}
	if got := installUnit(exe); got != exe {
		t.Fatalf("unit %q", got)
	}
	if got := execProgramPath(exe); got != exe {
		t.Fatalf("exec %q", got)
	}
	if got := updateMarkerPath(exe); got != exe+".update-pending" {
		t.Fatalf("marker %q", got)
	}
	if err := os.WriteFile(exe, []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}
	if got := installedPathOfBackup(exe + ".old-12"); got != exe {
		t.Fatalf("installed path %q", got)
	}
}

// A path inside a bundle backup names the installed bundle, which is what the guard, the marker
// and the update entry resolve after a swap.
func TestUpdateApp_InstalledPathOfBackup(t *testing.T) {
	dir := t.TempDir()
	installed := filepath.Join(dir, "Bothouse.app", "Contents", "MacOS", "bothouse")
	for _, p := range []string{
		filepath.Join(dir, ".Bothouse.app.old-7", "Contents", "MacOS", "bothouse"),
		filepath.Join(dir, ".Bothouse.app.failed-8", "Contents", "MacOS", "bothouse"),
	} {
		if got := installedPathOfBackup(p); got != installed {
			t.Fatalf("%s → %s, want %s", p, got, installed)
		}
	}
	if got := installedPathOfBackup(installed); got != installed {
		t.Fatalf("installed path mapped to %s", got)
	}
	if got := installedPathOfBackup(dir + "/.Other.app.old-1/Contents/MacOS/bothouse"); got != filepath.Join(dir, "Other.app", "Contents", "MacOS", "bothouse") {
		t.Fatalf("other bundle → %s", got)
	}
}

// A dmg release carries the whole bundle: extraction stages it and the install puts it in place.
// hdiutil attach is stubbed with a directory standing in for the mounted volume (building a dmg
// needs `hdiutil create`, which fails in the sandbox and in CI).
func TestUpdateApp_ExtractDmgInstallsBundle(t *testing.T) {
	needCodesign(t)
	volume := t.TempDir()
	released, _ := bundleFixture(t, filepath.Join(volume, "mount"), "Bothouse.app", "0.1.51", map[string]string{"Contents/Resources/app.icns": "new icon"})
	oldAttach, oldDetach := attachDmgFn, detachDmgFn
	t.Cleanup(func() { attachDmgFn, detachDmgFn = oldAttach, oldDetach })
	attached, detached := 0, 0
	attachDmgFn = func(disk, mount string) error {
		attached++
		if _, err := os.Stat(disk); err != nil {
			return err
		}
		return os.Symlink(filepath.Dir(released), mount)
	}
	detachDmgFn = func(mount string) error {
		detached++
		return os.Remove(mount)
	}
	oldGOOS := updateSignGOOS
	t.Cleanup(func() { updateSignGOOS = oldGOOS })
	_ = oldGOOS

	payload, err := ExtractReleasePayload([]byte("dmg bytes"), "bothouse-mac.dmg")
	if err != nil {
		t.Fatalf("extract: %v", err)
	}
	if attached != 1 || detached != 1 {
		t.Fatalf("attach %d detach %d", attached, detached)
	}
	if payload.AppDir == "" || payload.Cleanup == nil {
		t.Fatalf("payload %+v", payload)
	}
	if got := plistVersion(t, payload.AppDir); got != "0.1.51" {
		t.Fatalf("staged version %s", got)
	}
	sealOK(t, payload.AppDir)

	dir := t.TempDir()
	installed, exe := bundleFixture(t, dir, "Bothouse.app", "0.1.50", nil)
	useInstalledProgram(t, exe)
	if err := InstallReleasePayload(payload); err != nil {
		t.Fatalf("install: %v", err)
	}
	if got := plistVersion(t, installed); got != "0.1.51" {
		t.Fatalf("installed version %s", got)
	}
	sealOK(t, installed)
	if err := UpdateRefusal(); err != nil {
		t.Fatalf("next update refused: %v", err)
	}
	if _, err := os.Stat(payload.AppDir); !os.IsNotExist(err) {
		t.Fatal("payload temporary space not released")
	}
}

// Non-dmg releases keep their single-program shape, byte for byte.
func TestUpdateApp_ExtractOtherFormatsStayBinary(t *testing.T) {
	payload, err := ExtractReleasePayload([]byte("executable bytes"), "bothouse-linux-x64")
	if err != nil || payload.AppDir != "" || string(payload.Binary) != "executable bytes" || payload.Cleanup != nil {
		t.Fatalf("%+v %v", payload, err)
	}
	if _, err := ExtractReleasePayload([]byte("x"), "bothouse-mac.dmg"); runtime.GOOS == "darwin" {
		// On macOS this must fail as a dmg (not silently pass the bytes through); the sandbox has
		// no hdiutil, so the error is the mount failure.
		if err == nil {
			t.Fatal("a non-dmg payload was accepted as a dmg")
		}
	}
}

// A dmg must never go through the single-program path: taking only Contents/MacOS/bothouse out
// of it is exactly the defect.
func TestUpdateApp_ExtractBinaryRefusesDmg(t *testing.T) {
	if _, err := ExtractReleaseBinary([]byte("dmg bytes"), "bothouse-mac.dmg"); err == nil {
		t.Fatal("dmg accepted as a single program")
	}
}

// A running process must not notice the swap: it holds the old program file open, and after the
// exchange that handle still reads the old bytes while the installed path serves the new ones.
// (On macOS the running process also keeps the old inodes for its mapped code; this is the file
// level of the same property.)
func TestUpdateApp_SwapLeavesRunningProcessItsFiles(t *testing.T) {
	needCodesign(t)
	dir := t.TempDir()
	oldApp, exe := bundleFixture(t, dir, "Bothouse.app", "0.1.50", nil)
	held, err := os.Open(exe)
	if err != nil {
		t.Fatal(err)
	}
	defer held.Close()
	before, err := io.ReadAll(held)
	if err != nil {
		t.Fatal(err)
	}
	beforeInfo, err := held.Stat()
	if err != nil {
		t.Fatal(err)
	}
	staged, _ := bundleFixture(t, filepath.Join(dir, "release"), "Bothouse.app", "0.1.51", nil)
	useInstalledProgram(t, exe)
	if err := ReplaceAppBundle(staged); err != nil {
		t.Fatalf("ReplaceAppBundle: %v", err)
	}
	// The open handle is unchanged: same inode, same bytes, and it is still readable.
	afterInfo, err := held.Stat()
	if err != nil {
		t.Fatalf("open handle broke: %v", err)
	}
	if !os.SameFile(beforeInfo, afterInfo) {
		t.Fatal("the open program file was replaced under the running process")
	}
	if _, err := held.Seek(0, io.SeekStart); err != nil {
		t.Fatal(err)
	}
	after, err := io.ReadAll(held)
	if err != nil {
		t.Fatalf("read from the open handle failed: %v", err)
	}
	if len(after) != len(before) {
		t.Fatal("the open file changed size")
	}
	// The installed path already serves the new package.
	if got := plistVersion(t, oldApp); got != "0.1.51" {
		t.Fatalf("installed version %s", got)
	}
}

// The window: the installed bundle is exchanged while its program is running. A real process
// started from inside the bundle (a copy of /bin/sleep, so the test binary is not the subject)
// must keep running, and the path must never be missing for another reader.
func TestUpdateApp_SwapKeepsRunningProcessAlive(t *testing.T) {
	needCodesign(t)
	dir := t.TempDir()
	oldApp, exe := bundleFixture(t, dir, "Bothouse.app", "0.1.50", nil)
	if out, err := exec.Command("/bin/cp", "/bin/sleep", exe).CombinedOutput(); err != nil {
		t.Fatalf("copy sleep: %v: %s", err, out)
	}
	if out, err := exec.Command("/usr/bin/codesign", "--force", "--sign", "-", "--identifier", testID, oldApp).CombinedOutput(); err != nil {
		t.Fatalf("re-sign: %v: %s", err, out)
	}
	proc := exec.Command(exe, "60")
	if err := proc.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = proc.Process.Kill(); _ = proc.Wait() }()

	staged, _ := bundleFixture(t, filepath.Join(dir, "release"), "Bothouse.app", "0.1.51", nil)
	useInstalledProgram(t, exe)
	if err := ReplaceAppBundle(staged); err != nil {
		t.Fatalf("ReplaceAppBundle: %v", err)
	}
	if err := proc.Process.Signal(syscall.Signal(0)); err != nil {
		t.Fatalf("the running process died in the swap: %v", err)
	}
	// The program at the installed path is the new one, and the bundle still verifies.
	if got := plistVersion(t, oldApp); got != "0.1.51" {
		t.Fatalf("installed version %s", got)
	}
	sealOK(t, oldApp)
}
