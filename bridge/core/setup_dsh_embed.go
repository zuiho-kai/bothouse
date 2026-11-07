package core

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"slices"
	"strings"
	"sync"
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
	if err := writeHandoffRules(filepath.Join(targetDir, "collab")); err != nil {
		return "", err
	}

	scriptPath := filepath.Join(targetDir, "install.sh")
	_ = os.Chmod(scriptPath, 0755)
	if CurrentVersion != "" { // a build without a version writes no stamp, so the next one refreshes
		_ = writeDSHStamp(filepath.Join(targetDir, dshVersionFile), dshStampNow(CurrentVersion))
	}
	return scriptPath, nil
}

// handoffRulesFile is the one copy of the handoff rules (contrib/lead/handoff-rules.json in the lead
// tools, read there by ws-handoff). The collab plugin reads its copy next to handoff-rules.mjs and
// refuses workspace handoffs and dispatches when it is missing, so every unpack and refresh writes it.
const handoffRulesFile = "handoff-rules.json"

// writeHandoffRules copies the lead tools' handoff rules into collabDir. LeadToolFS is set by the
// binary (cmd/cc-connect/setup_lead.go); only core unit tests run without it.
func writeHandoffRules(collabDir string) error {
	if LeadToolFS == nil {
		slog.Warn("dsh: lead tools not built in, collab has no handoff rules and will refuse handoffs", "dir", collabDir)
		return nil
	}
	data, err := fs.ReadFile(LeadToolFS, "contrib/lead/"+handoffRulesFile)
	if err != nil {
		return fmt.Errorf("dsh: read handoff rules: %w", err)
	}
	if err := os.MkdirAll(collabDir, 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(collabDir, handoffRulesFile), data, 0o644); err != nil {
		return fmt.Errorf("dsh: write handoff rules: %w", err)
	}
	return nil
}

// dshVersionFile records which program last unpacked ~/.bothouse/dsh. Since #249 it holds a
// one-line JSON dshStamp (version, commit, build time); installs made before that hold a bare
// version string, which parses as a stamp with an empty commit and build time.
const dshVersionFile = ".version"

// dshStamp identifies the program build that unpacked the plugin, so a refresh can tell whether
// it is newer than what is on disk. The old bare version string could not: any different string
// looked "newer", so an older binary starting once overwrote a newer plugin with its own copy
// (11-05 22:54, #166 B 6). commit is the short git commit and built the RFC3339 build time, both
// already set for the capabilities snapshot (bridge_capabilities.go).
type dshStamp struct {
	Version string `json:"version"`
	Commit  string `json:"commit,omitempty"`
	Built   string `json:"built,omitempty"`
}

// buildVCS is what the go tool records about the checkout a binary was built from.
type buildVCS struct {
	Commit   string // vcs.revision: the commit the binary was built from
	Built    string // vcs.time: that commit's time, RFC3339
	Modified bool   // vcs.modified: the work tree had uncommitted changes
}

// readBuildVCS reads the checkout `go build` embeds (#274 P2). The Makefile passes version, commit
// and build time as ldflags; a bare `go build`, which is how a developer installs the plugin
// locally, leaves those at "none"/"unknown" but still records the revision and its time. Read as a
// fallback, those two values make such an install orderable, so a release replaces it only when it
// is really newer instead of always (the P2 hole). They come from the binary's own build info, not
// from disk, so nothing at runtime can change the answer. A test binary carries no vcs settings,
// hence the variable: tests substitute their own.
var readBuildVCS = func() buildVCS {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return buildVCS{}
	}
	var v buildVCS
	for _, s := range info.Settings {
		switch s.Key {
		case "vcs.revision":
			v.Commit = strings.TrimSpace(s.Value)
		case "vcs.time":
			v.Built = strings.TrimSpace(s.Value)
		case "vcs.modified":
			v.Modified = s.Value == "true"
		}
	}
	return v
}

// dshStampNow records the running program's version and build metadata (#265 P2). A plain build
// fills missing commit and time fields from Go build info (#274 P2). Built may then contain a
// commit timestamp, while release builds may put a build wall clock there; it is retained for
// diagnostics and exact-stamp comparison, but cannot by itself prove code order (see stampOrder).
func dshStampNow(version string) dshStamp {
	return dshStampFor(version, readBuildVCS())
}

// dshStampFor is dshStampNow with the build info passed in, so tests can supply what `go test`
// does not carry (it has no vcs.* settings) and the refresh reads the build info only once.
func dshStampFor(version string, vcs buildVCS) dshStamp {
	commit, built := strings.TrimSpace(CurrentCommit), strings.TrimSpace(CurrentBuildTime)
	commitOK := commit != "" && !strings.EqualFold(commit, "none")
	_, builtOK := parseBuildStamp(built)
	if !commitOK && vcs.Commit != "" {
		commit, commitOK = vcs.Commit, true
	}
	if !builtOK {
		if _, ok := parseBuildStamp(vcs.Built); ok { // "unknown" and anything unparsable never go in
			built, builtOK = vcs.Built, true
		}
	}
	st := dshStamp{Version: version}
	if commitOK {
		st.Commit = commit
	}
	if builtOK {
		st.Built = built
	}
	return st
}

// stampRead is what .version told us.
type stampRead int

const (
	stampMissing stampRead = iota // no .version, or empty: nothing to compare against
	stampFound                    // a stamp to order against
	stampBroken                   // there but unreadable: cannot tell, keep what is installed
)

// readDSHStamp parses .version. A file from before #249 is a bare version string, kept as a
// version-only stamp so the first upgrade after it still works.
func readDSHStamp(path string) (dshStamp, stampRead) {
	b, err := os.ReadFile(path)
	if err != nil {
		return dshStamp{}, stampMissing
	}
	s := strings.TrimSpace(string(b))
	if s == "" {
		return dshStamp{}, stampMissing
	}
	if !strings.HasPrefix(s, "{") {
		return dshStamp{Version: s}, stampFound
	}
	var st dshStamp
	if err := json.Unmarshal([]byte(s), &st); err != nil {
		return dshStamp{}, stampBroken
	}
	if st.Version == "" {
		return dshStamp{}, stampMissing // written by a build that knew no version
	}
	return st, stampFound
}

// writeDSHStamp records st as one JSON object; readDSHStamp also still reads the bare version
// string written before #249.
func writeDSHStamp(path string, st dshStamp) error {
	data, err := json.Marshal(st)
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o644)
}

// stampVerdict orders the running program's stamp against the one on disk.
type stampVerdict int

const (
	stampSame    stampVerdict = iota // this same build already unpacked the plugin
	stampNewer                       // provably newer: refresh
	stampOlder                       // provably older: keep what is installed
	stampUnknown                     // cannot be ordered: keep what is installed
)

// stampOrder orders now against have, and answers stampNewer only when something can prove it
// (#249). Different semantic release numbers prove release-to-release order. An identical complete
// clean stamp proves Same. Built may mix build wall-clock time and commit time, and commit time
// does not prove ancestry; every other pair is Unknown and keeps the installed plugin.
//
// #265 added one narrow exception, which leaves the 11-05 direction blocked: a local build whose
// version tail names the same commit as this one is stampSame (same code, nothing to do).
//
// #274 removed the other one. #265 also let any release replace an install stamped by an
// unversioned `dev` build without comparing anything, which is the 11-05 overwrite in the other
// direction: a release from months ago would replace a plugin built later, and write a credible
// build time over it, so the release that should have refreshed it could be blocked in turn. The
// version-only stamp that rule was written for is now rare — a plain `go build` records vcs.revision
// and vcs.time (see dshStampNow) — and when it does happen nothing can prove the order, so it takes
// the same treatment as any unprovable stamp: keep the plugin, say so once, offer the way out.
//
// nowDirty is vcs.modified of the running build: uncommitted changes mean this binary may carry
// plugin code that no stamp on disk describes, so an equal stamp does not prove equal code
// (#274 第三条: `git describe` does not change when the work tree is dirty, and a plain `go build`
// stamps vcs.time, the commit's time, which does not change either — so a dirty rebuild produces
// exactly the stamp on disk).
func stampOrder(have, now dshStamp, nowDirty bool) (stampVerdict, string) {
	if have == now {
		if !nowDirty {
			return stampSame, ""
		}
		return stampUnknown, "this build of " + strings.TrimSpace(now.Version) + " was made with uncommitted changes, so its stamp does not prove the installed plugin is this code"
	}
	haveVer, nowVer := strings.TrimSpace(have.Version), strings.TrimSpace(now.Version)
	if haveVer == nowVer && have.Built == "" {
		// A stamp of this very version from before #249 carries no build time, and used to be called
		// "same" without looking at anything else. That is right for a release tag (the numbers name
		// its content) and for a local build whose tail names this commit, but wrong for a dirty
		// rebuild: `git describe` does not change with uncommitted changes, so it writes the same
		// string while carrying plugin code the install does not have — the plugin silently stayed
		// old, with not one log line (#274 第三条). Unproven now falls through to stampUnknown.
		hc := commitFromVersionTail(haveVer)
		switch {
		case nowDirty:
			return stampUnknown, "the installed " + haveVer + " cannot be compared: this build was made with uncommitted changes"
		case !semverRe.MatchString(haveVer) && hc == "" && now.Commit != "":
			return stampUnknown, "the installed " + haveVer + " has no commit or build time, so this build cannot be proven newer"
		case hc == "" || now.Commit == "" || sameCommit(hc, now.Commit):
			return stampSame, ""
		}
	}
	if semverRe.MatchString(haveVer) && semverRe.MatchString(nowVer) {
		hv, nv := parseSemver(haveVer), parseSemver(nowVer)
		hn := []int{hv.major, hv.minor, hv.patch}
		nn := []int{nv.major, nv.minor, nv.patch}
		switch d := slices.Compare(nn, hn); {
		case d > 0:
			return stampNewer, "release " + nowVer + " is newer than the installed " + haveVer
		case d < 0:
			return stampOlder, "release " + nowVer + " is older than the installed " + haveVer
		}
	}
	// A stamp from before #249 carries no build time, but a local build's version tail still names
	// its commit (`v0.1.54-local211-final-8ac35a3b`, `v0.1.54-3-gabc1234`). Same commit is the same
	// plugin code, so that install is current and needs neither a refresh nor a warning (#265 P1).
	//
	// This used to say "same" for any equal version string without a build time, before looking at
	// the commit at all (#274 第三条). A dirty rebuild of the same commit carries the same version
	// string, so that install was silently kept and its new plugin code never reached the disk, with
	// no log line to explain it. Now "same" needs the commit to be proven; anything else falls to
	// stampUnknown, which keeps the plugin and warns once with the way out.
	if strings.TrimSpace(have.Built) == "" && !nowDirty && strings.TrimSpace(now.Commit) != "" {
		if hc := commitFromVersionTail(haveVer); hc != "" && sameCommit(hc, now.Commit) {
			return stampSame, "the installed " + haveVer + " and this build are the same commit " + hc
		}
	}
	// Built mixes Makefile build wall-clock time with vcs.time (commit time). Neither timestamp
	// proves code ancestry, so only semantic release ordering and an exact clean stamp can decide.
	// For every other pair, preserve the installed plugin instead of guessing from mixed clocks.
	return stampUnknown, "version and commit metadata cannot prove that " + nowVer + " is newer than the installed " + haveVer
}

// commitFromVersionTail returns the commit a local build's version string names, if it names one:
// `v0.1.54-local211-final-8ac35a3b` → 8ac35a3b, `v0.1.54-3-gabc1234` → abc1234 (git describe).
// Empty for `dev`, `v0.1.5` and other tails that are not hex, so only real build tails compare.
func commitFromVersionTail(version string) string {
	i := strings.LastIndexByte(version, '-')
	if i < 0 {
		return ""
	}
	tail := strings.ToLower(strings.TrimPrefix(version[i+1:], "g"))
	if len(tail) < 7 || len(tail) > 40 {
		return ""
	}
	for _, c := range tail {
		if !strings.ContainsRune("0123456789abcdef", c) {
			return ""
		}
	}
	return tail
}

// sameCommit reports whether two commit ids name the same commit. Both sides come from git in
// whatever length it used (`%h` short, full 40), so the shorter one has to be a prefix of the longer.
// The shorter side must also be at least minCommitPrefix long: git never abbreviates below 7 by
// default (`core.abbrev`, 7 since git 2.11), so `8a` or `8ac` is a truncated paste or a hand-typed
// version tail, and as a prefix of a sha1 it matches a few hundred commits — it proves nothing
// (#274). A real short id from `%h`/git-describe is 7 or more.
func sameCommit(a, b string) bool {
	const minCommitPrefix = 7 // git's default core.abbrev, unchanged since git 2.11
	a, b = strings.ToLower(strings.TrimSpace(a)), strings.ToLower(strings.TrimSpace(b))
	if a == "" || b == "" {
		return false
	}
	if len(a) > len(b) {
		a, b = b, a
	}
	if len(a) < minCommitPrefix {
		return false
	}
	return strings.HasPrefix(b, a)
}

// warnedLegacyStamps holds the installs this run has already warned about (#265 P1). The refresh
// runs on every start and before `module add dsh`, and an install that cannot be ordered stays that
// way, so warning each time would repeat the same line all day. Keyed by dir and installed version:
// after the user deletes .version (or a later build does refresh) the key is gone and a fresh
// install warns again.
var warnedLegacyStamps = &sync.Map{}

func warnLegacyStampOnce(dir, installedVersion string) bool {
	_, loaded := warnedLegacyStamps.LoadOrStore(filepath.Clean(dir)+"\x00"+installedVersion, struct{}{})
	return !loaded
}

// parseBuildStamp reads the RFC3339 build time main sets; "unknown" and blank do not parse.
func parseBuildStamp(s string) (time.Time, bool) {
	t, err := time.Parse(time.RFC3339, strings.TrimSpace(s))
	if err != nil {
		return time.Time{}, false
	}
	return t, true
}

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
	// Only unpack over an install that is provably older (#249): before, any different version
	// string counted as an upgrade, so an older binary starting once replaced a newer plugin.
	stamp := filepath.Join(targetDir, dshVersionFile)
	// One read of the build info for both uses: the stamp it fills, and whether the tree was dirty
	// when this binary was built — a dirty build may carry plugin code that no stamp on disk
	// describes, so it only ever withholds "same" (#274 第三条).
	vcs := readBuildVCS()
	now := dshStampFor(version, vcs)
	dirty := vcs.Modified
	have, read := readDSHStamp(stamp)
	if read == stampBroken {
		slog.Warn("dsh refresh: version stamp is unreadable, keeping the installed plugin (delete the stamp to force a refresh)", "dir", targetDir, "running", now)
		return false, nil
	}
	if read == stampFound {
		verdict, why := stampOrder(have, now, dirty)
		switch verdict {
		case stampSame:
			return false, nil
		case stampOlder:
			slog.Info("dsh refresh: keeping the newer installed plugin", "dir", targetDir, "installed", have, "running", now, "why", why)
			return false, nil
		case stampUnknown:
			// Kept, never guessed — but said out loud once per run with the way out, because an
			// install that can never be ordered stays that way for good and silence looks like a
			// working refresh (#265 P1, #274 第三条).
			if !warnLegacyStampOnce(targetDir, have.Version) {
				return false, nil
			}
			switch {
			case dirty:
				slog.Warn("dsh refresh: this build of "+now.Version+" was made with uncommitted changes, so it cannot prove the installed plugin is its own code and the plugin was kept; delete "+stamp+" and restart to force the refresh",
					"dir", targetDir, "installed", have, "running", now, "why", why, "fix", "delete "+stamp+" and restart")
			case strings.TrimSpace(have.Built) == "":
				// An install stamped before #249 has no build time at all, so nothing can ever order a
				// later local build with the same numbers against it (`v0.1.54-local211-final-<sha>`):
				// the install would stay on its old plugin for good (#265 P1).
				slog.Warn("dsh refresh: the installed plugin is stamped "+have.Version+" with no build time (old stamp format, or a build made without the version flags), so this build "+now.Version+" cannot be proven newer and the plugin was kept; delete "+stamp+" and restart to force the refresh",
					"dir", targetDir, "installed", have, "running", now, "why", why, "fix", "delete "+stamp+" and restart")
			default:
				slog.Warn("dsh refresh: cannot prove which version is newer, keeping the installed plugin; delete "+stamp+" and restart to force the refresh",
					"dir", targetDir, "installed", have, "running", now, "why", why, "fix", "delete "+stamp+" and restart")
			}
			return false, nil
		}
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
	// #1044: which pages the old channels UI showed, read before the refresh replaces it.
	pagesBefore, prePages := oldPagesShown(targetDir)
	// #1044: the new page packages first: collab links them (link:../packages/…), so the staged
	// dependency install below needs them in place. Only these: they are new files nothing old
	// uses, so a failed install still leaves the old plugin exactly as it was.
	for _, name := range pagePackages {
		if err := writeEmbeddedTree(sub, targetDir, "packages/"+name); err != nil {
			return false, fmt.Errorf("refresh dsh page packages: %w", err)
		}
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
	if !staged { // the staged copy got them before it was swapped in
		if err := writeHandoffRules(filepath.Join(targetDir, "collab")); err != nil {
			return false, err
		}
	}
	// After the new plugin code is in place, so the old plugin never sees the new rows.
	if prePages {
		if err := upgradeCollabPatch(sub, targetDir, pagesBefore); err != nil {
			return false, err
		}
	}
	migrateCollabPatchHome(filepath.Join(targetDir, "collab", "cordis.patch.yml"))
	_ = os.Chmod(filepath.Join(targetDir, "install.sh"), 0755)
	if err := writeDSHStamp(stamp, now); err != nil {
		return true, err
	}
	return true, nil
}

// pagePackages are the page packages collab links (dsh/packages/bothouse-embeds).
var pagePackages = []string{"bothouse-dsh-desk", "bothouse-dsh-panel", "bothouse-dsh-devices"}

// pagesRowMarker is in every collab bundle patch since the desk, panel and other-computers pages
// became rows of their own (#1044); a patch without it is from before.
const pagesRowMarker = "id: bothouse-desk"

// oldPagesShown reports whether the installed collab patch is from before #1044 and, if so, which
// page rows its channels UI put in the sidebar (all came with that one package then).
func oldPagesShown(targetDir string) (rows []string, pre bool) {
	patch, err := os.ReadFile(filepath.Join(targetDir, "collab", "cordis.patch.yml"))
	if err != nil || bytes.Contains(patch, []byte(pagesRowMarker)) {
		return nil, false
	}
	client, _ := os.ReadFile(filepath.Join(targetDir, "packages", "client-ui-discord", "lib", "client.js"))
	rows = []string{}
	for _, p := range []struct{ panel, row string }{
		{"collab-desk", "bothouse-desk"}, {"bothouse-panel", "bothouse-panel"}, {"collab-devices", "bothouse-devices"},
	} {
		if bytes.Contains(client, []byte(`"`+p.panel+`"`)) {
			rows = append(rows, p.row)
		}
	}
	return rows, true
}

// pagesBeforeFile is read once by the collab plugin (dsh/collab/pages-migrate.mjs).
const pagesBeforeFile = "pages-before-1044.json"

// upgradeCollabPatch replaces a collab/cordis.patch.yml from before #1044 (which keepIfExists would
// otherwise keep for good) with the embedded one, keeping the old file beside it, and notes for the
// collab plugin which pages the old UI showed: it switches exactly those on, once, so the sidebar
// stays as it was.
func upgradeCollabPatch(sub fs.FS, targetDir string, pagesBefore []string) error {
	path := filepath.Join(targetDir, "collab", "cordis.patch.yml")
	old, err := os.ReadFile(path)
	if err != nil {
		return nil // not there: the refresh writes the embedded one
	}
	data, err := fs.ReadFile(sub, "collab/cordis.patch.yml")
	if err != nil {
		return err
	}
	note, _ := json.Marshal(map[string][]string{"rows": pagesBefore})
	if err := os.MkdirAll(collabDataDir(), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(collabDataDir(), pagesBeforeFile), note, 0o644); err != nil {
		return fmt.Errorf("note the pages the old version showed: %w", err)
	}
	if err := os.WriteFile(path+".bak-pre1044", old, 0o644); err != nil {
		return fmt.Errorf("keep old collab patch: %w", err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return fmt.Errorf("upgrade collab patch: %w", err)
	}
	slog.Info("dsh refresh: collab patch now lists each page as its own row", "path", path, "pages_before", pagesBefore)
	return nil
}

// writeEmbeddedTree writes one top-level directory of the embedded bundle into targetDir.
func writeEmbeddedTree(sub fs.FS, targetDir, dir string) error {
	return fs.WalkDir(sub, dir, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		dest := filepath.Join(targetDir, path)
		if d.IsDir() {
			return os.MkdirAll(dest, 0o755)
		}
		data, err := fs.ReadFile(sub, path)
		if err != nil {
			return err
		}
		return os.WriteFile(dest, data, 0o644)
	})
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
	if err := writeHandoffRules(stage); err != nil {
		return err
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
	// pnpm on Windows links packages with directory junctions, which hold absolute paths: after
	// the rename they still lead into the staging directory, which no longer exists, and the
	// plugin cannot load its dependencies (reported 11-05: channels stay disabled after an
	// upgrade). Unix pnpm writes relative symlinks, which the rename keeps valid.
	if n, err := relinkMovedTree(filepath.Join(live, "node_modules"), stage, live); err != nil {
		if rerr := os.Rename(live, stage); rerr == nil {
			if rerr = os.Rename(prev, live); rerr != nil {
				slog.Error("dsh refresh: could not put the old plugin back", "error", rerr)
			}
		}
		return fmt.Errorf("repoint dependency links after the swap: %w", err)
	} else if n > 0 {
		slog.Info("dsh refresh: repointed dependency links", "count", n)
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

// relinkMovedTree repoints every link under root whose target lies inside from (a directory that
// was renamed to to) at the same place under to, and returns how many it changed. Links are not
// followed; relative links and links elsewhere are left alone.
func relinkMovedTree(root, from, to string) (int, error) {
	n := 0
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			if os.IsNotExist(walkErr) && p == root {
				return fs.SkipDir
			}
			return walkErr
		}
		// Windows junctions show up as ModeIrregular (Go ≥1.23) or ModeSymlink; neither is walked into.
		if p == root || d.Type()&(fs.ModeSymlink|fs.ModeIrregular) == 0 {
			return nil
		}
		target, err := os.Readlink(p)
		if err != nil {
			return nil // a reparse point that is not a link
		}
		rest, ok := pathWithin(target, from)
		if !ok {
			return nil
		}
		if err := os.Remove(p); err != nil { // removes the link, not what it points to
			return fmt.Errorf("remove stale link %s: %w", p, err)
		}
		if err := linkDir(filepath.Join(to, rest), p); err != nil {
			return fmt.Errorf("relink %s: %w", p, err)
		}
		n++
		return nil
	})
	return n, err
}

// pathWithin reports whether p is dir or below it (case-insensitively on Windows) and returns
// the remainder relative to dir.
func pathWithin(p, dir string) (string, bool) {
	if !filepath.IsAbs(p) {
		return "", false
	}
	p, dir = filepath.Clean(p), filepath.Clean(dir)
	eq := func(a, b string) bool { return a == b }
	if runtime.GOOS == "windows" {
		eq = strings.EqualFold
	}
	if eq(p, dir) {
		return ".", true
	}
	sep := string(filepath.Separator)
	if len(p) > len(dir) && eq(p[:len(dir)], dir) && p[len(dir):len(dir)+1] == sep {
		return p[len(dir)+1:], true
	}
	return "", false
}

// collabPatchHomeFixes rewrite the $HOME-based paths that cordis.patch.yml shipped with up to
// v0.1.48: Windows has no HOME, so 'undefined/.conest-collab' kept the collab plugin from loading
// whenever dsh was started outside bothouse (which passes HOME itself, see openDSHWeb). The file is
// kept across upgrades (keepIfExists), so only these exact old expressions are replaced; any other
// edit the user made stays as it is.
var collabPatchHomeFixes = []struct{ old, new string }{
	{"(process.env.HOME + '/.conest-collab')", "process.getBuiltinModule('node:path').join(process.getBuiltinModule('node:os').homedir(), '.conest-collab')"},
	{"(process.env.HOME + '/.bothouse')", "process.getBuiltinModule('node:path').join(process.getBuiltinModule('node:os').homedir(), '.bothouse')"},
}

func migrateCollabPatchHome(path string) {
	b, err := os.ReadFile(path)
	if err != nil {
		return
	}
	s := string(b)
	for _, f := range collabPatchHomeFixes {
		s = strings.ReplaceAll(s, f.old, f.new)
	}
	if s != string(b) {
		if err := os.WriteFile(path, []byte(s), 0o644); err != nil {
			slog.Warn("dsh refresh: could not update cordis.patch.yml", "path", path, "err", err)
		}
	}
}
