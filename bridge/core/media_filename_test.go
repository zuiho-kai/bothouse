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
	}, nil)
	want := []string{"A版·纯古琴", "B版·箫弦乐"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("VideoAttachmentLabels = %v, want %v", got, want)
	}

	explicit := VideoAttachmentLabels([]string{
		"词舟破晦-李清照三韵-A版纯古琴-低清-Discord.mp4",
		"词舟破晦-李清照三韵-B版箫弦乐-低清-Discord.mp4",
	}, []string{"A 版·纯古琴", ""})
	if !reflect.DeepEqual(explicit, []string{"A 版·纯古琴", "B版·箫弦乐"}) {
		t.Fatalf("explicit VideoAttachmentLabels = %v", explicit)
	}

	single := VideoAttachmentLabels([]string{"黎曼猜想xClaude-v10-成片-720p.mp4"}, nil)
	if !reflect.DeepEqual(single, []string{"黎曼猜想xClaude·v10·成片"}) {
		t.Fatalf("single VideoAttachmentLabels = %v", single)
	}
}

func TestASCIIFileName(t *testing.T) {
	cases := []struct {
		name    string
		boardID int
		index   int
		want    string
	}{
		{"1148_A_guqin.mp4", 1148, 1, "1148_A_guqin.mp4"},
		{"demo-v3.mp4", 1885, 1, "demo-v3.mp4"},
		{"词舟破晦-A版-guqin.mp4", 1148, 1, "1148_1_A_guqin.mp4"},
		{"词舟破晦-李清照三韵-A版纯古琴-低清-Discord.mp4", 1148, 1, "1148_1_A_Discord.mp4"},
		{"词舟破晦-李清照三韵-B版箫弦乐-低清-Discord.mp4", 1148, 2, "1148_2_B_Discord.mp4"},
		{"纯古琴版.mp4", 1148, 1, "1148_1.mp4"},
		{"箫弦乐版.mp4", 1148, 2, "1148_2.mp4"},
		{"1148-纯古琴.mp4", 1148, 1, "1148_1.mp4"},
		{"黎曼猜想xClaude-v10-成片-720p.mp4", 1061, 1, "1061_1_xClaude_v10_720p.mp4"},
		{"词舟破晦-李清照三韵-A版纯古琴-低清-Discord.mp4", 0, 0, "A_Discord.mp4"},
		{"🎬✨.mp4", 1148, 1, "1148_1.mp4"},
	}
	for _, tc := range cases {
		got := ASCIIFileName(tc.name, tc.boardID, tc.index)
		if got != tc.want {
			t.Errorf("ASCIIFileName(%q, %d, %d) = %q, want %q", tc.name, tc.boardID, tc.index, got, tc.want)
		}
	}

	// Non-ASCII fallback without boardID or index produces file_<8hex><ext>.
	fallback := ASCIIFileName("纯中文.mp4", 0, 0)
	if !strings.HasPrefix(fallback, "file_") || !strings.HasSuffix(fallback, ".mp4") {
		t.Fatalf("fallback = %q", fallback)
	}

	// Deduplication appends _2, _3.
	used := map[string]bool{}
	a := uniqueASCIIFileName("1148_1.mp4", used)
	b := uniqueASCIIFileName("1148_1.mp4", used)
	if a != "1148_1.mp4" || b != "1148_1_2.mp4" {
		t.Fatalf("uniqueASCIIFileName = %q, %q", a, b)
	}
}

func TestPrepareFileSends_PlainSendUnchanged(t *testing.T) {
	files := []FileAttachment{{FileName: "演示视频.mp4", MimeType: "video/mp4"}, {FileName: "demo.mp4", MimeType: "video/mp4"}}
	for i, item := range prepareFileSends(files, 0, nil) {
		if item.label != "" || item.file.FileName != files[i].FileName {
			t.Fatalf("plain send item %d = %+v, want no label and original name", i, item)
		}
	}
}
