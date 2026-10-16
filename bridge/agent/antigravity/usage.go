package antigravity

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// nativeQuota talks only to the CLI process owned by this session. Its own
// authenticated provider client handles token refresh and model-specific plans;
// old cloud APIs omit newer buckets such as Argon's separate weekly allowance.
type nativeQuota struct {
	mu         sync.Mutex
	pid        int
	csrf       string
	address    string
	closed     bool
	cacheModel string
	cached     *core.UsageReport
	fetchedAt  time.Time
}

func newNativeQuota() (*nativeQuota, error) {
	var token [32]byte
	if _, err := rand.Read(token[:]); err != nil {
		return nil, err
	}
	return &nativeQuota{csrf: hex.EncodeToString(token[:])}, nil
}

func (q *nativeQuota) close() { q.mu.Lock(); q.closed = true; q.address = ""; q.mu.Unlock() }

type quotaSummary struct {
	Response struct {
		Groups []struct {
			DisplayName string `json:"displayName"`
			Buckets     []struct {
				BucketID          string   `json:"bucketId"`
				Window            string   `json:"window"`
				RemainingFraction *float64 `json:"remainingFraction"`
				ResetTime         string   `json:"resetTime"`
				Disabled          bool     `json:"disabled"`
			} `json:"buckets"`
		} `json:"groups"`
	} `json:"response"`
}

func (q *nativeQuota) get(ctx context.Context, model string) (*core.UsageReport, error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.closed || q.pid <= 0 {
		return nil, nil
	}
	if q.cached != nil && q.cacheModel == model && time.Since(q.fetchedAt) < 30*time.Second {
		return q.cached, nil
	}
	addresses, err := q.addresses(ctx)
	if err != nil {
		return nil, err
	}
	var last error
	for _, address := range addresses {
		report, err := fetchNativeQuota(ctx, address, q.csrf, model)
		if err == nil {
			q.address = address
			q.cacheModel, q.cached, q.fetchedAt = model, report, time.Now()
			return report, nil
		}
		last = err
	}
	if last == nil {
		last = errors.New("quota: CLI listener not ready")
	}
	return nil, last
}

// addresses is called with q.mu held; discovery is restricted to our child PID.
func (q *nativeQuota) addresses(ctx context.Context) ([]string, error) {
	addresses := []string{q.address}
	if q.address == "" {
		// Inspect only the exact subprocess PID, never other apps or agents. lsof
		// is supplied by macOS and is an explicit prerequisite on other platforms.
		cmd := exec.CommandContext(ctx, "lsof", "-nP", "-a", "-p", strconv.Itoa(q.pid), "-iTCP", "-sTCP:LISTEN", "-Fn")
		raw, err := cmd.Output()
		if err != nil {
			return nil, errors.New("quota: cannot discover CLI listener (lsof required)")
		}
		addresses = nativeQuotaAddresses(string(raw))
	}
	return addresses, nil
}

func nativeQuotaAddresses(raw string) []string {
	var addresses []string
	for _, line := range strings.Split(raw, "\n") {
		if !strings.HasPrefix(line, "n") {
			continue
		}
		host, port, err := net.SplitHostPort(strings.TrimPrefix(line, "n"))
		if err != nil {
			continue
		}
		ip := net.ParseIP(host)
		n, err := strconv.Atoi(port)
		if ip == nil || !ip.IsLoopback() || err != nil || n < 1 || n > 65535 {
			continue
		}
		addresses = append(addresses, "http://"+net.JoinHostPort(host, port))
	}
	return addresses
}

func fetchNativeQuota(ctx context.Context, address, csrf, model string) (*core.UsageReport, error) {
	raw, err := fetchNativeRPC(ctx, address, csrf, "RetrieveUserQuotaSummary", []byte("{}"), 1<<20)
	if err != nil {
		return nil, err
	}
	var summary quotaSummary
	if json.Unmarshal(raw, &summary) != nil {
		return nil, errors.New("quota: invalid CLI quota response")
	}
	return summary.report(model)
}

func fetchNativeRPC(ctx context.Context, address, csrf, method string, body []byte, limit int64) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, address+"/exa.language_server_pb.LanguageServerService/"+method, bytes.NewReader(body))
	if err != nil {
		return nil, errors.New("quota: invalid CLI listener")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-codeium-csrf-token", csrf)
	// A localhost RPC must not use an HTTP proxy or follow redirects.
	transport := &http.Transport{Proxy: nil, DisableKeepAlives: true}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Do(req)
	if err != nil {
		return nil, errors.New("quota: CLI query failed or timed out")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("quota: CLI returned HTTP %d", resp.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil || int64(len(raw)) > limit {
		return nil, errors.New("antigravity: cannot read native CLI response")
	}
	return raw, nil
}

func (s quotaSummary) report(model string) (*core.UsageReport, error) {
	model, _, _ = strings.Cut(strings.TrimSpace(model), "[")
	prefix := ""
	switch {
	case strings.HasPrefix(model, "gemini-"):
		prefix = "gemini-"
	case strings.HasPrefix(model, "claude-"), strings.HasPrefix(model, "gpt-"):
		prefix = "3p-"
	default:
		return nil, nil
	}
	// Argon has a separate allowance on Pro; Ultra reports it in the Gemini
	// group. Prefer the explicit bucket whenever the CLI supplies one.
	if strings.HasPrefix(model, "gemini-4-argon") {
		for _, g := range s.Response.Groups {
			for _, b := range g.Buckets {
				if strings.HasPrefix(b.BucketID, "gemini-argon-") {
					prefix = "gemini-argon-"
				}
			}
		}
	}
	report := &core.UsageReport{Provider: "Antigravity"}
	for _, g := range s.Response.Groups {
		bucket := core.UsageBucket{Name: g.DisplayName, Allowed: true}
		for _, b := range g.Buckets {
			if !strings.HasPrefix(b.BucketID, prefix) || (prefix == "gemini-" && strings.HasPrefix(b.BucketID, "gemini-argon-")) {
				continue
			}
			// remainingFraction is a protobuf oneof: absent is unknown, not zero.
			if b.Disabled || b.RemainingFraction == nil {
				continue
			}
			remaining := *b.RemainingFraction
			if math.IsNaN(remaining) || math.IsInf(remaining, 0) || remaining < 0 || remaining > 1 {
				return nil, errors.New("quota: invalid remaining fraction")
			}
			w := core.UsageWindow{Name: b.Window, UsedPercent: int(math.Round((1 - remaining) * 100))}
			switch b.Window {
			case "5h":
				w.WindowSeconds = 18000
			case "weekly":
				w.WindowSeconds = 604800
			}
			if reset, err := time.Parse(time.RFC3339, b.ResetTime); err == nil {
				w.ResetAtUnix = reset.Unix()
				w.ResetAfterSeconds = max(0, int(time.Until(reset).Seconds()))
			}
			bucket.Windows = append(bucket.Windows, w)
			if remaining == 0 {
				bucket.Allowed = false
				bucket.LimitReached = true
			}
		}
		if len(bucket.Windows) > 0 {
			report.Buckets = append(report.Buckets, bucket)
		}
	}
	if len(report.Buckets) == 0 {
		return nil, nil
	}
	return report, nil
}

func (s *streamSession) GetUsage(ctx context.Context) (*core.UsageReport, error) {
	if s.quota == nil {
		return nil, nil
	}
	return s.quota.get(ctx, s.model)
}

func (s *streamSession) GetModel() string { return s.model }

func (a *Agent) GetUsage(ctx context.Context) (*core.UsageReport, error) {
	return a.GetUsageForModel(ctx, a.GetModel())
}

func (a *Agent) GetUsageForModel(ctx context.Context, model string) (*core.UsageReport, error) {
	a.mu.RLock()
	q := a.quota
	a.mu.RUnlock()
	if q == nil {
		return nil, nil
	}
	return q.get(ctx, model)
}
