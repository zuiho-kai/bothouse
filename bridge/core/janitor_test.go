package core

import (
	"errors"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// age sets every entry under p (and p) to t, deepest first so parents keep the old time.
func janitorAge(t *testing.T, p string, at time.Time) {
	t.Helper()
	var all []string
	_ = filepath.WalkDir(p, func(q string, d fs.DirEntry, err error) error {
		all = append(all, q)
		return nil
	})
	for i := len(all) - 1; i >= 0; i-- {
		if err := os.Chtimes(all[i], at, at); err != nil {
			t.Fatal(err)
		}
	}
}

func janitorMk(t *testing.T, dir string, files ...string) string {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, f := range files {
		p := filepath.Join(dir, f)
		_ = os.MkdirAll(filepath.Dir(p), 0o755)
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func TestJanitorRemovesOldKeepsReferencedAndFresh(t *testing.T) {
	root := t.TempDir()
	data := filepath.Join(root, "data")
	work := filepath.Join(root, "work")
	tmp := filepath.Join(root, "tmp")
	board := filepath.Join(root, "team")
	skills := filepath.Join(root, "skills")
	now := time.Now()
	old := now.Add(-10 * 24 * time.Hour)

	oldRun := janitorMk(t, filepath.Join(data, "runs", "1101-old-1"), "log", "exit")
	newRun := janitorMk(t, filepath.Join(data, "runs", "1120-new-1"), "log")
	oldWalk := janitorMk(t, filepath.Join(data, "roles", "maomao", "notes", "runs", "1700"), "shot.png")
	oldWork := janitorMk(t, filepath.Join(work, "mv-old-project"), "a/b.mp4")
	paused := janitorMk(t, filepath.Join(work, "paused-task-dir"), "x.txt")     // named in the handoff of a paused row
	direct := janitorMk(t, filepath.Join(work, "direct-in-row"), "x.txt")       // named in the row itself
	skilled := janitorMk(t, filepath.Join(work, "skill-named-dir"), "x.txt")    // named in a SKILL.md
	repo := janitorMk(t, filepath.Join(work, "some-repo"), ".git/HEAD", "a")    // a repository
	nested := janitorMk(t, filepath.Join(work, "has-clone"), "clone/.git/HEAD") // a clone inside
	fresh := janitorMk(t, filepath.Join(work, "half-fresh"), "old.txt")
	isoOld := janitorMk(t, filepath.Join(tmp, "iso.AAAA"), "home/x")
	isoNew := janitorMk(t, filepath.Join(tmp, "iso.BBBB"), "home/x")
	other := janitorMk(t, filepath.Join(tmp, "not-ours"), "x")
	isoState := janitorMk(t, filepath.Join(tmp, "iso-check.d", "discord:1"), "iso.AAAA.owner", "iso.AAAA.before")

	handoff := filepath.Join(root, "notes", "handoff.md")
	janitorMk(t, filepath.Dir(handoff))
	if err := os.WriteFile(handoff, []byte("工作目录在 "+paused+" 里\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	janitorMk(t, board)
	rows := `{"id":1775,"what":"盘前判断","status":"暂停","where":"` + handoff + `","paused":"11-20"}
{"id":1825,"what":"改 direct-in-row 那个","status":"在做"}
`
	if err := os.WriteFile(filepath.Join(board, "board.jsonl"), []byte(rows), 0o644); err != nil {
		t.Fatal(err)
	}
	janitorMk(t, filepath.Join(skills, "mv"))
	if err := os.WriteFile(filepath.Join(skills, "mv", "SKILL.md"), []byte("工程在 ~/work/skill-named-dir"), 0o644); err != nil {
		t.Fatal(err)
	}

	for _, p := range []string{oldRun, oldWalk, oldWork, paused, direct, skilled, repo, nested, fresh, isoOld, other} {
		janitorAge(t, p, old)
	}
	// half-fresh: one file touched yesterday keeps the whole dir
	_ = os.WriteFile(filepath.Join(fresh, "new.txt"), []byte("y"), 0o644)
	janitorAge(t, fresh, old)
	_ = os.Chtimes(filepath.Join(fresh, "new.txt"), now.Add(-24*time.Hour), now.Add(-24*time.Hour))

	t.Setenv("HOME", root) // ~/work/skill-named-dir in the skill resolves under root
	t.Setenv("ISO_CHECK_STATE", "")
	j := NewJanitor(JanitorOptions{
		DataDir: data, Dirs: []string{work}, BoardDirs: []string{board}, SkillDirs: []string{skills},
		TmpDir: tmp, Lang: "zh",
		FreeSpace: func(string) (uint64, uint64, error) { return 500 << 30, 1000 << 30, nil },
	})

	dry := j.Run(true)
	if len(dry.Removed) != 4 {
		t.Fatalf("dry run: want 4 to remove, got %+v", dry.Removed)
	}
	if _, err := os.Stat(oldRun); err != nil {
		t.Fatal("dry run removed something")
	}

	res := j.Run(false)
	gone := []string{oldRun, oldWalk, oldWork, isoOld}
	for _, p := range gone {
		if _, err := os.Stat(p); !errors.Is(err, os.ErrNotExist) {
			t.Errorf("%s should be removed", p)
		}
	}
	for _, p := range []string{newRun, paused, direct, skilled, repo, nested, fresh, isoNew, other} {
		if _, err := os.Stat(p); err != nil {
			t.Errorf("%s should stay: %v", p, err)
		}
	}
	if _, err := os.Stat(filepath.Join(isoState, "iso.AAAA.owner")); !errors.Is(err, os.ErrNotExist) {
		t.Error("iso-check records of the removed dir should go too")
	}
	why := map[string]string{}
	for _, k := range res.Kept {
		why[k.Path] = k.Reason
	}
	if why[paused] != "任务板 #1775 还在用" || why[direct] != "任务板 #1825 还在用" {
		t.Errorf("board protection reasons: %q / %q", why[paused], why[direct])
	}
	if why[skilled] != "skill 里点名的目录" || why[nested] != "里面有 git 仓库" {
		t.Errorf("skill / nested repo reasons: %q / %q", why[skilled], why[nested])
	}
	if _, ok := why[repo]; ok {
		t.Error("a repository is skipped without being listed")
	}
	recs, _ := filepath.Glob(filepath.Join(data, "cleanup", "*.log"))
	if len(recs) != 1 {
		t.Fatalf("want one record file, got %v", recs)
	}
	b, _ := os.ReadFile(recs[0])
	if !strings.Contains(string(b), "自动清理：删了 4 个") || !strings.Contains(string(b), oldWork) ||
		!strings.Contains(string(b), "任务板 #1775 还在用") {
		t.Errorf("record:\n%s", b)
	}
}

func TestJanitorWorktreeKeptWhenWorkWouldBeLost(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("no git")
	}
	root := t.TempDir()
	git := func(dir string, args ...string) {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
		cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v %s", args, err, out)
		}
	}
	origin := filepath.Join(root, "origin.git")
	main := filepath.Join(root, "main")
	work := filepath.Join(root, "work")
	_ = os.MkdirAll(work, 0o755)
	git(root, "init", "-q", "--bare", origin)
	git(root, "init", "-q", main)
	_ = os.WriteFile(filepath.Join(main, "a"), []byte("a"), 0o644)
	git(main, "add", "a")
	git(main, "commit", "-qm", "a")
	git(main, "remote", "add", "origin", origin)
	git(main, "push", "-q", "origin", "HEAD:refs/heads/develop")
	git(main, "fetch", "-q", "origin")
	pushed := filepath.Join(work, "wt-pushed")
	dirty := filepath.Join(work, "wt-dirty")
	ahead := filepath.Join(work, "wt-ahead")
	git(main, "worktree", "add", "-q", "-b", "p", pushed, "origin/develop")
	git(main, "worktree", "add", "-q", "-b", "d", dirty, "origin/develop")
	git(main, "worktree", "add", "-q", "-b", "h", ahead, "origin/develop")
	_ = os.WriteFile(filepath.Join(dirty, "a"), []byte("changed"), 0o644)
	_ = os.WriteFile(filepath.Join(ahead, "b"), []byte("b"), 0o644)
	git(ahead, "add", "b")
	git(ahead, "commit", "-qm", "b")
	old := time.Now().Add(-10 * 24 * time.Hour)
	for _, p := range []string{pushed, dirty, ahead} {
		janitorAge(t, p, old)
	}
	t.Setenv("HOME", root)
	j := NewJanitor(JanitorOptions{DataDir: filepath.Join(root, "data"), Dirs: []string{work}, SkillDirs: []string{},
		TmpDir: filepath.Join(root, "tmp"), Lang: "zh",
		FreeSpace: func(string) (uint64, uint64, error) { return 500 << 30, 1000 << 30, nil }})
	res := j.Run(false)
	if _, err := os.Stat(pushed); !errors.Is(err, os.ErrNotExist) {
		t.Error("a clean, pushed worktree should go")
	}
	why := map[string]string{}
	for _, k := range res.Kept {
		why[k.Path] = k.Reason
	}
	if why[dirty] != "有没提交的改动" || why[ahead] != "有没推上去的提交" {
		t.Errorf("reasons: dirty %q, ahead %q", why[dirty], why[ahead])
	}
	out, _ := exec.Command("git", "-C", main, "worktree", "list").Output()
	if strings.Contains(string(out), "wt-pushed") {
		t.Errorf("worktree prune should drop the removed worktree:\n%s", out)
	}
}

func TestJanitorLowSpaceNoticeOncePerEpisode(t *testing.T) {
	root := t.TempDir()
	data := filepath.Join(root, "data")
	free := uint64(24 << 30)
	const total = 926 << 30
	var sent []string
	j := NewJanitor(JanitorOptions{DataDir: data, TmpDir: filepath.Join(root, "tmp"), SkillDirs: []string{}, Lang: "zh",
		FreeSpace: func(string) (uint64, uint64, error) { return free, total, nil },
		Notify:    func(s string) error { sent = append(sent, s); return nil }})
	j.Tick()
	j.Tick() // still low: told already
	if len(sent) != 1 {
		t.Fatalf("want one notice, got %d: %q", len(sent), sent)
	}
	if !strings.Contains(sent[0], "硬盘快满了：只剩 24 GB（2%），满了我就干不了活了。一周没动、能放心删的旧东西，我没找到。") || !strings.Contains(sent[0], "看看哪里占地方") ||
		strings.Contains(sent[0], "/") {
		t.Errorf("notice text: %q", sent[0])
	}
	free = 300 << 30
	j.Tick() // back above the line
	free = 20 << 30
	j.Tick() // low again: a new notice
	if len(sent) != 2 {
		t.Fatalf("want a second notice after recovering, got %d", len(sent))
	}
	// a restart remembers it already told
	j2 := NewJanitor(JanitorOptions{DataDir: data, TmpDir: filepath.Join(root, "tmp"), SkillDirs: []string{}, Lang: "zh",
		FreeSpace: func(string) (uint64, uint64, error) { return free, total, nil },
		Notify:    func(s string) error { sent = append(sent, s); return nil }})
	j2.Tick()
	if len(sent) != 2 {
		t.Fatalf("restart repeated the notice: %q", sent)
	}
}

func TestJanitorLowSpaceTextWhenCleanupWasEnough(t *testing.T) {
	j := NewJanitor(JanitorOptions{Lang: "zh"})
	res := JanitorResult{Removed: make([]JanitorEntry, 12), Freed: 100 << 30}
	got := j.LowSpaceText(24<<30, 200<<30, 926<<30, res)
	want := "硬盘刚才只剩 24 GB（2%）。我把一周没动的旧工作目录和测试临时文件清掉了 12 个，腾出 100 GB，现在剩 200 GB，不用管。"
	if got != want {
		t.Errorf("got  %q\nwant %q", got, want)
	}
}

func TestJanitorNeverCleansHomeOrDataDir(t *testing.T) {
	root := t.TempDir()
	t.Setenv("HOME", root)
	data := filepath.Join(root, "data")
	j := NewJanitor(JanitorOptions{DataDir: data, Dirs: []string{"~", root, data, "/", "relative/dir"}, TmpDir: filepath.Join(root, "tmp")})
	for _, p := range j.places() {
		if p.dir == root || p.dir == data || p.dir == "/" || !filepath.IsAbs(p.dir) {
			t.Errorf("unsafe place accepted: %q", p.dir)
		}
	}
}
