package accountquota

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

const cursorEndpoint = "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage"

type cursorUsage struct {
	BillingCycleStart string   `json:"billingCycleStart"`
	BillingCycleEnd   string   `json:"billingCycleEnd"`
	AutoBucketModels  []string `json:"autoBucketModels"`
	PlanUsage         *struct {
		AutoPercentUsed  *float64 `json:"autoPercentUsed"`
		APIPercentUsed   *float64 `json:"apiPercentUsed"`
		TotalPercentUsed *float64 `json:"totalPercentUsed"`
		Limit            *float64 `json:"limit"`
		Remaining        *float64 `json:"remaining"`
	} `json:"planUsage"`
}

// Cursor uses the authenticated CLI account, not context-token percentages.
func Cursor(ctx context.Context, env []string, model string) (*core.UsageReport, error) {
	if envValue(env, "CURSOR_API_KEY") != "" {
		return nil, ErrUnsupportedAuth
	}
	if base := envValue(env, "CURSOR_API_BASE_URL"); base != "" && strings.TrimRight(base, "/") != "https://api2.cursor.sh" {
		return nil, ErrUnsupportedAuth
	}
	token, err := cursorToken(ctx, env)
	if err != nil {
		return nil, err
	}
	client := cursorHTTPClient(ctx, env)
	defer client.CloseIdleConnections()
	return fetchCursor(ctx, client, cursorEndpoint, token, model)
}

func cursorToken(ctx context.Context, env []string) (string, error) {
	if canUseKeychain(env) {
		if b, err := readKeychain(ctx, "cursor-access-token", "cursor-user"); err == nil && len(b) > 0 {
			return string(b), nil
		}
	}
	root := home(env)
	if root == "" {
		return "", ErrNoCredentials
	}
	path := filepath.Join(root, ".cursor", "auth.json")
	switch runtime.GOOS {
	case "linux":
		dir := envValue(env, "XDG_CONFIG_HOME")
		if dir == "" {
			dir = filepath.Join(root, ".config")
		}
		path = filepath.Join(dir, "cursor", "auth.json")
	case "windows":
		path = filepath.Join(envValue(env, "APPDATA"), "Cursor", "auth.json")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", ErrNoCredentials
	}
	var auth struct {
		AccessToken string `json:"accessToken"`
		APIKey      string `json:"apiKey"`
	}
	if json.Unmarshal(raw, &auth) != nil {
		return "", ErrNoCredentials
	}
	if auth.APIKey != "" {
		return "", ErrUnsupportedAuth
	}
	if strings.TrimSpace(auth.AccessToken) == "" {
		return "", ErrNoCredentials
	}
	return auth.AccessToken, nil
}

func fetchCursor(ctx context.Context, client *http.Client, endpoint, token, model string) (*core.UsageReport, error) {
	var data cursorUsage
	if err := post(ctx, client, endpoint, token, "bothouse-quota", []byte("{}"), &data); err != nil {
		return nil, err
	}
	return data.report(model)
}

func (d cursorUsage) report(model string) (*core.UsageReport, error) {
	model, _, _ = strings.Cut(strings.TrimSpace(model), "[")
	if model == "auto" {
		model = "default"
	}
	p := d.PlanUsage
	if p == nil {
		return nil, nil
	}
	var used *float64
	bucket := "plan"
	if p.AutoPercentUsed != nil || p.APIPercentUsed != nil {
		// The API supplies membership. Without it or an active model, a blended
		// total cannot tell us what the selected model can still spend.
		if strings.TrimSpace(model) == "" || d.AutoBucketModels == nil {
			return nil, nil
		}
		auto := false
		for _, id := range d.AutoBucketModels {
			if id == model {
				auto = true
				break
			}
		}
		if auto {
			used = p.AutoPercentUsed
			bucket = "Auto"
		} else {
			used = p.APIPercentUsed
			bucket = "API"
		}
	} else if p.TotalPercentUsed != nil {
		used = p.TotalPercentUsed
	} else if p.Limit != nil && *p.Limit > 0 && p.Remaining != nil {
		v := 100 * (1 - *p.Remaining / *p.Limit)
		used = &v
	}
	if used == nil {
		return nil, nil
	}
	if math.IsNaN(*used) || math.IsInf(*used, 0) || *used < 0 {
		return nil, errors.New("quota: invalid usage percentage")
	}
	end, _ := strconv.ParseInt(d.BillingCycleEnd, 10, 64)
	start, _ := strconv.ParseInt(d.BillingCycleStart, 10, 64)
	window := core.UsageWindow{Name: bucket, UsedPercent: int(math.Round(math.Min(100, *used))), ResetAtUnix: end / 1000}
	if end > start && start > 0 {
		window.WindowSeconds = int((end - start) / 1000)
	}
	if end > 0 {
		window.ResetAfterSeconds = max(0, int(end/1000-time.Now().Unix()))
	}
	return &core.UsageReport{Provider: "Cursor", Buckets: []core.UsageBucket{{Name: bucket, Allowed: *used < 100, LimitReached: *used >= 100, Windows: []core.UsageWindow{window}}}}, nil
}
