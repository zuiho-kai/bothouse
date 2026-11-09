package core

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/chenhg5/cc-connect/tests/testutil"
)

func TestDSHNativeModelConfiguredSources(t *testing.T) {
	gateway := "- id: llm-pi-ai\n  config:\n    providers:\n      fixture-deepseek:\n        apiKeyEnv: FIXTURE_DSH_NATIVE_KEY\n- id: agent-default-model\n  config:\n    provider: fixture-deepseek\n    model: fixture-model\n"
	account := "- id: agent-default-model\n  config:\n    provider: deepseek-account\n    model: fixture-model\n"
	grant := "version: 1\nrecords:\n  deepseek-account-platform/default:\n    kind: grant\n    payload: {version: 1, token: fixture-token, issuer: 'https://platform.deepseek.com'}\n"
	for _, tc := range []struct {
		name, target, profile, desktopProfile, root, credential, dotenv, env, suppliedKey string
		want                                                                              bool
	}{
		{name: "official missing"},
		{name: "official supplied", suppliedKey: "fixture-official", want: true},
		{name: "gateway stored", profile: gateway, credential: "version: 1\nrefs:\n  FIXTURE_DSH_NATIVE_KEY: fixture-key\n", want: true},
		{name: "gateway dotenv", profile: gateway, dotenv: "FIXTURE_DSH_NATIVE_KEY=fixture-key\n", want: true},
		{name: "gateway environment", profile: gateway, env: "fixture-key", want: true},
		{name: "unrelated official key", profile: gateway, credential: "version: 1\nrefs:\n  DEEPSEEK_API_KEY: fixture-official\n"},
		{name: "supplied official key cannot repair selected gateway", profile: gateway, suppliedKey: "fixture-official"},
		{name: "unknown selected provider", profile: "- id: agent-default-model\n  config: {provider: missing-provider}\n", suppliedKey: "fixture-official"},
		{name: "home selection overrides profile", profile: gateway, root: "- id: agent-default-model\n  config: {provider: deepseek-official}\n", suppliedKey: "fixture-official", want: true},
		{name: "selected account grant", profile: account, credential: grant, want: true},
		{name: "account is not official key", credential: grant},
		{name: "account device is not login", profile: account, credential: "version: 1\nrecords:\n  deepseek-account-platform/device: {kind: grant, payload: {id: fixture-device}}\n"},
		{name: "account without token", profile: account, credential: "version: 1\nrecords:\n  deepseek-account-platform/default: {kind: grant, payload: {version: 1}}\n"},
		{name: "other opaque records do not hide account", profile: account, credential: grant + "  other/default: {kind: grant, payload: opaque}\n", want: true},
		// review of #952 (d): the desktop route keeps its own profile; the web selection must not stand in.
		{name: "desktop profile selects the gateway", target: DSHDesktopProfile, desktopProfile: gateway, credential: "version: 1\nrefs:\n  FIXTURE_DSH_NATIVE_KEY: fixture-key\n", want: true},
		{name: "desktop route ignores the web selection", target: DSHDesktopProfile, profile: gateway, credential: "version: 1\nrefs:\n  FIXTURE_DSH_NATIVE_KEY: fixture-key\n"},
		{name: "web route ignores the desktop selection", desktopProfile: gateway, credential: "version: 1\nrefs:\n  FIXTURE_DSH_NATIVE_KEY: fixture-key\n"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			home := t.TempDir()
			testutil.SetHome(t, home)
			t.Setenv("DSH_HOME", filepath.Join(home, ".dsh"))
			t.Setenv("DEEPSEEK_API_KEY", "")
			t.Setenv("FIXTURE_DSH_NATIVE_KEY", tc.env)
			for name, content := range map[string]string{
				filepath.Join("profiles", DSHProfile, "cordis.patch.yml"):        tc.profile,
				filepath.Join("profiles", DSHDesktopProfile, "cordis.patch.yml"): tc.desktopProfile,
				"cordis.patch.yml": tc.root, ".credentials.yaml": tc.credential, ".env": tc.dotenv,
			} {
				if content == "" {
					continue
				}
				p := filepath.Join(dshHome(), name)
				if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(p, []byte(content), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			if got := dshNativeModelConfigured(tc.target, tc.suppliedKey); got != tc.want {
				t.Fatalf("configured=%v, want %v", got, tc.want)
			}
		})
	}
}
