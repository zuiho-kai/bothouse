package core

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/tests/testutil"
)

func TestConfigureDSHExistingModelLogin(t *testing.T) {
	for _, tc := range []struct {
		name, credentials, patch string
		wantModel, wantKeyRoute  bool
	}{
		{name: "account", credentials: "version: 1\nrecords:\n  deepseek-account-platform/default:\n    kind: grant\n    payload: {}\n", wantModel: true},
		{name: "relay", credentials: "version: 1\nrefs:\n  RELAY_API_KEY: synthetic-relay-key\n", patch: "- id: llm-deepseek\n  config:\n    baseURL: https://relay.invalid\n    apiKeyEnv: RELAY_API_KEY\n", wantModel: true},
		{name: "key", credentials: "version: 1\nrefs:\n  DEEPSEEK_API_KEY: synthetic-key\n", wantModel: true, wantKeyRoute: true},
		{name: "none"},
		{name: "relay_without_key", patch: "- id: llm-deepseek\n  config:\n    baseURL: https://relay.invalid\n    apiKeyEnv: RELAY_API_KEY\n"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			home := t.TempDir()
			testutil.SetHome(t, home)
			t.Setenv("DSH_HOME", filepath.Join(home, ".dsh"))
			t.Setenv("CONEST_COLLAB_DATA", filepath.Join(home, "collab"))
			t.Setenv("DEEPSEEK_API_KEY", "")
			t.Setenv("RELAY_API_KEY", "")
			t.Setenv("CC_DATA_DIR", filepath.Join(home, "bothouse"))
			if err := os.MkdirAll(dshHome(), 0o700); err != nil {
				t.Fatal(err)
			}
			cred := filepath.Join(dshHome(), ".credentials.yaml")
			if tc.credentials != "" {
				if err := os.WriteFile(cred, []byte(tc.credentials), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			if tc.patch != "" {
				if err := os.WriteFile(filepath.Join(dshHome(), "cordis.patch.yml"), []byte(tc.patch), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			if got := GetDSHStatus(context.Background()).HasDeepSeekKey; got != tc.wantModel {
				t.Errorf("wizard model status = %v, want %v", got, tc.wantModel)
			}
			res, err := ConfigureDSH(DSHConfigureRequest{Members: []DSHMember{{Name: "DSH"}}})
			if !tc.wantModel {
				want := "角色「DSH」没选本机 CLI，也没有 DeepSeek API Key：选一个 CLI，或填 Key"
				if err == nil || err.Error() != want {
					t.Fatalf("missing model: got %v, want %s", err, want)
				}
				if _, err := os.Stat(dshMembersFile()); !os.IsNotExist(err) {
					t.Fatalf("rejected save wrote members: %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("existing model login rejected: %v", err)
			}
			var seed struct{ Members []DSHMember }
			b, err := os.ReadFile(res.MembersFile)
			if err != nil || json.Unmarshal(b, &seed) != nil || len(seed.Members) != 1 {
				t.Fatalf("saved members: %s, %v", b, err)
			}
			if got := seed.Members[0].Model; tc.wantKeyRoute {
				if got == nil || *got != dshKeyModel {
					t.Fatalf("key route changed: %+v", got)
				}
			} else if got != nil {
				t.Fatalf("existing model overridden by API-key route: %+v", got)
			}
			if b, err := os.ReadFile(cred); err != nil || string(b) != tc.credentials || res.KeySaved {
				t.Fatalf("existing credentials changed: %v, key_saved=%v", err, res.KeySaved)
			}
		})
	}
}

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
	// #1173: the DSH-model role is pinned to the route of the wizard's key; CLI roles carry no model
	if m := seed.Members[1].Model; m == nil || m.Provider != "deepseek-official" || m.Model != "deepseek-flash" || seed.Members[0].Model != nil || seed.Members[2].Model != nil {
		t.Fatalf("member models: %s", b)
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
