package core

import (
	"strings"
	"testing"
)

func TestArtReportProblems(t *testing.T) {
	art := "# 瑞凤小人\n## 参考图\n- ~/a/1.png\n- ~/a/2.png\n"
	inline := "## 范围\n- 改：小人\n参考图：~/a/1.png、~/a/2.png\n"
	code := "# 出图检查\n## 范围\n- 改：handoff-rules.json\n派活没附参考图就拒收\n"
	have := func(p string) bool { return p == "/tmp/cmp.png" }
	head := "#850 背景：x\n做了\n要你做的：没有\n我加的：无\n细节：\n"
	cases := []struct {
		name, notes, body string
		want              string // "" = passes; else a substring of the one problem
	}{
		{"not image work", code, head, ""},
		{"no notes", "", head, ""},
		{"missing", art, head, "对照图"},
		{"inline refs, missing", inline, head, "对照图"},
		{"no image extension", art, head + "对照图：见上\n", "对照图"},
		{"file not there", art, head + "对照图：/tmp/none.png\n", "不存在"},
		{"local file", art, head + "对照图： `/tmp/cmp.png`\n", ""},
		{"link", art, head + "- 对照图：https://cdn.example.com/c.jpg\n", ""},
	}
	for _, c := range cases {
		got := artReportProblems(c.notes, c.body, have)
		if c.want == "" {
			if got != nil {
				t.Errorf("%s: want pass, got %v", c.name, got)
			}
			continue
		}
		if len(got) != 1 || !strings.Contains(got[0], c.want) {
			t.Errorf("%s: want %q, got %v", c.name, c.want, got)
		}
	}
}
