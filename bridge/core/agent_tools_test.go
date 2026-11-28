package core

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"testing/fstest"
)

// toolFS is contrib/tools as the binary embeds it (scripts and rules), read from the source tree.
func toolFS(t *testing.T) fstest.MapFS {
	t.Helper()
	m := fstest.MapFS{}
	for _, pat := range []string{"../contrib/tools/*.py", "../contrib/tools/rules/*.md", "../contrib/tools/skills/*.md", "../contrib/hooks/dshlog.py"} {
		files, err := filepath.Glob(pat)
		if err != nil || len(files) == 0 {
			t.Fatalf("no files for %s: %v", pat, err)
		}
		for _, f := range files {
			b, err := os.ReadFile(f)
			if err != nil {
				t.Fatal(err)
			}
			m[strings.TrimPrefix(filepath.ToSlash(f), "../")] = &fstest.MapFile{Data: b}
		}
	}
	return m
}

func withToolFS(t *testing.T) {
	old := AgentToolFS
	AgentToolFS = toolFS(t)
	oldFetch := fetchUV // no uv download from tests (agentToolUV falls back to it when uv is not on PATH)
	fetchUV = func(string) ([]byte, error) { return nil, os.ErrNotExist }
	oldRoots := AgentToolSkillRoots // never the real ~/.agents/skills from tests
	skillHome := t.TempDir()
	AgentToolSkillRoots = func() []string {
		return []string{filepath.Join(skillHome, "agents"), filepath.Join(skillHome, "claude"), filepath.Join(skillHome, "gemini")}
	}
	t.Cleanup(func() { AgentToolFS, fetchUV, AgentToolSkillRoots = old, oldFetch, oldRoots })
}

// No uv on PATH but bothouse has its own (a container without sudo): the persona names that uv, and it is
// linked into <data_dir>/tools/bin, which is on every role's PATH, so plain `uv` works too.
func TestAgentToolsUseOwnUV(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("no link on Windows")
	}
	withToolFS(t)
	t.Setenv("PATH", t.TempDir())
	data, wd := t.TempDir(), t.TempDir()
	own := filepath.Join(data, "tools", "uv", "uv")
	if err := os.MkdirAll(filepath.Dir(own), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(own, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	res, err := EnableAgentTools(AgentToolOptions{DataDir: data, WorkDir: wd, AgentType: "claudecode", Lang: "en", Only: []string{"peek"}})
	if err != nil {
		t.Fatal(err)
	}
	if res.UV != own || len(res.Warnings) != 0 {
		t.Fatalf("uv %q warnings %v, want %q", res.UV, res.Warnings, own)
	}
	b, _ := os.ReadFile(res.PersonaFile)
	if !strings.Contains(string(b), "`"+own+" run -q --script") {
		t.Fatalf("persona does not name the own uv:\n%s", b)
	}
	if cur, err := os.Readlink(filepath.Join(data, "tools", "bin", "uv")); err != nil || cur != own {
		t.Fatalf("tools/bin/uv -> %q %v, want %q", cur, err, own)
	}
}

func TestAgentToolsOnOff(t *testing.T) {
	withToolFS(t)
	data, wd := t.TempDir(), t.TempDir()
	persona := filepath.Join(wd, "CLAUDE.md")
	if err := os.WriteFile(persona, []byte("# me\n\nkeep this\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	res, err := EnableAgentTools(AgentToolOptions{DataDir: data, WorkDir: wd, AgentType: "claudecode", Lang: "en"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(res.Enabled, ",") != "peek,watchvid,websearch" || res.PersonaFile != persona {
		t.Fatalf("result %+v", res)
	}
	for _, f := range []string{"peek.py", "dshlog.py", "watchvid.py", "websearch.py", "rules/_head.en.md"} {
		if _, err := os.Stat(filepath.Join(data, "tools", f)); err != nil {
			t.Errorf("not installed: %s", f)
		}
	}
	if _, err := os.Stat(filepath.Join(data, "tools", "test_tools.py")); err == nil {
		t.Error("tests must not be installed")
	}
	b, _ := os.ReadFile(persona)
	s := string(b)
	dir := filepath.Join(data, "tools")
	for _, want := range []string{"keep this", toolRulesBegin, toolRulesEnd, dir + "/peek.py", dir + "/watchvid.py", dir + "/websearch.py search"} {
		if !strings.Contains(s, want) {
			t.Errorf("persona lacks %q:\n%s", want, s)
		}
	}
	if strings.Contains(s, "{{") {
		t.Errorf("placeholder left:\n%s", s)
	}

	// on again: same file (idempotent)
	if _, err := EnableAgentTools(AgentToolOptions{DataDir: data, WorkDir: wd, AgentType: "claudecode", Lang: "en"}); err != nil {
		t.Fatal(err)
	}
	if b2, _ := os.ReadFile(persona); string(b2) != s {
		t.Errorf("second on changed the persona:\n%s", b2)
	}

	// off one tool, then all: the user's text stays, the block goes
	res, err = DisableAgentTools(AgentToolOptions{DataDir: data, WorkDir: wd, AgentType: "claudecode", Only: []string{"watchvid"}})
	if err != nil || strings.Join(res.Enabled, ",") != "peek,websearch" {
		t.Fatalf("off watchvid: %+v %v", res, err)
	}
	if _, err := DisableAgentTools(AgentToolOptions{DataDir: data, WorkDir: wd, AgentType: "claudecode"}); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(persona); string(b) != "# me\n\nkeep this\n" {
		t.Errorf("after off: %q", b)
	}
}

func TestAgentToolsPersonaFileAndLanguage(t *testing.T) {
	withToolFS(t)
	data, wd := t.TempDir(), t.TempDir()
	// an acp (DSH) role reads AGENTS.md; the reply-language line picks the Chinese snippets
	agents := filepath.Join(wd, "AGENTS.md")
	if err := os.WriteFile(agents, []byte(WithReplyLanguage("", "zh")), 0o644); err != nil {
		t.Fatal(err)
	}
	res, err := EnableAgentTools(AgentToolOptions{DataDir: data, WorkDir: wd, AgentType: "acp", Only: []string{"peek"}})
	if err != nil {
		t.Fatal(err)
	}
	if res.PersonaFile != agents || strings.Join(res.Enabled, ",") != "peek" {
		t.Fatalf("result %+v", res)
	}
	b, _ := os.ReadFile(agents)
	if !strings.Contains(string(b), "看队友进度") || strings.Contains(string(b), "watchvid") {
		t.Errorf("persona:\n%s", b)
	}
	if _, err := EnableAgentTools(AgentToolOptions{DataDir: data, WorkDir: wd, AgentType: "acp", Only: []string{"nope"}}); err == nil {
		t.Error("unknown tool accepted")
	}
}

func TestWithToolRulesKeepsCRLFAndOtherBlocks(t *testing.T) {
	in := "a\r\n\r\n<!-- conest:reply-language -->\r\nAlways reply in English.\r\n"
	out := WithToolRules(in, "x\ny")
	if !strings.Contains(out, "<!-- conest:tools -->\r\nx\r\ny\r\n<!-- /conest:tools -->\r\n") || !strings.HasPrefix(out, in[:len(in)-2]) {
		t.Fatalf("%q", out)
	}
	if back := WithToolRules(out, ""); back != in {
		t.Fatalf("remove: %q", back)
	}
}

// A persona rewritten without the tools block (11-28) must not make the role forget the tools: every bridge start
// puts each installed tool into the shared skill dirs, with the same command line as the persona block.
func TestSyncAgentToolSkills(t *testing.T) {
	withToolFS(t)
	data := t.TempDir()
	if names, err := SyncAgentToolSkills(data); err != nil || len(names) != 0 {
		t.Fatalf("tools never installed: want nothing, got %v %v", names, err)
	}
	if _, err := InstallAgentTools(data); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(AgentToolsDir(data), "SKILL.md")); err == nil {
		t.Fatal("skill templates must not be copied into the tools dir")
	}
	roots := AgentToolSkillRoots()
	if err := os.MkdirAll(roots[1], 0o755); err != nil { // Claude Code installed, Antigravity not
		t.Fatal(err)
	}
	names, err := SyncAgentToolSkills(data)
	if err != nil || len(names) != len(agentTools) {
		t.Fatalf("got %v %v", names, err)
	}
	b, err := os.ReadFile(filepath.Join(roots[0], "bothouse-watchvid", "SKILL.md"))
	if err != nil {
		t.Fatal(err)
	}
	s := string(b)
	want := filepath.Join(AgentToolsDir(data), "watchvid.py")
	if !strings.HasPrefix(s, "---\nname: bothouse-watchvid\ndescription: ") || !strings.Contains(s, want) || strings.Contains(s, "{{") {
		t.Fatalf("skill:\n%s", s)
	}
	if !strings.Contains(s, "b23.tv") || !strings.Contains(s, "只看标题和简介不算看过视频") || !strings.Contains(s, "Reading only the title") {
		t.Fatalf("skill misses trigger words or rule lines:\n%s", s)
	}
	if dst, err := os.Readlink(filepath.Join(roots[1], "bothouse-watchvid")); err != nil || dst != filepath.Join(roots[0], "bothouse-watchvid") {
		t.Fatalf("claude link: %q %v", dst, err)
	}
	if _, err := os.Lstat(filepath.Join(roots[2], "bothouse-watchvid")); err == nil {
		t.Fatal("no link into a CLI dir that does not exist")
	}
	// a user's own skill of the same name in a linked dir is left alone; a second run changes nothing
	own := filepath.Join(roots[1], "bothouse-peek")
	os.Remove(own)
	if err := os.MkdirAll(own, 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := SyncAgentToolSkills(data); err != nil {
		t.Fatal(err)
	}
	if st, err := os.Lstat(own); err != nil || st.Mode()&os.ModeSymlink != 0 {
		t.Fatal("user's own skill dir replaced")
	}
}
