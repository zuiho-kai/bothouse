package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Every size limit that leaves something out now says so where it is read (#2048).

func TestCapExitFilesNamesWhatIsLeftOut(t *testing.T) {
	var files []FileAttachment
	for _, n := range []string{"a.png", "b.png", "c.png", "d.png", "e.png", "f.png"} {
		files = append(files, FileAttachment{FileName: n, Data: []byte("x")})
	}
	files = append(files, FileAttachment{FileName: "big.pdf", Data: make([]byte, exitFileMaxBytes+1)})
	kept, left := capExitFiles(files)
	if len(kept) != exitFileMax || len(left) != 2 {
		t.Fatalf("kept %d, left %v", len(kept), left)
	}
	note := leftOutNote(left)
	if !strings.Contains(note, "f.png") || !strings.Contains(note, "big.pdf") || !strings.Contains(note, "2 个") {
		t.Fatalf("note does not name the left-out files: %s", note)
	}
}

func TestLimitedBufferMarksTheCut(t *testing.T) {
	var b limitedBuffer
	b.Write([]byte(strings.Repeat("x", memberOutputLimit)))
	b.Write([]byte("tail"))
	if got := b.String(); !strings.Contains(got, "[output cut: 4 more bytes") {
		t.Fatalf("cut not marked: %q", got[len(got)-80:])
	}
	var small limitedBuffer
	small.Write([]byte("ok"))
	if small.String() != "ok" {
		t.Fatalf("uncut output changed: %q", small.String())
	}
}

func TestReadPackDirListsLargePersona(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "personas"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "personas", "huge.md"), []byte(strings.Repeat("长", libraryMaxPersona)), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, ok := readPackDir(dir).personas["huge"]; !ok {
		t.Fatal("persona over libraryMaxPersona vanished from the pack")
	}
}
