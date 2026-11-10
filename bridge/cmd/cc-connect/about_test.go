package main

import (
	"bytes"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func TestAboutPrintsNotesAndSetupWithoutSecrets(t *testing.T) {
	dir := t.TempDir()
	cfg := filepath.Join(dir, "config.toml")
	if err := os.WriteFile(cfg, []byte(`language = "zh"
data_dir = "`+dir+`"

[[projects]]
name = "longniang"
team_name = "龙娘"
[projects.agent]
type = "codex"
[projects.agent.options]
model = "gpt-x"
work_dir = "`+dir+`"
[[projects.platforms]]
type = "discord"
[projects.platforms.options]
token = "SECRET-TOKEN-123"

[[projects]]
name = "maomao"
[projects.agent]
type = "claudecode"
[projects.agent.options]
work_dir = "`+dir+`"
[[projects.platforms]]
type = "discord"
[projects.platforms.options]
token = "SECRET-TOKEN-456"
`), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CC_PROJECT", "maomao")
	var out bytes.Buffer
	if err := aboutCommand([]string{"--config", cfg}, &out); err != nil {
		t.Fatal(err)
	}
	s := out.String()
	for _, want := range []string{"bothouse 是什么", "LobeHub", "共 2 个角色", "longniang（显示名 龙娘）：CLI codex，模型 gpt-x；平台 discord", "maomao ——就是你", "已接平台：discord"} {
		if !strings.Contains(s, want) {
			t.Errorf("about output lacks %q:\n%s", want, s)
		}
	}
	if strings.Contains(s, "SECRET-TOKEN") {
		t.Fatalf("about output leaks a token:\n%s", s)
	}
}

// The notes follow README's comparison section: every project linked there is in both notes.
func TestAboutNotesCoverReadmeComparison(t *testing.T) {
	for _, pair := range [][2]string{{"../../../README.md", "../../about/ABOUT.md"}, {"../../../README.zh-CN.md", "../../about/ABOUT.zh-CN.md"}} {
		readme, err := os.ReadFile(pair[0])
		if err != nil {
			t.Fatal(err)
		}
		notes, err := os.ReadFile(pair[1])
		if err != nil {
			t.Fatal(err)
		}
		r := string(readme)
		start := strings.Index(r, "## bothouse")
		for start >= 0 && !strings.Contains(r[start:start+80], "other projects") && !strings.Contains(r[start:start+80], "其他项目") {
			next := strings.Index(r[start+1:], "## bothouse")
			if next < 0 {
				start = -1
				break
			}
			start += 1 + next
		}
		if start < 0 {
			t.Fatalf("%s: comparison section not found", pair[0])
		}
		end := strings.Index(r[start+3:], "\n## ")
		sec := r[start:]
		if end >= 0 {
			sec = r[start : start+3+end]
		}
		for _, m := range regexp.MustCompile(`\]\((https?://[^)]+)\)`).FindAllStringSubmatch(sec, -1) {
			if !strings.Contains(string(notes), m[1]) {
				t.Errorf("%s compares %s but %s does not; update the notes with README", pair[0], m[1], pair[1])
			}
		}
	}
}
