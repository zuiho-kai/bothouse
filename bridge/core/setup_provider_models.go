package core

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
)

type setupProviderModel struct {
	ID   string `json:"id"`
	Name string `json:"name,omitempty"`
}

type setupProviderModelsResult struct {
	Models         []setupProviderModel `json:"models"`
	ErrorCode      string               `json:"error_code,omitempty"`
	UpstreamStatus int                  `json:"upstream_status,omitempty"`
}

// Discover the catalog for the unsaved wizard form. Provider credentials are
// used only for this request; no role, provider, or configuration is changed.
func (m *ManagementServer) handleSetupProviderModels(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		mgmtError(w, http.StatusMethodNotAllowed, "POST only")
		return
	}
	var input *struct {
		Vendor  string `json:"vendor"`
		BaseURL string `json:"base_url"`
		APIKey  string `json:"api_key"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	if err := decoder.Decode(&input); err != nil || input == nil {
		mgmtError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		mgmtError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	endpoint := setupProviderModelsURL(input.Vendor, input.BaseURL)
	if endpoint == nil {
		mgmtJSON(w, http.StatusOK, setupProviderModelsResult{Models: []setupProviderModel{}, ErrorCode: "bad_url"})
		return
	}
	mgmtJSON(w, http.StatusOK, fetchSetupProviderModels(r.Context(), endpoint, strings.TrimSpace(input.APIKey)))
}

func setupProviderModelsURL(vendor, base string) *url.URL {
	base = strings.TrimSpace(base)
	if base == "" {
		v, _ := wizardVendor(vendor)
		base = v.OpenAIBase
	}
	u, err := url.Parse(base)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" ||
		u.User != nil || u.RawQuery != "" || u.ForceQuery || strings.Contains(base, "#") {
		return nil
	}
	u.Path = strings.TrimRight(u.Path, "/")
	u.RawPath = strings.TrimRight(u.RawPath, "/")
	switch {
	case u.Path == "":
		return u.JoinPath("v1", "models")
	case strings.HasSuffix(u.Path, "/models"):
		return u
	default:
		return u.JoinPath("models")
	}
}

func fetchSetupProviderModels(ctx context.Context, endpoint *url.URL, apiKey string) setupProviderModelsResult {
	out := setupProviderModelsResult{Models: []setupProviderModel{}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		out.ErrorCode = "bad_url"
		return out
	}
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
	client := &http.Client{
		Timeout: setupHTTPTimeout,
		CheckRedirect: func(next *http.Request, via []*http.Request) error {
			// Never forward a provider key to another origin, or allow a redirect
			// to replace it with URL credentials. Keep Go's usual ten-hop limit.
			if len(via) >= 10 || next.URL.Scheme != endpoint.Scheme || !strings.EqualFold(next.URL.Host, endpoint.Host) || next.URL.User != nil {
				return http.ErrUseLastResponse
			}
			return nil
		},
	}
	resp, err := client.Do(req)
	if err != nil {
		out.ErrorCode = "unreachable"
		return out
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		out.UpstreamStatus = resp.StatusCode
		switch resp.StatusCode {
		case http.StatusUnauthorized, http.StatusForbidden:
			out.ErrorCode = "unauthorized"
		case http.StatusNotFound:
			out.ErrorCode = "not_found"
		default:
			out.ErrorCode = "upstream_error"
		}
		return out
	}
	// Error bodies and transport error strings can contain credentials. Return
	// only stable codes, and bound catalog parsing to a modest 2 MiB response.
	body, err := io.ReadAll(io.LimitReader(resp.Body, (2<<20)+1))
	if err != nil || len(body) > 2<<20 {
		out.ErrorCode = "invalid_response"
		return out
	}
	var catalog struct {
		Data *[]struct {
			ID          string `json:"id"`
			DisplayName string `json:"display_name"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &catalog); err != nil || catalog.Data == nil {
		out.ErrorCode = "invalid_response"
		return out
	}
	seen := make(map[string]bool)
	for _, model := range *catalog.Data {
		if model.ID == "" || seen[model.ID] {
			continue
		}
		seen[model.ID] = true
		out.Models = append(out.Models, setupProviderModel{ID: model.ID, Name: model.DisplayName})
	}
	sort.Slice(out.Models, func(i, j int) bool { return out.Models[i].ID < out.Models[j].ID })
	return out
}
