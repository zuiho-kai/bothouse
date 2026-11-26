package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestConfigGetPrintsValuesAsJSON(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.toml")
	cfg := "data_dir = \"/d\"\n[management]\nport = 9820\n[[projects]]\nname = \"a\"\nlife_page = '~/wiki/a.md'\n[[projects]]\nname = \"b\"\n"
	if err := os.WriteFile(path, []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	get := func(key string) any {
		t.Helper()
		var out bytes.Buffer
		if err := configGet(&out, path, key); err != nil {
			t.Fatalf("configGet(%q): %v", key, err)
		}
		var v any
		if err := json.Unmarshal(out.Bytes(), &v); err != nil {
			t.Fatalf("configGet(%q) printed %q: %v", key, out.String(), err)
		}
		return v
	}
	if got := get("management.port"); got != float64(9820) {
		t.Fatalf("management.port = %v", got)
	}
	ps, _ := get("projects").([]any)
	if len(ps) != 2 || ps[0].(map[string]any)["life_page"] != "~/wiki/a.md" {
		t.Fatalf("projects = %v", ps)
	}
	if got := get("management.missing"); got != nil {
		t.Fatalf("unset key = %v, want null", got)
	}
	if got, _ := get("").(map[string]any); got["data_dir"] != "/d" {
		t.Fatalf("whole file = %v", got)
	}
	if err := configGet(&bytes.Buffer{}, filepath.Join(t.TempDir(), "none.toml"), ""); err == nil {
		t.Fatal("a missing config file must be an error")
	}
}
