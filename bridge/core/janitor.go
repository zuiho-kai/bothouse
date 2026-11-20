package core

// Janitor: the bridge clears what its own tools leave behind, and says so when the disk runs low
// (#1825, user 2026-11-20 「bothouse自动清理垃圾之类的机制是没完善没」→「搞一个」). Before this only
// sessions were pruned; bgrun run dirs, iso-check test dirs (/tmp/iso.*), walkthrough runs
// (roles/*/notes/runs) and workspace work dirs piled up until the 1 TB disk had 24 GB left and
// commands stopped running.
//
// What it removes: direct children of the cleaned places that nothing touched for StaleAfter.
// What it never removes:
//   - a child named, by full path or by its name, in an open task board row (doing, paused,
//     backlog) or in a file such a row points at (the handoff), or in a skill (SKILL.md);
//   - a git repository (a .git directory anywhere inside), and a git worktree with uncommitted
//     changes or with a HEAD that no remote branch contains;
//   - symlinks, and anything outside the cleaned places.
// Every run that removes something appends what went and what was kept to <data>/cleanup/<YYYY-MM>.log.

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/chenhg5/cc-connect/core/team"
)

// JanitorDefaultStaleDays: 沿用 11-20 手动清理脚本（notes/cleanup-1120/clean.sh）「7 天没动的旧目录删掉」。
const JanitorDefaultStaleDays = 7

// janitorLowFreePct: 沿用 doctor.go 磁盘检查「用了 85% 以上报 Warn」，即剩余不到 15% 算低。
const janitorLowFreePct = 15

type JanitorOptions struct {
	DataDir    string
	Dirs       []string // [cleanup] dirs: more places whose stale children go
	BoardDirs  []string // team status dirs holding board.jsonl
	SkillDirs  []string // dirs of <name>/SKILL.md; nil = the usual ones under $HOME
	TmpDir     string   // where iso-check makes iso.*; "" = /tmp
	StaleAfter time.Duration
	Lang       string // "zh" or other
	// Notify sends the low-space notice to the owner; nil = log only.
	Notify func(text string) error
	Now    func() time.Time
	// FreeSpace reports free and total bytes of the disk holding path; nil = the real one.
	FreeSpace func(path string) (free, total uint64, err error)
}

type JanitorEntry struct {
	Path   string
	Bytes  int64
	Reason string
}

type JanitorResult struct {
	Removed []JanitorEntry
	Kept    []JanitorEntry // old but kept, with why
	Freed   int64
	Errors  []string
}

type Janitor struct {
	o  JanitorOptions
	mu sync.Mutex // one run at a time
}

func NewJanitor(o JanitorOptions) *Janitor {
	if o.StaleAfter <= 0 {
		o.StaleAfter = JanitorDefaultStaleDays * 24 * time.Hour
	}
	if o.Now == nil {
		o.Now = time.Now
	}
	if o.FreeSpace == nil {
		o.FreeSpace = diskFreeSpace
	}
	if o.TmpDir == "" {
		o.TmpDir = "/tmp" // iso-check: mktemp -d /tmp/iso.XXXX
	}
	return &Janitor{o: o}
}

// janitorPlace is one cleaned place: its children are the candidates; prefix limits them by name.
type janitorPlace struct {
	dir    string
	prefix string
}

func (j *Janitor) places() []janitorPlace {
	var out []janitorPlace
	seen := map[string]bool{}
	add := func(dir, prefix string) {
		dir = filepath.Clean(team.ExpandHome(strings.TrimSpace(dir)))
		if !filepath.IsAbs(dir) || janitorUnsafeRoot(dir, j.o.DataDir) {
			return
		}
		k := dir + "\x00" + prefix
		if seen[k] {
			return
		}
		seen[k] = true
		out = append(out, janitorPlace{dir, prefix})
	}
	if j.o.DataDir != "" {
		add(filepath.Join(j.o.DataDir, "runs"), "") // bgrun
		roles, _ := filepath.Glob(filepath.Join(j.o.DataDir, "roles", "*", "notes", "runs"))
		for _, r := range roles { // walkthrough runs
			add(r, "")
		}
	}
	add(j.o.TmpDir, "iso.") // iso-check before
	for _, d := range j.o.Dirs {
		add(d, "")
	}
	return out
}

// janitorUnsafeRoot: places never cleaned as a whole — home, the data dir itself, the filesystem root.
func janitorUnsafeRoot(dir, dataDir string) bool {
	if filepath.Dir(dir) == dir {
		return true
	}
	if home, err := os.UserHomeDir(); err == nil && filepath.Clean(home) == dir {
		return true
	}
	return dataDir != "" && filepath.Clean(dataDir) == dir
}

// Run removes old children (dry = only report). Safe to call from several goroutines.
func (j *Janitor) Run(dry bool) JanitorResult {
	j.mu.Lock()
	defer j.mu.Unlock()
	var res JanitorResult
	refs := j.references()
	cut := j.o.Now().Add(-j.o.StaleAfter)
	days := int(j.o.StaleAfter.Hours() / 24)
	repos := map[string]bool{}
	for _, pl := range j.places() {
		ents, err := os.ReadDir(pl.dir)
		if err != nil {
			continue
		}
		for _, e := range ents {
			name := e.Name()
			if pl.prefix != "" && !strings.HasPrefix(name, pl.prefix) {
				continue
			}
			if e.Type()&fs.ModeSymlink != 0 || !e.IsDir() {
				continue
			}
			p := filepath.Join(pl.dir, name)
			if st, err := os.Lstat(filepath.Join(p, ".git")); err == nil && st.IsDir() {
				continue // a repository is never ours to remove; not walked either
			}
			sc := scanJanitorDir(p, cut)
			if sc.fresh {
				continue
			}
			ent := JanitorEntry{Path: p, Bytes: sc.bytes}
			keep := refs.holds(p)
			if keep == "" && sc.nestedRepo {
				keep = j.say("里面有 git 仓库", "holds a git repository")
			}
			repo := ""
			if keep == "" && sc.gitFile {
				repo, keep = j.worktreeKeep(p)
			}
			if keep != "" {
				ent.Reason = keep
				res.Kept = append(res.Kept, ent)
				continue
			}
			ent.Reason = j.say(fmt.Sprintf("%d 天没动", days), fmt.Sprintf("untouched for %d days", days))
			if !dry {
				if err := os.RemoveAll(p); err != nil {
					res.Errors = append(res.Errors, fmt.Sprintf("%s: %v", p, err))
					continue
				}
				if repo != "" {
					repos[repo] = true
				}
				if pl.prefix != "" {
					j.dropIsoState(name)
				}
			}
			res.Removed = append(res.Removed, ent)
			res.Freed += ent.Bytes
		}
	}
	for r := range repos {
		_ = exec.Command("git", "-C", r, "worktree", "prune").Run()
	}
	if !dry {
		j.record(res)
	}
	return res
}

type janitorScan struct {
	fresh      bool
	bytes      int64
	gitFile    bool // <dir>/.git is a file: a worktree
	nestedRepo bool // a .git deeper inside
}

// scanJanitorDir walks dir once: newest change against cut, size, and where .git entries are.
// It stops at the first entry changed after cut — a fresh dir is not looked at further.
func scanJanitorDir(dir string, cut time.Time) janitorScan {
	var s janitorScan
	errFresh := fmt.Errorf("fresh")
	_ = filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		info, ierr := d.Info()
		if ierr != nil {
			return nil
		}
		if info.ModTime().After(cut) {
			s.fresh = true
			return errFresh
		}
		if d.Name() == ".git" && p != dir {
			if filepath.Dir(p) != dir {
				s.nestedRepo = true
			} else {
				s.gitFile = true
			}
		}
		if info.Mode().IsRegular() {
			s.bytes += info.Size()
		}
		return nil
	})
	return s
}

// worktreeKeep: a worktree goes only when it is clean and its HEAD is on a remote branch, so no
// work is lost. Returns the main repository (for worktree prune) and why to keep it, if so.
func (j *Janitor) worktreeKeep(dir string) (repo, why string) {
	if b, err := os.ReadFile(filepath.Join(dir, ".git")); err == nil {
		if g, ok := strings.CutPrefix(strings.TrimSpace(string(b)), "gitdir:"); ok {
			// <repo>/.git/worktrees/<name>
			repo = filepath.Dir(filepath.Dir(filepath.Dir(strings.TrimSpace(g))))
		}
	}
	out, err := exec.Command("git", "-C", dir, "status", "--porcelain").Output()
	if err != nil {
		if repo != "" {
			if _, serr := os.Stat(repo); serr == nil {
				return repo, j.say("git 读不了这个工作副本", "git cannot read this worktree")
			}
		}
		return "", "" // its repository is gone: git keeps nothing more of it
	}
	if strings.TrimSpace(string(out)) != "" {
		return repo, j.say("有没提交的改动", "has uncommitted changes")
	}
	out, err = exec.Command("git", "-C", dir, "branch", "-r", "--contains", "HEAD").Output()
	if err != nil || strings.TrimSpace(string(out)) == "" {
		return repo, j.say("有没推上去的提交", "has commits not pushed")
	}
	return repo, ""
}

// dropIsoState removes iso-check's records of a deleted iso dir (<state>/<session>/<name>.*).
func (j *Janitor) dropIsoState(name string) {
	st := os.Getenv("ISO_CHECK_STATE")
	if st == "" {
		st = filepath.Join(j.o.TmpDir, "iso-check.d")
	}
	m, _ := filepath.Glob(filepath.Join(st, "*", name+".*"))
	for _, p := range m {
		_ = os.Remove(p)
	}
}

// janitorRefs: text of open board rows (with the files they point at), and of the skills.
type janitorRefs struct {
	board  []janitorRefText
	skills string
}

type janitorRefText struct {
	id   int
	text string
}

func (j *Janitor) references() janitorRefs {
	var r janitorRefs
	for _, d := range j.o.BoardDirs {
		b, err := os.ReadFile(filepath.Join(team.ExpandHome(d), team.TaskBoardFile))
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(b), "\n") {
			var it teamTaskBoardItem
			if json.Unmarshal([]byte(line), &it) != nil {
				continue
			}
			text := line
			for _, p := range janitorPathsIn(it.Where + " " + it.What + " " + it.Next + " " + it.PauseWhy) {
				if st, err := os.Stat(p); err == nil && st.Mode().IsRegular() {
					if fb, err := os.ReadFile(p); err == nil {
						text += "\n" + string(fb)
					}
				}
			}
			r.board = append(r.board, janitorRefText{it.ID, text})
		}
	}
	skillDirs := j.o.SkillDirs
	if skillDirs == nil {
		if home, err := os.UserHomeDir(); err == nil {
			skillDirs = []string{
				filepath.Join(home, ".claude", "skills"),
				filepath.Join(home, ".agents", "skills"),
				filepath.Join(home, ".codex", "skills"),
			}
		}
	}
	var sb strings.Builder
	for _, d := range skillDirs {
		m, _ := filepath.Glob(filepath.Join(d, "*", "SKILL.md"))
		for _, p := range m {
			if b, err := os.ReadFile(p); err == nil {
				sb.Write(b)
				sb.WriteByte('\n')
			}
		}
	}
	r.skills = sb.String()
	return r
}

// janitorPathsIn picks absolute and ~/ paths out of free text (board rows separate fields with ｜).
func janitorPathsIn(s string) []string {
	var out []string
	for _, tok := range strings.FieldsFunc(s, func(r rune) bool {
		return strings.ContainsRune(" \t\n｜|，（）`", r)
	}) {
		if strings.HasPrefix(tok, "/") || strings.HasPrefix(tok, "~/") {
			out = append(out, team.ExpandHome(tok))
		}
	}
	return out
}

// holds says why p must stay, or "" when nothing names it: its full path, its ~/ path, or its
// name anywhere in the text. A short name may match by chance; that only keeps more.
func (r janitorRefs) holds(p string) string {
	keys := []string{p, filepath.Base(p)}
	if home, err := os.UserHomeDir(); err == nil {
		if rel, ok := strings.CutPrefix(p, home+string(filepath.Separator)); ok {
			keys = append(keys, "~/"+filepath.ToSlash(rel))
		}
	}
	for _, b := range r.board {
		for _, k := range keys {
			if strings.Contains(b.text, k) {
				return fmt.Sprintf("任务板 #%d 还在用", b.id)
			}
		}
	}
	for _, k := range keys {
		if strings.Contains(r.skills, k) {
			return "skill 里点名的目录"
		}
	}
	return ""
}

func (j *Janitor) say(zh, en string) string {
	if j.o.Lang == "zh" {
		return zh
	}
	return en
}

// RecordDir is where the cleanup records go.
func (j *Janitor) RecordDir() string { return filepath.Join(j.o.DataDir, "cleanup") }

func (j *Janitor) record(res JanitorResult) {
	if j.o.DataDir == "" || (len(res.Removed) == 0 && len(res.Errors) == 0) {
		return
	}
	if err := os.MkdirAll(j.RecordDir(), 0o755); err != nil {
		return
	}
	now := j.o.Now()
	f, err := os.OpenFile(filepath.Join(j.RecordDir(), now.Format("2006-01")+".log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	_, _ = f.WriteString(j.FormatResult(res, now, false))
}

// FormatResult is the record text of one run (also what `bothouse cleanup` prints).
func (j *Janitor) FormatResult(res JanitorResult, now time.Time, dry bool) string {
	var b strings.Builder
	free := ""
	if fr, _, err := j.o.FreeSpace(j.o.DataDir); err == nil {
		free = j.say("，硬盘还剩 "+janitorSize(int64(fr)), ", "+janitorSize(int64(fr))+" free")
	}
	head := j.say(fmt.Sprintf("自动清理：删了 %d 个，腾出 %s", len(res.Removed), janitorSize(res.Freed)),
		fmt.Sprintf("cleanup: removed %d, freed %s", len(res.Removed), janitorSize(res.Freed)))
	if dry {
		head = j.say(fmt.Sprintf("试跑（没删）：会删 %d 个，能腾出 %s", len(res.Removed), janitorSize(res.Freed)),
			fmt.Sprintf("dry run (nothing removed): would remove %d, freeing %s", len(res.Removed), janitorSize(res.Freed)))
	}
	fmt.Fprintf(&b, "%s %s%s\n", now.Format("2006-01-02 15:04"), head, free)
	for _, e := range res.Removed {
		fmt.Fprintf(&b, "  %s\t%s\t%s\n", j.say("删", "removed"), janitorSize(e.Bytes), e.Path)
	}
	for _, e := range res.Kept {
		fmt.Fprintf(&b, "  %s\t%s\t%s（%s）\n", j.say("留", "kept"), janitorSize(e.Bytes), e.Path, e.Reason)
	}
	for _, e := range res.Errors {
		fmt.Fprintf(&b, "  %s\t%s\n", j.say("删不掉", "failed"), e)
	}
	return b.String()
}

func janitorSize(n int64) string { // GB 写法：用户看的提醒里不写 GiB
	const gb, mb, kb = 1 << 30, 1 << 20, 1 << 10
	switch {
	case n >= gb:
		return fmt.Sprintf("%.1f GB", float64(n)/gb)
	case n >= mb:
		return fmt.Sprintf("%.0f MB", float64(n)/mb)
	default:
		return fmt.Sprintf("%d KB", n/kb)
	}
}

// LowSpace reports whether the disk holding the data dir is below the line, with its numbers.
func (j *Janitor) LowSpace() (low bool, free, total uint64) {
	free, total, err := j.o.FreeSpace(j.o.DataDir)
	if err != nil || total == 0 {
		return false, 0, 0
	}
	return free < total/100*janitorLowFreePct, free, total
}

// janitorState: when the last clean ran and whether the owner was already told the disk is low,
// so a restart repeats neither.
type janitorState struct {
	LastRun time.Time `json:"last_run"`
	LowTold bool      `json:"low_told"`
}

func (j *Janitor) loadState() janitorState {
	var s janitorState
	if b, err := os.ReadFile(filepath.Join(j.RecordDir(), "state.json")); err == nil {
		_ = json.Unmarshal(b, &s)
	}
	return s
}

func (j *Janitor) saveState(s janitorState) {
	_ = os.MkdirAll(j.RecordDir(), 0o755)
	b, _ := json.Marshal(s)
	_ = os.WriteFile(filepath.Join(j.RecordDir(), "state.json"), b, 0o644)
}

// Tick is one check: clean (it is cheap when nothing is old), and when the disk is low tell the
// owner once — again only after it was back above the line.
func (j *Janitor) Tick() {
	now := j.o.Now()
	st := j.loadState()
	low, before, total := j.LowSpace()
	res := j.Run(false)
	st.LastRun = now
	if len(res.Removed) > 0 {
		slog.Info("janitor: cleaned", "removed", len(res.Removed), "freed", janitorSize(res.Freed), "kept", len(res.Kept))
	}
	switch {
	case !low:
		st.LowTold = false
	case !st.LowTold:
		_, after, _ := j.LowSpace()
		if after == 0 {
			after = before
		}
		slog.Warn("janitor: disk space low", "free_before", janitorSize(int64(before)), "free_after", janitorSize(int64(after)))
		if j.o.Notify != nil {
			if err := j.o.Notify(j.LowSpaceText(before, after, total, res)); err != nil {
				slog.Warn("janitor: low-space notice not sent", "error", err)
			} else {
				st.LowTold = true
			}
		}
	}
	j.saveState(st)
}

// LowSpaceText is what the owner reads: plain numbers, what was done, what to do next; no paths.
func (j *Janitor) LowSpaceText(before, after, total uint64, res JanitorResult) string {
	pct := func(n uint64) uint64 { return n * 100 / total }
	did := j.say("没找到能放心删的旧东西", "found nothing old that is safe to delete")
	if len(res.Removed) > 0 {
		did = j.say(fmt.Sprintf("把一周没动的旧工作目录和测试临时文件清掉了 %d 个，腾出 %s", len(res.Removed), janitorSize(res.Freed)),
			fmt.Sprintf("removed %d work and test folders nobody touched for a week, freeing %s", len(res.Removed), janitorSize(res.Freed)))
	}
	if after >= total/100*janitorLowFreePct {
		return j.say(
			fmt.Sprintf("硬盘刚才只剩 %s（%d%%）。我%s，现在剩 %s，不用管。",
				janitorSize(int64(before)), pct(before), did, janitorSize(int64(after))),
			fmt.Sprintf("The disk was down to %s free (%d%%). I %s; %s free now, nothing to do.",
				janitorSize(int64(before)), pct(before), did, janitorSize(int64(after))))
	}
	return j.say(
		fmt.Sprintf("硬盘快满了：只剩 %s（%d%%），满了以后我和队友的命令都会跑不起来。我%s，还不够。回我一句「看看哪里占地方」，我把最大的几个目录列给你挑着删。",
			janitorSize(int64(after)), pct(after), did),
		fmt.Sprintf("The disk is nearly full: %s free (%d%%). Once it is full, commands stop working. I %s, which is not enough. Reply \"show me what takes the space\" and I will list the biggest folders for you to pick from.",
			janitorSize(int64(after)), pct(after), did))
}

// Start runs Tick now and then once an hour (沿用团队整点节奏 skills/hourly-rhythm.md) until stop closes.
func (j *Janitor) Start(stop <-chan struct{}) {
	go func() {
		j.Tick()
		t := time.NewTicker(time.Hour)
		defer t.Stop()
		for {
			select {
			case <-stop:
				return
			case <-t.C:
				j.Tick()
			}
		}
	}()
}
