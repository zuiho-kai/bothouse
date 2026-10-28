package core

import (
	"reflect"
	"testing"
)

func TestReadPathsFromShellCommand(t *testing.T) {
	tests := []struct {
		name    string
		command string
		want    []string
	}{
		{"cat one", "cat README.md", []string{"README.md"}},
		{"cat two", "cat a.md b.md", []string{"a.md", "b.md"}},
		{"head lines", "head -n 20 a.md", []string{"a.md"}},
		{"tail bytes", "tail -c 100 b.md", []string{"b.md"}},
		{"sed range", "sed -n '1,20p' c.md", []string{"c.md"}},
		{"sed script", "sed 's/a/b/' file.md", []string{"file.md"}},
		{"two segments", "cd /x && cat d.md", []string{"d.md"}},
		{"redirect output", "cat a.md > out.md", []string{"a.md"}},
		{"here doc", "cat <<EOF", nil},
		{"grep ignored", "grep -n x a.md", nil},
		{"quoted path", `cat "a b.md"`, []string{"a b.md"}},
		{"dev null", "cat /dev/null a.md", []string{"a.md"}},
		{"pipe", "cat a.md | head -n 2", []string{"a.md"}},
		{"env assignment", "FOO=1 cat e.md", []string{"e.md"}},
		{"sudo", "sudo cat f.md", []string{"f.md"}},
		{"bat flag", "bat --theme=Monokai file.md", []string{"file.md"}},
		{"head long flag", "head --lines 20 file.md", []string{"file.md"}},
		{"duplicate dedup", "cat a.md a.md", []string{"a.md"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := readPathsFromShellCommand(tt.command)
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("readPathsFromShellCommand(%q) = %#v, want %#v", tt.command, got, tt.want)
			}
		})
	}
}

func TestReadPathsFromTool(t *testing.T) {
	tests := []struct {
		name  string
		tool  string
		input string
		want  []string
	}{
		{"read bare", "Read", "/x/a.md", []string{"/x/a.md"}},
		{"read json", "Read", `{"file_path":"/x/b.md"}`, []string{"/x/b.md"}},
		{"read title", "Read file", "/x/r.md", []string{"/x/r.md"}},
		{"read summary", "Read", "Read /x/u.md", []string{"/x/u.md"}},
		{"read title only", "Read", "Read", nil},
		{"run title", "Run command", `{"command":"cat /x/s.md"}`, []string{"/x/s.md"}},
		{"write title", "Write file", `{"file_path":"/x/t.md"}`, nil},
		{"notebook", "NotebookRead", `{"notebook_path":"/x/n.ipynb"}`, []string{"/x/n.ipynb"}},
		{"bash json", "Bash", `{"command":"cat /x/c.md"}`, []string{"/x/c.md"}},
		{"bash description", "Bash", "# read the doc\ncat /x/d.md", []string{"/x/d.md"}},
		{"write ignored", "Write", `{"file_path":"/x/e.md"}`, nil},
		{"edit ignored", "Edit", `{"file_path":"/x/f.md"}`, nil},
		{"unknown command", "Custom", `{"command":"cat /x/g.md"}`, []string{"/x/g.md"}},
		{"unknown file path", "Custom", `{"file_path":"/x/h.md"}`, nil},
		{"grep json", "Grep", `{"pattern":"needle"}`, nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := readPathsFromTool(tt.tool, tt.input)
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("readPathsFromTool(%q, %q) = %#v, want %#v", tt.tool, tt.input, got, tt.want)
			}
		})
	}
}
