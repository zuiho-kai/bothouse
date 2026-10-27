package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestConfigureDSHWritesKeyPatchAndMembers(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("DSH_HOME", filepath.Join(home, ".dsh"))
	t.Setenv("CONEST_COLLAB_DATA", filepath.Join(home, "collab"))
	t.Setenv("DEEPSEEK_API_KEY", "")
	cred := filepath.Join(home, ".dsh", ".credentials.yaml")
	patch := filepath.Join(home, ".dsh", "profiles", "web", "cordis.patch.yml")
	_ = os.MkdirAll(filepath.Dir(patch), 0o755)
	_ = os.WriteFile(cred, []byte("version: 1\n# keep me\nrefs:\n  OPENAI_API_KEY: sk-old\n"), 0o600)
	_ = os.WriteFile(patch, []byte("# user layer\n- id: locale\n  config:\n    preference: zh\n"), 0o644)

	if _, err := ConfigureDSH(DSHConfigureRequest{Members: []DSHMember{{Name: "橘"}}}); err == nil {
		t.Fatal("a model member without key must be refused")
	}
	res, err := ConfigureDSH(DSHConfigureRequest{DeepSeekAPIKey: "sk-new", Members: []DSHMember{{Name: "橘", CLI: "claude", Persona: "p"}, {Name: "鲸鱼娘"}, {Name: "Claude Code", CLI: "claude", NameCustomized: dshBoolPtr(false)}}})
	if err != nil || !res.KeySaved || res.Members != 3 {
		t.Fatalf("configure: %+v %v", res, err)
	}
	b, _ := os.ReadFile(cred)
	if s := string(b); !strings.Contains(s, "OPENAI_API_KEY: sk-old") || !strings.Contains(s, "DEEPSEEK_API_KEY: sk-new") || !strings.Contains(s, "# keep me") {
		t.Fatalf("credentials not merged:\n%s", s)
	}
	if st, _ := os.Stat(cred); st.Mode().Perm() != 0o600 {
		t.Fatalf("credentials mode %v", st.Mode().Perm())
	}
	b, _ = os.ReadFile(patch)
	if s := string(b); !strings.Contains(s, "preference: zh") || !strings.Contains(s, "id: ui-settings-models") || !strings.Contains(s, "credentialOnboarding: false") ||
		!strings.Contains(s, "id: attachment-local") || !strings.Contains(s, "maxImageDimension: 65535") {
		t.Fatalf("patch:\n%s", s)
	}
	var seed struct{ Members []DSHMember }
	b, _ = os.ReadFile(res.MembersFile)
	if json.Unmarshal(b, &seed) != nil || len(seed.Members) != 3 || seed.Members[0].CLI != "claude" || seed.Members[2].Name != "Claude Code" || seed.Members[2].NameCustomized == nil || *seed.Members[2].NameCustomized {
		t.Fatalf("members file: %s", b)
	}
	// second run is idempotent on the patch entry
	if _, err := ConfigureDSH(DSHConfigureRequest{Members: []DSHMember{{Name: "橘", CLI: "gemini"}}}); err != nil {
		t.Fatal(err)
	}
	b, _ = os.ReadFile(patch)
	if strings.Count(string(b), "ui-settings-models") != 1 || strings.Count(string(b), "attachment-local") != 1 {
		t.Fatalf("duplicate entry:\n%s", b)
	}
	for _, bad := range []string{"a b", "@x", "", "x<y"} {
		if _, err := ConfigureDSH(DSHConfigureRequest{Members: []DSHMember{{Name: bad, CLI: "claude"}}}); err == nil {
			t.Fatalf("name %q accepted", bad)
		}
	}
}

func TestScanDSHWebURL(t *testing.T) {
	p := filepath.Join(t.TempDir(), "log")
	_ = os.WriteFile(p, []byte("boot\ndsh web: http://127.0.0.1:5123/?token=abc\n"), 0o600)
	if u := scanDSHWebURL(p); u != "http://127.0.0.1:5123/?token=abc" {
		t.Fatalf("got %q", u)
	}
}

func TestSetDSHPatchConfigImageDimension(t *testing.T) {
	dir := t.TempDir()
	read := func(p string) string { b, _ := os.ReadFile(p); return string(b) }

	// new file: the entry is written as an int
	fresh := filepath.Join(dir, "fresh", "cordis.patch.yml")
	if err := setDSHPatchConfig(fresh, "attachment-local", "maxImageDimension", DSHMaxImageDimension); err != nil {
		t.Fatal(err)
	}
	if s := read(fresh); s != "- id: attachment-local\n  config:\n    maxImageDimension: 65535\n" {
		t.Fatalf("fresh patch:\n%s", s)
	}

	// an attachment-local entry the user already has: merged, their other keys and the other entries stay
	merged := filepath.Join(dir, "merged.yml")
	_ = os.WriteFile(merged, []byte("# mine\n- id: attachment-local\n  config:\n    maxImageBytes: 100\n    maxImageDimension: 8192\n"+
		"- id: locale\n  config:\n    preference: zh\n- insert:\n    - id: attachment-local\n      name: x\n"), 0o644)
	if err := setDSHPatchConfig(merged, "attachment-local", "maxImageDimension", DSHMaxImageDimension); err != nil {
		t.Fatal(err)
	}
	s := read(merged)
	for _, want := range []string{"# mine", "maxImageBytes: 100", "maxImageDimension: 65535", "preference: zh", "name: x"} {
		if !strings.Contains(s, want) {
			t.Fatalf("merged patch lacks %q:\n%s", want, s)
		}
	}
	if strings.Contains(s, "8192") || strings.Count(s, "maxImageDimension") != 1 || strings.Count(s, "id: attachment-local") != 2 {
		t.Fatalf("merged patch:\n%s", s)
	}

	// other entries only: untouched, the new entry is appended
	other := filepath.Join(dir, "other.yml")
	_ = os.WriteFile(other, []byte("- id: tool-web\n  config:\n    search: false\n"), 0o644)
	if err := setDSHPatchConfig(other, "attachment-local", "maxImageDimension", DSHMaxImageDimension); err != nil {
		t.Fatal(err)
	}
	if s := read(other); s != "- id: tool-web\n  config:\n    search: false\n- id: attachment-local\n  config:\n    maxImageDimension: 65535\n" {
		t.Fatalf("other patch:\n%s", s)
	}
	if err := setDSHPatchConfig(other, "x", "y", "str"); err == nil {
		t.Fatal("a string value must be refused")
	}
}

func dshBoolPtr(v bool) *bool { return &v }
