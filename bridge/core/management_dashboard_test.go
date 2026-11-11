package core

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestManagementDashboardAndAPI(t *testing.T) {
	previous := GetWebAssets()
	t.Cleanup(func() { RegisterWebAssets(previous) })
	RegisterWebAssets(fstest.MapFS{
		"index.html":          {Data: []byte(`<html><div id="root"></div></html>`)},
		"assets/dashboard.js": {Data: []byte(`console.log("dashboard");`)},
	})
	server := NewManagementServer(0, "dashboard-test-secret", nil)
	handler := server.buildHandler(http.NewServeMux())
	for _, tc := range []struct {
		name, path, token, contains string
		status                      int
	}{
		{"root", "/", "", `id="root"`, http.StatusOK},
		{"login", "/login?token=dashboard-test-secret&next=%2F", "", `id="root"`, http.StatusOK},
		{"spa", "/usage", "", `id="root"`, http.StatusOK},
		{"asset", "/assets/dashboard.js", "", "dashboard", http.StatusOK},
		{"unauthenticated API", "/api/v1/status", "", "unauthorized", http.StatusUnauthorized},
		{"incorrect token", "/api/v1/status", "incorrect", "unauthorized", http.StatusUnauthorized},
		{"authenticated API", "/api/v1/status", "dashboard-test-secret", `"ok":true`, http.StatusOK},
		{"unknown API", "/api/v1/not-a-route", "", "404", http.StatusNotFound},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tc.path, nil)
			if tc.token != "" {
				req.Header.Set("Authorization", "Bearer "+tc.token)
			}
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code != tc.status || !strings.Contains(rec.Body.String(), tc.contains) {
				t.Fatalf("status=%d body=%q; want status=%d containing %q",
					rec.Code, rec.Body.String(), tc.status, tc.contains)
			}
		})
	}
}

func TestManagementWithoutDashboardKeepsAPI(t *testing.T) {
	previous := GetWebAssets()
	t.Cleanup(func() { RegisterWebAssets(previous) })
	RegisterWebAssets(nil)
	server := NewManagementServer(0, "dashboard-test-secret", nil)
	handler := server.buildHandler(http.NewServeMux())
	for _, tc := range []struct {
		path, token string
		status      int
	}{
		{"/", "", http.StatusServiceUnavailable},
		{"/login?token=private-login-token&next=%2F", "", http.StatusServiceUnavailable},
		{"/api/v1/status", "", http.StatusUnauthorized},
		{"/api/v1/status", "wrong-token", http.StatusUnauthorized},
		{"/api/v1/status", "dashboard-test-secret", http.StatusOK},
		{"/api/v1/not-a-route", "", http.StatusNotFound},
		{"/missing-file.js", "", http.StatusNotFound},
	} {
		req := httptest.NewRequest(http.MethodGet, tc.path, nil)
		if tc.token != "" {
			req.Header.Set("Authorization", "Bearer "+tc.token)
		}
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != tc.status {
			t.Errorf("%s: status=%d; want %d", tc.path, rec.Code, tc.status)
		}
		if tc.status == http.StatusServiceUnavailable {
			if !strings.Contains(rec.Body.String(), "no_web") {
				t.Errorf("%s: missing recovery advice: %q", tc.path, rec.Body.String())
			}
			if strings.Contains(rec.Body.String(), "private-login-token") {
				t.Errorf("%s: response exposed the login token", tc.path)
			}
		}
	}
}
