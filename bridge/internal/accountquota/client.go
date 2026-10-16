// Package accountquota reads provider account quotas without submitting a model
// turn. Credentials remain in memory; provider error bodies are never surfaced.
package accountquota

import (
	"bytes"
	"context"
	"encoding/base64"
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
)

var ErrNoCredentials = errors.New("quota: login credentials unavailable")
var ErrUnsupportedAuth = errors.New("quota: this authentication method has no subscription quota")

const maxResponse = 4 << 20

func post(ctx context.Context, client *http.Client, endpoint, token, userAgent string, body []byte, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return errors.New("quota: invalid endpoint")
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Connect-Protocol-Version", "1")
	req.Header.Set("User-Agent", userAgent)
	// Copy rather than mutate a shared transport/client. Never forward a login
	// credential to a redirect, even if a provider changes its API behavior.
	c := *client
	c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	resp, err := c.Do(req)
	if err != nil {
		return errors.New("quota: request failed or timed out")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("quota: provider returned HTTP %d", resp.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxResponse+1))
	if err != nil || len(raw) > maxResponse {
		return errors.New("quota: response could not be read")
	}
	if json.Unmarshal(raw, out) != nil {
		return errors.New("quota: invalid provider response")
	}
	return nil
}

func envValue(env []string, key string) string {
	for i := len(env) - 1; i >= 0; i-- {
		if v, ok := strings.CutPrefix(env[i], key+"="); ok {
			return v
		}
	}
	return ""
}

func home(env []string) string {
	if v := envValue(env, "HOME"); v != "" {
		return v
	}
	if runtime.GOOS == "windows" {
		return envValue(env, "USERPROFILE")
	}
	return ""
}

// readKeychain uses the CLI's own credential entry. Never include subprocess
// output in errors: security may print the credential or account metadata.
func readKeychain(ctx context.Context, service, account string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, "/usr/bin/security", "find-generic-password", "-s", service, "-a", account, "-w")
	raw, err := cmd.Output()
	if err != nil {
		return nil, ErrNoCredentials
	}
	raw = bytes.TrimSpace(raw)
	if encoded, ok := strings.CutPrefix(string(raw), "go-keyring-base64:"); ok {
		raw, err = base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			return nil, ErrNoCredentials
		}
	}
	return raw, nil
}

func canUseKeychain(env []string) bool {
	// A project using a different HOME must never inherit this user's account.
	current, _ := os.UserHomeDir()
	return runtime.GOOS == "darwin" && home(env) != "" && filepath.Clean(home(env)) == filepath.Clean(current)
}

func httpClient() *http.Client { return &http.Client{Timeout: 10 * time.Second} }
