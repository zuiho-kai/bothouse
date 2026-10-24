//go:build !no_web

package main

import (
	"io/fs"
	"regexp"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

// This test runs against the real Vite output registered by plugin_web.go.
// Run make web first; a placeholder dist directory must not silently produce
// an API-only executable when a dashboard build was requested.
func TestEmbeddedDashboardAssets(t *testing.T) {
	assets := core.GetWebAssets()
	if assets == nil {
		t.Fatal("dashboard assets not registered; run make web and build without no_web")
	}
	index, err := fs.ReadFile(assets, "index.html")
	if err != nil {
		t.Fatalf("embedded dashboard entry: %v", err)
	}
	if !strings.Contains(string(index), `id="root"`) {
		t.Fatal("embedded index.html is not the dashboard entry")
	}
	scripts := regexp.MustCompile(`src="(/assets/[^"]+\.js)"`).FindAllStringSubmatch(string(index), -1)
	if len(scripts) == 0 {
		t.Fatal("dashboard entry has no built JavaScript asset")
	}
	for _, script := range scripts {
		content, err := fs.ReadFile(assets, strings.TrimPrefix(script[1], "/"))
		if err != nil || len(content) == 0 {
			t.Fatalf("embedded JavaScript asset %q: bytes=%d error=%v", script[1], len(content), err)
		}
	}
}
