package claudecode

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"github.com/chenhg5/cc-connect/core"
)

// authStatus is the account shape reported by `claude auth status`. Only the
// non-secret identifiers take part in the quota identity; tokens never do.
type authStatus struct {
	LoggedIn        bool   `json:"loggedIn"`
	AuthMethod      string `json:"authMethod"`
	ApiProvider     string `json:"apiProvider"`
	ConfigDirectory string `json:"configDirectory"`
	Email           string `json:"email"`
	OrgID           string `json:"orgId"`
}

// readAuthStatus runs the CLI's own account query. Tests replace it.
var readAuthStatus = func() (authStatus, error) {
	out, err := exec.Command("claude", "auth", "status").Output()
	if err != nil {
		return authStatus{}, err
	}
	var st authStatus
	if err := json.Unmarshal(out, &st); err != nil {
		return authStatus{}, err
	}
	return st, nil
}

type cachedAccount struct {
	identity string
	stamp    int64
}

// accountCache is keyed by the config directory. The stamp is the directory
// mtime, so the entry is re-read whenever the CLI rewrites its credentials.
// Source: no fixed TTL is used; the credentials directory itself is the
// invalidation signal, so a same-directory account switch is seen at once and
// a same-account token refresh re-reads to the same identity.
var accountCache sync.Map

func cachedAccountIdentity(dir string) string {
	stamp := int64(0)
	if info, err := os.Stat(dir); err == nil {
		stamp = info.ModTime().UnixNano()
	}
	if hit, ok := accountCache.Load(dir); ok {
		if entry, ok := hit.(cachedAccount); ok && entry.stamp == stamp {
			return entry.identity
		}
	}
	st, err := readAuthStatus()
	identity := "unknown"
	if err == nil && st.LoggedIn {
		if key := accountKey(st); key != "" {
			identity = key
		}
	}
	accountCache.Store(dir, cachedAccount{identity: identity, stamp: stamp})
	return identity
}

// accountKey hashes the account's non-secret identifiers. Hashing keeps the
// quota scope free of addresses and organization ids while still changing
// when the logged-in account changes.
func accountKey(st authStatus) string {
	parts := []string{
		strings.ToLower(strings.TrimSpace(st.Email)),
		strings.ToLower(strings.TrimSpace(st.OrgID)),
		strings.ToLower(strings.TrimSpace(st.ApiProvider)),
	}
	if parts[0] == "" && parts[1] == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	// Truncated only to keep state files readable; this is an identity label,
	// not a security boundary.
	return "acct:" + hex.EncodeToString(sum[:8])
}

// QuotaScope follows the same credential environment and OS-user isolation as
// StartSession. Model IDs have no proven separate allowance here.
func (a *Agent) QuotaScope(string) (string, string) {
	a.mu.RLock()
	runAs := a.spawnOpts.RunAsUser
	env := core.MergeEnv(os.Environ(), a.runtimeEnvLocked())
	a.mu.RUnlock()
	if runAs != "" {
		// Another OS user's credentials are not the supervisor's: that stays a
		// separate bucket rather than inheriting this process's account.
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
		// The directory alone cannot tell two accounts apart: the CLI keeps the
		// logged-in account inside it, so a same-directory switch must change
		// the scope or the old account's cooldown keeps blocking the new one.
		return root + "|" + cachedAccountIdentity(root), "account"
	}
	b, _ := json.Marshal(identity)
	return string(b), "account"
}
