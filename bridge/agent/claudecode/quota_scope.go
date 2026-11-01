package claudecode

import (
	"crypto/sha256"
	"encoding/binary"
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
	LoggedIn    bool   `json:"loggedIn"`
	AuthMethod  string `json:"authMethod"`
	ApiProvider string `json:"apiProvider"`
	Email       string `json:"email"`
	OrgID       string `json:"orgId"`
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

// credentialStamp reports when the CLI last wrote the account it is logged into.
// The account is not in the config directory: on macOS the credentials live in
// the login keychain and ~/.claude holds no credentials file, so the directory
// mtime never moves when the user switches accounts.
// Zero means "unknown", and an unknown stamp is never cached.
// Source: measured on this machine 2026-11-02 - the keychain item
// "Claude Code-credentials" exists (mdat readable) and ~/.claude has none.
var credentialStamp = func(configDir string) int64 {
	if info, err := os.Stat(filepath.Join(configDir, ".credentials.json")); err == nil {
		return info.ModTime().UnixNano()
	}
	out, err := exec.Command("security", "find-generic-password", "-s", "Claude Code-credentials").Output()
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(out), "\n") {
		if !strings.Contains(line, `"mdat"`) {
			continue
		}
		sum := sha256.Sum256([]byte(strings.TrimSpace(line)))
		return int64(binary.BigEndian.Uint64(sum[:8]))
	}
	return 0
}

type cachedAccount struct {
	identity string
	stamp    int64
}

// accountCache is keyed by config directory and invalidated by the stamp, so a
// newer login is picked up on the next admission check instead of keeping the
// old account for the life of the process.
var accountCache sync.Map

func currentAccountIdentity(configDir string) string {
	stamp := credentialStamp(configDir)
	if stamp != 0 {
		if hit, ok := accountCache.Load(configDir); ok {
			if entry, ok := hit.(cachedAccount); ok && entry.stamp == stamp {
				return entry.identity
			}
		}
	}
	st, err := readAuthStatus()
	identity := "unknown"
	if err == nil && st.LoggedIn {
		if key := accountKey(st); key != "" {
			identity = key
		}
	}
	if stamp != 0 {
		accountCache.Store(configDir, cachedAccount{identity: identity, stamp: stamp})
	}
	return identity
}

// accountKey hashes the account's non-secret identifiers. Hashing keeps the
// quota scope free of addresses and organization ids. The config directory is
// deliberately not part of it: one account's allowance is the same wherever its
// credentials point, so two directories must not split into two pools.
func accountKey(st authStatus) string {
	email := strings.ToLower(strings.TrimSpace(st.Email))
	org := strings.ToLower(strings.TrimSpace(st.OrgID))
	if email == "" && org == "" {
		return ""
	}
	parts := []string{email, org, strings.ToLower(strings.TrimSpace(st.ApiProvider))}
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
		// The directory only locates the credentials; it does not name the
		// account stored in them.
		return currentAccountIdentity(root), "account"
	}
	b, _ := json.Marshal(identity)
	return string(b), "account"
}
