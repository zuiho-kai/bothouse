package claudecode

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// quotaAuthTimeout bounds the account query. Source: the same 10s probe bound
// used for agent verification in session.go.
const quotaAuthTimeout = 10 * time.Second

// authStatus is the account shape reported by `claude auth status`. Only the
// non-secret identifiers take part in the quota identity; tokens never do.
type authStatus struct {
	LoggedIn    bool   `json:"loggedIn"`
	AuthMethod  string `json:"authMethod"`
	ApiProvider string `json:"apiProvider"`
	Email       string `json:"email"`
	OrgID       string `json:"orgId"`
}

// readAuthStatus runs the CLI's own account query in the agent's real
// environment, so a CLAUDE_CONFIG_DIR/HOME override asks about the account the
// agent will actually use. Tests replace it.
var readAuthStatus = func(env []string, configDir string) (authStatus, error) {
	ctx, cancel := context.WithTimeout(context.Background(), quotaAuthTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "claude", "auth", "status")
	cmd.Env = env
	if configDir != "" {
		cmd.Dir = configDir
	}
	out, err := cmd.Output()
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
// Zero means "unknown", and an unknown stamp is never cached.
// Source: measured on this machine 2026-11-02 - the default config dir holds no
// credentials file while the login keychain item "Claude Code-credentials"
// exists. A custom config dir is therefore looked for on disk, and the keychain
// is consulted only for the default one: the CLI keeps a per-directory store,
// so assuming the global keychain for every directory would report the wrong
// account.
var credentialStamp = defaultCredentialStamp

func defaultCredentialStamp(configDir string) int64 {
	if info, err := os.Stat(filepath.Join(configDir, ".credentials.json")); err == nil {
		return info.ModTime().UnixNano()
	}
	if !isDefaultConfigDir(configDir) {
		return 0
	}
	return keychainStamp()
}

// keychainStamp reads the login-keychain item's modification date. It is a seam
// so tests can exercise the default-directory rule without a real keychain.
var keychainStamp = func() int64 {
	ctx, cancel := context.WithTimeout(context.Background(), quotaAuthTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, "security", "find-generic-password", "-s", "Claude Code-credentials").Output()
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

func isDefaultConfigDir(dir string) bool {
	home, err := os.UserHomeDir()
	if err != nil {
		return false
	}
	return filepath.Clean(dir) == filepath.Join(home, ".claude")
}

type cachedAccount struct {
	identity string
	stamp    int64
}

// accountCache is keyed by config directory and invalidated by the stamp, so a
// newer login is picked up on the next admission check instead of keeping the
// old account for the life of the process.
var accountCache sync.Map

func currentAccountIdentity(env []string, configDir string) string {
	stamp := credentialStamp(configDir)
	if stamp != 0 {
		if hit, ok := accountCache.Load(configDir); ok {
			if entry, ok := hit.(cachedAccount); ok && entry.stamp == stamp {
				return entry.identity
			}
		}
	}
	st, err := readAuthStatus(env, configDir)
	identity := "unknown"
	if err == nil && st.LoggedIn {
		if key := accountKey(st); key != "" {
			identity = key
		}
	}
	// A failed or unattributed query is never cached: a transient failure must
	// be retried, not frozen for as long as the credential stamp holds.
	if stamp != 0 && identity != "unknown" {
		accountCache.Store(configDir, cachedAccount{identity: identity, stamp: stamp})
	}
	return identity
}

// accountKey hashes the account's non-secret identifiers. Hashing keeps the
// quota scope free of addresses and organization ids. The config directory is
// deliberately not part of it: one account's allowance is the same wherever its
// credentials point, so two directories must not split into two pools.
//
// Both the address and the organization are required: either one alone is not
// proven to identify an allowance, so a partial answer stays unattributed
// instead of being trusted as a known account.
func accountKey(st authStatus) string {
	email := strings.ToLower(strings.TrimSpace(st.Email))
	org := strings.ToLower(strings.TrimSpace(st.OrgID))
	if email == "" || org == "" {
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
		return currentAccountIdentity(env, root), "account"
	}
	b, _ := json.Marshal(identity)
	return string(b), "account"
}
