package codex

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/chenhg5/cc-connect/core"
)

const codexUsageURL = "https://chatgpt.com/backend-api/wham/usage"

type codexOAuthTokens struct {
	AccessToken string
	AccountID   string
}

type codexUsageResponse struct {
	UserID              string             `json:"user_id"`
	AccountID           string             `json:"account_id"`
	Email               string             `json:"email"`
	PlanType            string             `json:"plan_type"`
	RateLimit           *codexUsageBucket  `json:"rate_limit"`
	CodeReviewRateLimit *codexUsageBucket  `json:"code_review_rate_limit"`
	Credits             *codexUsageCredits `json:"credits"`
}

type codexUsageBucket struct {
	Allowed         bool              `json:"allowed"`
	LimitReached    bool              `json:"limit_reached"`
	PrimaryWindow   *codexUsageWindow `json:"primary_window"`
	SecondaryWindow *codexUsageWindow `json:"secondary_window"`
}

type codexUsageWindow struct {
	UsedPercent        int   `json:"used_percent"`
	LimitWindowSeconds int   `json:"limit_window_seconds"`
	ResetAfterSeconds  int   `json:"reset_after_seconds"`
	ResetAt            int64 `json:"reset_at"`
}

type codexUsageCredits struct {
	HasCredits bool `json:"has_credits"`
	Unlimited  bool `json:"unlimited"`
	Balance    any  `json:"balance"`
}

func (a *Agent) GetUsage(ctx context.Context) (*core.UsageReport, error) {
	tokens, err := a.readOAuthTokens(os.ReadFile)
	if err != nil {
		return nil, err
	}
	return a.fetchUsage(ctx, http.DefaultClient, tokens)
}

// SupportsUsageReporting implements core.UsageCapability: the account quota
// exists only when this agent's CODEX_HOME holds a ChatGPT login. A relay or
// API-key home has none, and the process's own ~/.codex may be another
// account, so the footer must not fall back to it.
func (a *Agent) SupportsUsageReporting() bool {
	_, err := a.readOAuthTokens(os.ReadFile)
	return err == nil
}

// usageCodexHome is the CODEX_HOME this agent's sessions run with: the
// codex_home option, else CODEX_HOME in the agent env, else the process's.
func (a *Agent) usageCodexHome() (string, error) {
	a.mu.RLock()
	home := a.codexHome
	env := append(append([]string(nil), a.configEnv...), a.sessionEnv...)
	a.mu.RUnlock()
	if home != "" {
		return home, nil
	}
	return resolveCodexHome(env)
}

func (a *Agent) readOAuthTokens(readFile func(string) ([]byte, error)) (codexOAuthTokens, error) {
	home, err := a.usageCodexHome()
	if err != nil {
		return codexOAuthTokens{}, err
	}
	return readCodexOAuthTokens(readFile, filepath.Join(home, "auth.json"))
}

func readCodexOAuthTokens(readFile func(string) ([]byte, error), path string) (codexOAuthTokens, error) {
	data, err := readFile(path)
	if err != nil {
		return codexOAuthTokens{}, fmt.Errorf("read %s: %w", path, err)
	}

	var payload struct {
		Tokens struct {
			AccessToken string `json:"access_token"`
			AccountID   string `json:"account_id"`
		} `json:"tokens"`
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		return codexOAuthTokens{}, fmt.Errorf("parse auth.json: %w", err)
	}
	if strings.TrimSpace(payload.Tokens.AccessToken) == "" {
		return codexOAuthTokens{}, fmt.Errorf("auth.json missing tokens.access_token")
	}
	if strings.TrimSpace(payload.Tokens.AccountID) == "" {
		return codexOAuthTokens{}, fmt.Errorf("auth.json missing tokens.account_id")
	}

	return codexOAuthTokens{
		AccessToken: payload.Tokens.AccessToken,
		AccountID:   payload.Tokens.AccountID,
	}, nil
}

func (a *Agent) fetchUsage(ctx context.Context, client *http.Client, tokens codexOAuthTokens) (*core.UsageReport, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, codexUsageURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+tokens.AccessToken)
	req.Header.Set("ChatGPT-Account-Id", tokens.AccountID)
	req.Header.Set("User-Agent", "codex-cli")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request usage endpoint: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("usage endpoint returned status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var payload codexUsageResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode usage response: %w", err)
	}

	return mapCodexUsage(payload), nil
}

func mapCodexUsage(payload codexUsageResponse) *core.UsageReport {
	report := &core.UsageReport{
		Provider:  "codex",
		AccountID: payload.AccountID,
		UserID:    payload.UserID,
		Email:     payload.Email,
		Plan:      payload.PlanType,
	}

	if payload.RateLimit != nil {
		report.Buckets = append(report.Buckets, core.UsageBucket{
			Name:         "Rate limit",
			Allowed:      payload.RateLimit.Allowed,
			LimitReached: payload.RateLimit.LimitReached,
			Windows:      mapCodexUsageWindows(payload.RateLimit),
		})
	}
	if payload.CodeReviewRateLimit != nil {
		report.Buckets = append(report.Buckets, core.UsageBucket{
			Name:         "Code review",
			Allowed:      payload.CodeReviewRateLimit.Allowed,
			LimitReached: payload.CodeReviewRateLimit.LimitReached,
			Windows:      mapCodexUsageWindows(payload.CodeReviewRateLimit),
		})
	}
	if payload.Credits != nil {
		report.Credits = &core.UsageCredits{
			HasCredits: payload.Credits.HasCredits,
			Unlimited:  payload.Credits.Unlimited,
		}
		if payload.Credits.Balance != nil {
			report.Credits.Balance = fmt.Sprintf("%v", payload.Credits.Balance)
		}
	}

	return report
}

func mapCodexUsageWindows(bucket *codexUsageBucket) []core.UsageWindow {
	if bucket == nil {
		return nil
	}
	var windows []core.UsageWindow
	if bucket.PrimaryWindow != nil {
		windows = append(windows, core.UsageWindow{
			Name:              "Primary",
			UsedPercent:       bucket.PrimaryWindow.UsedPercent,
			WindowSeconds:     bucket.PrimaryWindow.LimitWindowSeconds,
			ResetAfterSeconds: bucket.PrimaryWindow.ResetAfterSeconds,
			ResetAtUnix:       bucket.PrimaryWindow.ResetAt,
		})
	}
	if bucket.SecondaryWindow != nil {
		windows = append(windows, core.UsageWindow{
			Name:              "Secondary",
			UsedPercent:       bucket.SecondaryWindow.UsedPercent,
			WindowSeconds:     bucket.SecondaryWindow.LimitWindowSeconds,
			ResetAfterSeconds: bucket.SecondaryWindow.ResetAfterSeconds,
			ResetAtUnix:       bucket.SecondaryWindow.ResetAt,
		})
	}
	return windows
}

// SupportsUsageReporting implements core.UsageCapability for an app-server
// session (always a local codex process on this CODEX_HOME): account/rateLimits
// only answers for a ChatGPT login, so a relay/API-key home skips the
// per-reply probe instead of waiting on it.
func (s *appServerSession) SupportsUsageReporting() bool {
	home := s.codexHome
	if home == "" {
		var err error
		if home, err = resolveCodexHome(s.extraEnv); err != nil {
			return false
		}
	}
	_, err := readCodexOAuthTokens(os.ReadFile, filepath.Join(home, "auth.json"))
	return err == nil
}
