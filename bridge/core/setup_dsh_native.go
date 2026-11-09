package core

import (
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// dshProfileDirFor is the profile a wizard route writes to and reads its model selection from: the
// desktop app keeps profiles/desktop (setup_dsh_desktop.go), while an empty target and "web" both
// mean the profile install.sh sets up.
func dshProfileDirFor(target string) string {
	if target == DSHDesktopProfile {
		return dshDesktopProfileDir()
	}
	return filepath.Join(dshHome(), "profiles", DSHProfile)
}

// dshNativeModelConfigured checks the selected credential of the profile this route uses (target,
// as in DSHConfigureRequest.Target), not network availability. Native collab members inherit
// agent-default-model at runtime.
func dshNativeModelConfigured(target, officialKey string) bool {
	layers := []string{filepath.Join(dshProfileDirFor(target), "cordis.patch.yml"), filepath.Join(dshHome(), "cordis.patch.yml")}
	config := func(id string) *yaml.Node {
		var selected *yaml.Node
		for _, layer := range layers {
			if c := dshPatchEntryConfig(layer, id); c != nil {
				selected = c
			}
		}
		return selected
	}
	// Source: the Harness base profile selects deepseek-official by default.
	provider := "deepseek-official"
	if c := config("agent-default-model"); c != nil {
		if v := mapGet(c, "provider"); v != nil {
			provider = v.Value
		}
	}
	if provider == "deepseek-account" {
		// Source: deepseek-account-platform owns the default grant; its device
		// identity is not a login. Presence does not prove token validity or quota.
		b, err := os.ReadFile(filepath.Join(dshHome(), ".credentials.yaml"))
		if err != nil {
			return false
		}
		var doc struct {
			Records map[string]yaml.Node
		}
		if yaml.Unmarshal(b, &doc) != nil {
			return false
		}
		record := doc.Records["deepseek-account-platform/default"]
		kind, payload := mapGet(&record, "kind"), mapGet(&record, "payload")
		if kind == nil || kind.Value != "grant" || payload == nil || payload.Kind != yaml.MappingNode {
			return false
		}
		token := mapGet(payload, "token")
		return token != nil && token.Kind == yaml.ScalarNode && token.Value != ""
	}
	keyEnv := "DEEPSEEK_API_KEY"
	if provider == "deepseek-official" {
		if c := config("llm-deepseek"); c != nil {
			if v := mapGet(c, "apiKeyEnv"); v != nil {
				keyEnv = v.Value
			}
		}
	} else {
		c := config("llm-pi-ai")
		if c == nil {
			return false
		}
		providers := mapGet(c, "providers")
		if providers == nil || providers.Kind != yaml.MappingNode {
			return false
		}
		route := mapGet(providers, provider)
		if route == nil || route.Kind != yaml.MappingNode {
			return false
		}
		ref := mapGet(route, "apiKeyEnv")
		if ref == nil || strings.TrimSpace(ref.Value) == "" {
			return false
		}
		keyEnv = ref.Value
	}
	if keyEnv == "DEEPSEEK_API_KEY" && strings.TrimSpace(officialKey) != "" {
		return true
	}
	refs, _ := dshCredentials(dshHome())
	return refs[keyEnv] != "" || os.Getenv(keyEnv) != "" || dshDotenvHas(dshHome(), keyEnv)
}
