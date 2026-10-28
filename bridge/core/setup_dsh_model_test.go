package core

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// dshStoredKey gives the test a DSH_HOME whose credentials file holds DEEPSEEK_API_KEY (as DSH's Models page
// writes it), so a DSH role with no third-party API has a key.
func dshStoredKey(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("DSH_HOME", home)
	t.Setenv("DEEPSEEK_API_KEY", "")
	if err := os.WriteFile(filepath.Join(home, ".credentials.yaml"), []byte("version: 1\nrefs:\n  DEEPSEEK_API_KEY: sk-stored\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	return home
}

func dshTestBridge(t *testing.T) {
	t.Helper()
	old := npmInstall
	npmInstall = func(_ context.Context, dir, _ string) error {
		e := filepath.Join(dir, "node_modules", "@deepseek-ai", "dsh-hooks-claude-code", "lib", "index.js")
		if err := os.MkdirAll(filepath.Dir(e), 0o755); err != nil {
			return err
		}
		return os.WriteFile(e, []byte("export {}\n"), 0o644)
	}
	t.Cleanup(func() { npmInstall = old })
}

// a relay (custom: base_url + key + model) for a DSH role: the overlay points llm-deepseek at it and makes the
// model the default and the acp model; the key is in the role's env and its 0600 env file.
func TestApplyWizardDSHRelay(t *testing.T) {
	useRepoHooks(t)
	noHardware(t)
	fakeDiscord(t, map[string]string{fakeToken("333"): "Whale"})
	dsh, _, _ := fakeDSH(t)
	t.Setenv("DSH_HOME", t.TempDir())
	t.Setenv("DEEPSEEK_API_KEY", "")
	dshTestBridge(t)
	data := t.TempDir()
	store := newMemStore()
	clis := []LocalCLI{{AgentType: "dsh", Path: dsh, InPath: true, Supported: true, Login: "not_logged_in"}}
	res := ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: data, CLIs: clis},
		dshWizardReq(&WizardProvider{Vendor: "custom", BaseURL: "https://relay.example/", APIKey: "sk-relay", Model: "deepseek-v4.1-flash"}))
	if !res.Saved {
		t.Fatalf("apply: %+v", res)
	}
	p := store.projects["whale"]
	if p.Provider != nil || p.AgentEnv[DSHKeyEnv] != "sk-relay" {
		t.Fatalf("project = %+v", p)
	}
	b, _ := os.ReadFile(DSHPatchPath(data, "whale"))
	for _, want := range []string{"- id: llm-deepseek\n  config:\n    baseURL: \"https://relay.example\"\n    apiKeyEnv: " + DSHKeyEnv + "\n    models:\n      - id: \"deepseek-v4.1-flash\"\n        inputModalities: [text, image]\n",
		"- id: agent-default-model\n  config:\n    provider: deepseek-official\n    model: \"deepseek-v4.1-flash\"\n",
		"- id: acp\n  config:\n    provider: deepseek-official\n    model: \"deepseek-v4.1-flash\"\n"} {
		if !strings.Contains(string(b), want) {
			t.Errorf("overlay lacks %q:\n%s", want, b)
		}
	}
	if strings.Contains(string(b), "sk-relay") {
		t.Fatal("the key must not be in the overlay")
	}
	if e, err := os.ReadFile(DSHEnvPath(data, "whale")); err != nil || string(e) != DSHKeyEnv+"=sk-relay\n" {
		t.Fatalf("env file = %q %v", e, err)
	}
	if r := res.Roles[0]; r.ProviderVia != "native" || !strings.HasSuffix(r.Provider, "https://relay.example") {
		t.Fatalf("report = %q %q", r.Provider, r.ProviderVia)
	}
	// a relay with no model is refused (custom has no default model)
	res = ApplyWizard(context.Background(), WizardEnv{Store: newMemStore(), DataDir: t.TempDir(), CLIs: clis},
		dshWizardReq(&WizardProvider{Vendor: "custom", BaseURL: "https://relay.example", APIKey: "sk-relay"}))
	if res.Saved || !strings.Contains(res.Error, "model") {
		t.Fatalf("no model: %+v", res)
	}
}

// the user's own relay set up in DSH_HOME: its llm-deepseek / agent-default-model / acp entries go into the role's
// overlay, and the key its apiKeyEnv names is carried into the role's env when only this shell has it.
func TestApplyWizardDSHCarriesHomeModel(t *testing.T) {
	useRepoHooks(t)
	noHardware(t)
	fakeDiscord(t, map[string]string{fakeToken("333"): "Whale"})
	dsh, _, _ := fakeDSH(t)
	home := t.TempDir()
	t.Setenv("DSH_HOME", home)
	t.Setenv("DEEPSEEK_API_KEY", "")
	t.Setenv("RELAY_API_KEY", "")
	dshTestBridge(t)
	_ = os.MkdirAll(filepath.Join(home, "profiles", "acp"), 0o755)
	_ = os.WriteFile(filepath.Join(home, "profiles", "acp", "cordis.patch.yml"), []byte(
		"- id: llm-deepseek\n  config:\n    baseURL: https://relay.example\n    apiKeyEnv: RELAY_API_KEY\n    models:\n      - id: m1\n"+
			"- id: agent-default-model\n  config: {provider: deepseek-official, model: m1}\n"+
			"- id: acp\n  config: {provider: deepseek-official, model: m0}\n"), 0o644)
	// the home layer comes after the profile's: its acp wins
	_ = os.WriteFile(filepath.Join(home, "cordis.patch.yml"), []byte("- id: acp\n  config: {provider: deepseek-official, model: m1}\n"), 0o644)
	clis := []LocalCLI{{AgentType: "dsh", Path: dsh, InPath: true, Supported: true, Login: "logged_in"}}

	// the key is nowhere: refused, naming the variable
	data := t.TempDir()
	res := ApplyWizard(context.Background(), WizardEnv{Store: newMemStore(), DataDir: data, CLIs: clis}, dshWizardReq(nil))
	if res.Saved || !strings.Contains(res.Error, "RELAY_API_KEY") {
		t.Fatalf("no key: %+v", res)
	}

	t.Setenv("RELAY_API_KEY", "sk-shell")
	store := newMemStore()
	res = ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: data, CLIs: clis}, dshWizardReq(nil))
	if !res.Saved {
		t.Fatalf("apply: %+v", res)
	}
	p := store.projects["whale"]
	if p.AgentEnv["RELAY_API_KEY"] != "sk-shell" || p.AgentEnv[DSHKeyEnv] != "" {
		t.Fatalf("env = %v", p.AgentEnv)
	}
	b, _ := os.ReadFile(DSHPatchPath(data, "whale"))
	for _, want := range []string{"- id: llm-deepseek\n  config:\n    baseURL: https://relay.example\n    apiKeyEnv: RELAY_API_KEY\n    models:\n      - id: m1\n",
		"- id: agent-default-model\n  config: {provider: deepseek-official, model: m1}\n",
		"- id: acp\n  config: {provider: deepseek-official, model: m1}\n", "maxImageDimension: 65535"} {
		if !strings.Contains(string(b), want) {
			t.Errorf("overlay lacks %q:\n%s", want, b)
		}
	}
	if e, _ := os.ReadFile(DSHEnvPath(data, "whale")); string(e) != "RELAY_API_KEY=sk-shell\n" {
		t.Fatalf("env file = %q", e)
	}

	// the key stored in DSH's credentials (or $DSH_HOME/.env): DSH finds it itself, nothing copied
	t.Setenv("RELAY_API_KEY", "")
	for _, f := range []struct{ name, body string }{{".credentials.yaml", "version: 1\nrefs:\n  RELAY_API_KEY: sk-file\n"}, {".env", "RELAY_API_KEY=sk-file\n"}} {
		path := filepath.Join(home, f.name)
		_ = os.WriteFile(path, []byte(f.body), 0o600)
		env, err := dshModelSetup("en", "whale", "", nil)
		if err != nil || len(env) != 0 {
			t.Fatalf("%s: env=%v err=%v", f.name, env, err)
		}
		_ = os.Remove(path)
	}
}
