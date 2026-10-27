package core

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
)

type providerModelsTestModel struct {
	ID   string `json:"id"`
	Name string `json:"name,omitempty"`
}

type providerModelsTestResponse struct {
	OK   bool `json:"ok"`
	Data struct {
		Models         []providerModelsTestModel `json:"models"`
		ErrorCode      string                    `json:"error_code"`
		UpstreamStatus int                       `json:"upstream_status"`
	} `json:"data"`
}

func providerModelsTestHandler() http.Handler {
	m := NewManagementServer(0, "panel-token", nil)
	return m.buildHandler(http.NewServeMux())
}

func providerModelsTestRequest(t *testing.T, handler http.Handler, body any) (providerModelsTestResponse, int, string) {
	t.Helper()
	b, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(http.MethodPost, "/api/v1/setup/provider/models", strings.NewReader(string(b)))
	r.Header.Set("Authorization", "Bearer panel-token")
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	var out providerModelsTestResponse
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode management response (HTTP %d): %v", w.Code, err)
	}
	return out, w.Code, w.Body.String()
}

func TestSetupProviderModels_URLAndAuthentication(t *testing.T) {
	for _, tc := range []struct {
		name, basePath, wantPath, key string
	}{
		{"root", "", "/v1/models", "provider-key"},
		{"root slash", "/", "/v1/models", "provider-key"},
		{"v1", "/v1", "/v1/models", "provider-key"},
		{"nested prefix", "/api/v1/", "/api/v1/models", "provider-key"},
		{"custom prefix", "/gateway/custom", "/gateway/custom/models", "provider-key"},
		{"models endpoint", "/api/v1/models/", "/api/v1/models", "provider-key"},
		{"local without key", "/v1", "/v1/models", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls atomic.Int32
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.Method != http.MethodGet || r.URL.Path != tc.wantPath {
					t.Errorf("upstream request = %s %s, want GET %s", r.Method, r.URL.Path, tc.wantPath)
				}
				wantAuth := ""
				if tc.key != "" {
					wantAuth = "Bearer " + tc.key
				}
				if got := r.Header.Get("Authorization"); got != wantAuth {
					t.Errorf("upstream authorization = %q, want %q", got, wantAuth)
				}
				if r.Header.Get("X-Api-Key") != "" || r.Header.Get("Cookie") != "" {
					t.Error("unrelated credentials reached the provider")
				}
				_, _ = w.Write([]byte(`{"data":[{"id":"remote-model","display_name":"Remote Model"}]}`))
			}))
			defer upstream.Close()
			out, status, _ := providerModelsTestRequest(t, providerModelsTestHandler(), map[string]string{
				"vendor": "custom", "base_url": upstream.URL + tc.basePath, "api_key": tc.key,
			})
			if status != http.StatusOK || !out.OK || out.Data.ErrorCode != "" || calls.Load() != 1 {
				t.Fatalf("HTTP %d, response %+v, calls %d", status, out, calls.Load())
			}
			want := []providerModelsTestModel{{ID: "remote-model", Name: "Remote Model"}}
			if !reflect.DeepEqual(out.Data.Models, want) {
				t.Fatalf("models = %+v, want %+v", out.Data.Models, want)
			}
		})
	}
}

func TestSetupProviderModels_VendorDefaultAndExplicitOverride(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/catalog/v1/models" {
			t.Errorf("path = %q", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"data":[]}`))
	}))
	defer upstream.Close()
	previous := WizardVendors
	WizardVendors = append(append([]WizardVendor{}, previous...), WizardVendor{ID: "test-model-provider", OpenAIBase: upstream.URL + "/catalog/v1"})
	defer func() { WizardVendors = previous }()
	for _, body := range []map[string]string{
		{"vendor": "test-model-provider"},
		{"vendor": "deepseek", "base_url": upstream.URL + "/catalog/v1"},
	} {
		out, status, _ := providerModelsTestRequest(t, providerModelsTestHandler(), body)
		if status != http.StatusOK || !out.OK || out.Data.ErrorCode != "" || out.Data.Models == nil || len(out.Data.Models) != 0 {
			t.Fatalf("empty catalog: HTTP %d, response %+v", status, out)
		}
	}
}

func TestSetupProviderModels_DeduplicatesAndSortsRealIDs(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"data":[{"id":"z","display_name":"Zed"},{"id":"a"},{"id":"z"},{"id":""},{"display_name":"No ID"}]}`))
	}))
	defer upstream.Close()
	out, status, _ := providerModelsTestRequest(t, providerModelsTestHandler(), map[string]string{"base_url": upstream.URL})
	want := []providerModelsTestModel{{ID: "a"}, {ID: "z", Name: "Zed"}}
	if status != http.StatusOK || !out.OK || out.Data.ErrorCode != "" || !reflect.DeepEqual(out.Data.Models, want) {
		t.Fatalf("HTTP %d, response %+v, want %+v", status, out, want)
	}
}

func TestSetupProviderModels_BadURL(t *testing.T) {
	for _, base := range []string{"", "/relative", "ftp://example.test", "https://", "https://user:password@example.test/v1", "https://example.test/v1?key=secret", "https://example.test/v1?", "https://example.test/v1#secret"} {
		t.Run(base, func(t *testing.T) {
			out, status, raw := providerModelsTestRequest(t, providerModelsTestHandler(), map[string]string{"vendor": "custom", "base_url": base})
			if status != http.StatusOK || !out.OK || out.Data.ErrorCode != "bad_url" || out.Data.Models == nil || len(out.Data.Models) != 0 {
				t.Fatalf("HTTP %d, response %+v", status, out)
			}
			if strings.Contains(raw, "secret") || strings.Contains(raw, "password") {
				t.Fatal("URL credentials leaked in response")
			}
		})
	}
}

func TestSetupProviderModels_UpstreamFailuresStayInData(t *testing.T) {
	for _, tc := range []struct {
		status int
		code   string
	}{
		{401, "unauthorized"}, {403, "unauthorized"}, {404, "not_found"}, {429, "upstream_error"}, {500, "upstream_error"},
	} {
		t.Run(http.StatusText(tc.status), func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte("echoed provider-secret and upstream-private-detail"))
			}))
			defer upstream.Close()
			out, status, raw := providerModelsTestRequest(t, providerModelsTestHandler(), map[string]string{"base_url": upstream.URL, "api_key": "provider-secret"})
			if status != http.StatusOK || !out.OK || out.Data.ErrorCode != tc.code || out.Data.UpstreamStatus != tc.status || out.Data.Models == nil {
				t.Fatalf("HTTP %d, response %+v", status, out)
			}
			if strings.Contains(raw, "provider-secret") || strings.Contains(raw, "upstream-private-detail") {
				t.Fatal("upstream response body leaked")
			}
		})
	}
}

func TestSetupProviderModels_InvalidResponse(t *testing.T) {
	for _, body := range []string{`not JSON`, `{}`, `{"data":null}`, `{"data":{}}`, `{"data":[]} {}`, `{"data":[],"padding":"` + strings.Repeat("x", 2<<20) + `"}`} {
		upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_, _ = w.Write([]byte(body))
		}))
		out, status, _ := providerModelsTestRequest(t, providerModelsTestHandler(), map[string]string{"base_url": upstream.URL})
		upstream.Close()
		if status != http.StatusOK || !out.OK || out.Data.ErrorCode != "invalid_response" || out.Data.Models == nil {
			t.Fatalf("HTTP %d, response %+v", status, out)
		}
	}
}

func TestSetupProviderModels_Redirects(t *testing.T) {
	var otherCalls atomic.Int32
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		otherCalls.Add(1)
		_, _ = w.Write([]byte(`{"data":[]}`))
	}))
	defer other.Close()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/same/models" {
			http.Redirect(w, r, "/final/models", http.StatusFound)
			return
		}
		if r.URL.Path == "/final/models" {
			if r.Header.Get("Authorization") != "Bearer provider-secret" {
				t.Error("same-origin redirect lost provider authentication")
			}
			_, _ = w.Write([]byte(`{"data":[]}`))
			return
		}
		http.Redirect(w, r, other.URL+"/v1/models", http.StatusFound)
	}))
	defer upstream.Close()
	out, status, _ := providerModelsTestRequest(t, providerModelsTestHandler(), map[string]string{"base_url": upstream.URL, "api_key": "provider-secret"})
	if status != http.StatusOK || !out.OK || out.Data.ErrorCode != "upstream_error" || out.Data.UpstreamStatus != http.StatusFound || otherCalls.Load() != 0 {
		t.Fatalf("cross-origin redirect: HTTP %d, response %+v, target calls %d", status, out, otherCalls.Load())
	}
	out, status, _ = providerModelsTestRequest(t, providerModelsTestHandler(), map[string]string{"base_url": upstream.URL + "/same", "api_key": "provider-secret"})
	if status != http.StatusOK || !out.OK || out.Data.ErrorCode != "" || out.Data.Models == nil {
		t.Fatalf("same-origin redirect: HTTP %d, response %+v", status, out)
	}
}

func TestSetupProviderModels_ManagementBoundary(t *testing.T) {
	handler := providerModelsTestHandler()
	for _, tc := range []struct {
		method, token, body string
		want                int
	}{
		{http.MethodPost, "", `{}`, http.StatusUnauthorized},
		{http.MethodPost, "wrong-token", `{}`, http.StatusUnauthorized},
		{http.MethodGet, "panel-token", `{}`, http.StatusMethodNotAllowed},
		{http.MethodPut, "panel-token", `{}`, http.StatusMethodNotAllowed},
		{http.MethodPost, "panel-token", `{"api_key":`, http.StatusBadRequest},
		{http.MethodPost, "panel-token", `{ "api_key": 123 }`, http.StatusBadRequest},
	} {
		r := httptest.NewRequest(tc.method, "/api/v1/setup/provider/models", strings.NewReader(tc.body))
		if tc.token != "" {
			r.Header.Set("Authorization", "Bearer "+tc.token)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != tc.want {
			t.Errorf("%s with token %q body %q: status %d, want %d", tc.method, tc.token, tc.body, w.Code, tc.want)
		}
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/setup/provider/models", strings.NewReader(`{"base_url":"http://127.0.0.1:1/v1"}`)).WithContext(ctx)
	r.Header.Set("Authorization", "Bearer panel-token")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	var out providerModelsTestResponse
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if w.Code != http.StatusOK || !out.OK || out.Data.ErrorCode != "unreachable" {
		t.Fatalf("cancelled request: HTTP %d, response %+v", w.Code, out)
	}
}
