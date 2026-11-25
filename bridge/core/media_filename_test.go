package core

import (
	"reflect"
	"strings"
	"testing"
)

func TestVideoAttachmentLabels(t *testing.T) {
	got := VideoAttachmentLabels([]string{
		"词舟破晦-李清照三韵-A版纯古琴-低清-Discord.mp4",
		"词舟破晦-李清照三韵-B版箫弦乐-低清-Discord.mp4",
	})
	want := []string{"A版·纯古琴", "B版·箫弦乐"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("VideoAttachmentLabels = %v, want %v", got, want)
	}

	single := VideoAttachmentLabels([]string{"黎曼猜想xClaude-v10-成片-720p.mp4"})
	if !reflect.DeepEqual(single, []string{"黎曼猜想xClaude·v10·成片"}) {
		t.Fatalf("single VideoAttachmentLabels = %v", single)
	}
}

func TestASCIIFileName(t *testing.T) {
	cases := []struct {
		name, prefix, hint, want string
	}{
		{"1148_A_guqin.mp4", "1148", "A版·纯古琴", "1148_A_guqin.mp4"},
		{"demo-v3.mp4", "1885", "demo·v3", "demo-v3.mp4"},
		{"词舟破晦-李清照三韵-A版纯古琴-低清-Discord.mp4", "1148", "A版·纯古琴", "1148_A_chunguqin.mp4"},
		{"词舟破晦-李清照三韵-B版箫弦乐-低清-Discord.mp4", "1148", "B版·箫弦乐", "1148_B_xiaoxianyue.mp4"},
		{"词舟破晦-李清照三韵-A版纯古琴-低清-Discord.mp4", "", "", "cizhoupohui_liqingzhaosanyun_A_banchunguqin.mp4"},
	}
	for _, tc := range cases {
		got := ASCIIFileName(tc.name, tc.prefix, tc.hint)
		if got != tc.want {
			t.Errorf("ASCIIFileName(%q, %q, %q) = %q, want %q", tc.name, tc.prefix, tc.hint, got, tc.want)
		}
	}

	// Non-ASCII fallback (e.g. emoji/symbols only) never produces empty or leading-hyphen names.
	sym := ASCIIFileName("🎬✨.mp4", "1148", "")
	if !strings.HasPrefix(sym, "1148_") || !strings.HasSuffix(sym, ".mp4") {
		t.Fatalf("symbol fallback = %q", sym)
	}

	// Deduplication appends _2, _3.
	used := map[string]bool{}
	a := uniqueASCIIFileName("1148_A_guqin.mp4", used)
	b := uniqueASCIIFileName("1148_A_guqin.mp4", used)
	if a != "1148_A_guqin.mp4" || b != "1148_A_guqin_2.mp4" {
		t.Fatalf("uniqueASCIIFileName = %q, %q", a, b)
	}
}
