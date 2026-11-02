package antigravity

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// Source: the native quota decoder and recorded retrieveUserQuotaSummary
// fixtures in usage(_cloud)_test.go. Gemini Flash/Pro share a pool; Claude/GPT
// share another. Argon is separate only when the provider advertises it.
func quotaGroupForModel(model string, argon bool) string {
	model, _, _ = strings.Cut(strings.TrimSpace(model), "[")
	switch {
	case argon && strings.HasPrefix(model, "gemini-4-argon"):
		return "gemini-argon-"
	case strings.HasPrefix(model, "gemini-"):
		return "gemini-"
	case isThirdPartyModel(model):
		return "3p-"
	default:
		return ""
	}
}

func (a *Agent) QuotaScope(model string) (string, string) {
	model = a.usageModel(model)
	a.mu.RLock()
	q := a.quota
	a.mu.RUnlock()
	argon := false
	if q != nil {
		q.mu.Lock()
		if q.cached != nil {
			for _, group := range q.cached.QuotaGroups {
				argon = argon || group == "gemini-argon-"
			}
		}
		q.mu.Unlock()
	}
	a.cloudQuota.mu.Lock()
	home := a.cloudQuota.homeDir
	if r := a.cloudQuota.report; r != nil {
		for _, b := range r.Buckets {
			argon = argon || b.QuotaGroup == "gemini-argon-"
		}
	}
	a.cloudQuota.mu.Unlock()
	if home == "" {
		home, _ = os.UserHomeDir()
	}
	account := filepath.Join(home, ".gemini", "antigravity-cli")
	// Stable OAuth subject, not the rotating access token. This is only an
	// identity hint for local quota attribution, never authentication.
	if raw, err := os.ReadFile(filepath.Join(account, "antigravity-oauth-token")); err == nil {
		var token struct {
			IDToken string `json:"id_token"`
		}
		if json.Unmarshal(raw, &token) == nil {
			parts := strings.Split(token.IDToken, ".")
			if len(parts) == 3 {
				payload, err := base64.RawURLEncoding.DecodeString(parts[1])
				var claims struct {
					Subject string `json:"sub"`
				}
				if err == nil && json.Unmarshal(payload, &claims) == nil && claims.Subject != "" {
					account = claims.Subject
				}
			}
		}
	}
	return account, quotaGroupForModel(model, argon)
}
