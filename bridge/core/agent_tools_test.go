package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
)

// toolFS is contrib/tools as the binary embeds it (scripts and rules), read from the source tree.
func toolFS(t *testing.T) fstest.MapFS {
	t.Helper()
	m := fstest.MapFS{}
	for _, pat := range []string{"../contrib/tools/*.py", "../contrib/tools/rules/*.md", "../contrib/hooks/dshlog.py"} {
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
	t.Cleanup(func() { AgentToolFS = old })
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
