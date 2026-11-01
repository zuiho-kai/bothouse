package claudecode

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	"github.com/chenhg5/cc-connect/core"
)

// QuotaScope follows the same credential environment and OS-user isolation as
// StartSession. Model IDs have no proven separate allowance here.
func (a *Agent) QuotaScope(string) (string, string) {
	a.mu.RLock()
	runAs := a.spawnOpts.RunAsUser
	env := core.MergeEnv(os.Environ(), a.runtimeEnvLocked())
	a.mu.RUnlock()
	if runAs != "" {
		return "os-user:" + runAs, "account"
	}
	values := map[string]string{}
	for _, entry := range env {
		key, value, _ := strings.Cut(entry, "=")
		values[key] = value
	}
	identity := map[string]string{}
	// Source: credential/routing keys managed by providerEnvLocked. Model and
	// display-name keys from that larger set do not identify an allowance.
	for _, key := range []string{"ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "AWS_BEARER_TOKEN_BEDROCK", "ANTHROPIC_FOUNDRY_API_KEY", "ANTHROPIC_BASE_URL", "ANTHROPIC_VERTEX_PROJECT_ID", "ANTHROPIC_FOUNDRY_RESOURCE"} {
		if value := values[key]; value != "" {
			identity[key] = value
		}
	}
	if len(identity) == 0 {
		root := values["CLAUDE_CONFIG_DIR"]
		if root == "" {
			root = filepath.Join(values["HOME"], ".claude")
		}
		return root, "account"
	}
	b, _ := json.Marshal(identity)
	return string(b), "account"
}
