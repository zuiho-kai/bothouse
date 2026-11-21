package devin

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/BurntSushi/toml"
	"github.com/chenhg5/cc-connect/core"
)

const devinStatusPath = "/exa.seat_management_pb.SeatManagementService/GetUserStatus"

// Source: the existing accountquota client uses the same response bound.
const devinMaxResponse = 4 << 20

type devinCredentials struct {
	APIKey    string `toml:"windsurf_api_key"`
	APIServer string `toml:"api_server_url"`
}

type devinPlanInfo struct {
	Name       string `json:"planName"`
	Billing    string `json:"billingStrategy"`
	HideDaily  bool   `json:"hideDailyQuota"`
	HideWeekly bool   `json:"hideWeeklyQuota"`
}

type devinPlanStatus struct {
	Info            *devinPlanInfo `json:"planInfo"`
	DailyRemaining  int            `json:"dailyQuotaRemainingPercent"`
	WeeklyRemaining int            `json:"weeklyQuotaRemainingPercent"`
	DailyReset      int64          `json:"dailyQuotaResetAtUnix,string"`
	WeeklyReset     int64          `json:"weeklyQuotaResetAtUnix,string"`
}

type devinUserStatus struct {
	User *struct {
		ID   string           `json:"userId"`
		Team string           `json:"teamId"`
		Plan *devinPlanStatus `json:"planStatus"`
	} `json:"userStatus"`
	Info *devinPlanInfo `json:"planInfo"`
}

// Devin supplies account quota via its native client endpoint. ACP usage_update
// and CLI /usage describe session consumption and are not remaining allowance.
func (a *Agent) SupportsUsageReporting() bool { return true }

func (a *Agent) GetUsage(ctx context.Context) (*core.UsageReport, error) {
	return a.GetUsageForModel(ctx, "")
}

// Devin's plan allowance is shared by models; shadow ACP's Cursor-only method.
func (a *Agent) GetUsageForModel(ctx context.Context, _ string) (*core.UsageReport, error) {
	env := a.UsageEnvironment()
	credentials, err := readDevinCredentials(env)
	if err != nil {
		return nil, err
	}
	cmd := exec.CommandContext(ctx, a.quotaCommand, "--version")
	cmd.Env = env
	raw, err := cmd.Output()
	if err != nil {
		return nil, errors.New("devin quota: could not read CLI version")
	}
	version := strings.Fields(string(raw))
	// Source: official CLI output is "devin <version> (<commit>)".
	if len(version) < 2 || version[0] != "devin" {
		return nil, errors.New("devin quota: invalid CLI version")
	}
	// Source: accountquota's existing HTTP timeout; the caller also bounds ctx.
	client := &http.Client{Timeout: 10 * time.Second}
	return fetchDevinUsage(ctx, client, credentials, version[1])
}

func readDevinCredentials(env []string) (devinCredentials, error) {
	values := make(map[string]string)
	for _, pair := range env {
		k, v, _ := strings.Cut(pair, "=")
		values[k] = v
	}
	if values["WINDSURF_API_KEY"] != "" {
		// An environment key overrides the login file, but does not identify its
		// tenant endpoint. Do not send it to the public service or a stale login.
		return devinCredentials{}, errors.New("devin quota: environment key has no verified API endpoint")
	}
	var credentials devinCredentials
	// Source: docs.devin.ai/cli/enterprise/devin-auth#credentials-file-location.
	dir := values["XDG_DATA_HOME"]
	if runtime.GOOS == "windows" {
		dir = values["APPDATA"]
	} else if dir == "" && values["HOME"] != "" {
		dir = filepath.Join(values["HOME"], ".local", "share")
	}
	if dir == "" {
		return devinCredentials{}, errors.New("devin quota: login credentials unavailable")
	}
	raw, err := os.ReadFile(filepath.Join(dir, "devin", "credentials.toml"))
	if err != nil {
		return devinCredentials{}, errors.New("devin quota: login credentials unavailable")
	}
	if toml.Unmarshal(raw, &credentials) != nil || strings.TrimSpace(credentials.APIKey) == "" || strings.TrimSpace(credentials.APIServer) == "" {
		return devinCredentials{}, errors.New("devin quota: invalid login credentials")
	}
	return credentials, nil
}

func fetchDevinUsage(ctx context.Context, client *http.Client, credentials devinCredentials, version string) (*core.UsageReport, error) {
	// Source: metadata tuple used by the installed official Devin CLI. The
	// endpoint gates CLI access on ideType and version, not only on the API key.
	body, err := json.Marshal(map[string]any{"metadata": map[string]string{
		"ideName": "devin-cli", "ideType": "chisel", "ideVersion": version,
		"extensionName": "chisel", "extensionVersion": version,
		"apiKey": credentials.APIKey, "locale": "en", "os": runtime.GOOS,
	}})
	if err != nil {
		return nil, fmt.Errorf("devin quota: encode request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(credentials.APIServer, "/")+devinStatusPath, bytes.NewReader(body))
	if err != nil {
		return nil, errors.New("devin quota: invalid API endpoint")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Connect-Protocol-Version", "1")
	// A redirect must never forward the credential contained in the POST body.
	c := *client
	c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	response, err := c.Do(req)
	if err != nil {
		return nil, errors.New("devin quota: request failed or timed out")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("devin quota: provider returned HTTP %d", response.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, devinMaxResponse+1))
	if err != nil || len(raw) > devinMaxResponse {
		return nil, errors.New("devin quota: response could not be read")
	}
	var status devinUserStatus
	if json.Unmarshal(raw, &status) != nil {
		return nil, errors.New("devin quota: invalid provider response")
	}
	return status.report(time.Now())
}

func (s devinUserStatus) report(now time.Time) (*core.UsageReport, error) {
	if s.User == nil || s.User.Plan == nil {
		return nil, errors.New("devin quota: account plan unavailable")
	}
	p := s.User.Plan
	info := s.Info
	if info == nil {
		info = p.Info
	}
	if info == nil || info.Billing != "BILLING_STRATEGY_QUOTA" {
		return nil, errors.New("devin quota: account has no subscription quota")
	}
	report := &core.UsageReport{ObservedAt: now, Provider: "Devin", AccountID: s.User.Team, UserID: s.User.ID, Plan: info.Name}
	// Source: official plan docs define calendar-day and calendar-week windows.
	const daySeconds = 24 * 60 * 60
	const weekSeconds = 7 * daySeconds // Source: seven calendar days per week.
	for _, quota := range []struct {
		name      string
		remaining int
		reset     int64
		hidden    bool
		seconds   int
	}{
		{"Daily", p.DailyRemaining, p.DailyReset, info.HideDaily, daySeconds},
		{"Weekly", p.WeeklyRemaining, p.WeeklyReset, info.HideWeekly, weekSeconds},
	} {
		if quota.hidden || quota.reset <= 0 {
			continue
		}
		// Source: the official fields are remaining percentages in [0, 100].
		if quota.remaining < 0 || quota.remaining > 100 {
			return nil, errors.New("devin quota: invalid remaining percentage")
		}
		window := core.UsageWindow{
			Name: quota.name, UsedPercent: 100 - quota.remaining, WindowSeconds: quota.seconds,
			ResetAtUnix: quota.reset, ResetAfterSeconds: max(0, int(quota.reset-now.Unix())),
		}
		report.Buckets = append(report.Buckets, core.UsageBucket{
			ID: strings.ToLower(quota.name), Name: quota.name, Allowed: quota.remaining > 0,
			LimitReached: quota.remaining == 0, Windows: []core.UsageWindow{window},
		})
	}
	if len(report.Buckets) == 0 {
		return nil, errors.New("devin quota: no visible quota windows")
	}
	return report, nil
}
