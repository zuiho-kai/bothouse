package ccconnect_test

import (
	"io/fs"
	"os"
	"strings"
	"testing"

	ccconnect "github.com/chenhg5/cc-connect"
)

// #2047 item 7: the embed takes every lead tool and no test file.
func TestLeadEmbedSkipsOnlyTests(t *testing.T) {
	entries, err := os.ReadDir("contrib/lead")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		name := e.Name()
		_, err := fs.Stat(ccconnect.LeadToolFiles, "contrib/lead/"+name)
		test := strings.HasPrefix(name, "test") || name == "fixtures" || name == "__pycache__"
		if test && err == nil {
			t.Errorf("%s is a test file but is embedded", name)
		}
		if !test && err != nil {
			t.Errorf("%s is a lead tool but is not embedded: name it in embed_lead.go", name)
		}
	}
}
