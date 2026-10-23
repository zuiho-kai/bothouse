package core

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDSHPlatformInstallLanguageAndIsolation(t *testing.T) {
	bin := t.TempDir()
	if err := os.WriteFile(filepath.Join(bin, "dsh"), []byte("#!/bin/sh\necho test-dsh\n"), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	script := t.TempDir()
	home := t.TempDir()
	t.Setenv("DSH_HOME", home)
	t.Setenv("BOTHOUSE_DSH_DIR", script)
	body := `#!/bin/bash
set -eu
[ "$1" = web ]
[ "$2" = --lang ]
mkdir -p "$DSH_HOME/profiles/web"
printf 'client-ui-discord\nlocale: %s\n' "$3" > "$DSH_HOME/profiles/web/cordis.patch.yml"
echo "installed $3"
`
	if err := os.WriteFile(filepath.Join(script, "install.sh"), []byte(body), 0644); err != nil {
		t.Fatal(err)
	}
	for _, lang := range []string{"zh", "en"} {
		req := httptest.NewRequest(http.MethodPost, "/setup/dsh/install", strings.NewReader(`{"lang":"`+lang+`"}`))
		rec := httptest.NewRecorder()
		(&ManagementServer{}).handleSetupDSHInstall(rec, req)
		if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"plugin_installed":true`) || !strings.Contains(rec.Body.String(), "installed "+lang) {
			t.Fatalf("%d %s", rec.Code, rec.Body.String())
		}
		b, err := os.ReadFile(filepath.Join(home, "profiles/web/cordis.patch.yml"))
		if err != nil || !strings.Contains(string(b), "locale: "+lang) {
			t.Fatalf("locale: %s %v", b, err)
		}
	}
	if st := GetDSHStatus(context.Background()); !st.Found || !strings.Contains(st.OpenCommand, home) {
		t.Fatalf("status: %+v", st)
	}
	if err := os.WriteFile(filepath.Join(script, "install.sh"), []byte("exit 7\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := InstallDSHPlugin(context.Background(), "zh", nil); err == nil {
		t.Fatal("installer failure reported as success")
	}
	req := httptest.NewRequest(http.MethodGet, "/setup/dsh/install", nil)
	rec := httptest.NewRecorder()
	(&ManagementServer{}).handleSetupDSHInstall(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET status %d", rec.Code)
	}
}

func TestLookDSHAndBash(t *testing.T) {
	// 1. With dsh on PATH
	d := t.TempDir()
	dshPath := filepath.Join(d, "dsh")
	if err := os.WriteFile(dshPath, []byte("#!/bin/sh\n"), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", d)
	got, err := LookDSH()
	if err != nil || got == "" {
		t.Fatalf("expected dsh found, got %s, err: %v", got, err)
	}

	// 2. Without dsh on PATH
	t.Setenv("PATH", t.TempDir())
	if _, err := LookDSH(); err == nil {
		t.Fatal("expected LookDSH to fail when dsh is not on PATH")
	}

	// 3. Bash lookup
	t.Setenv("PATH", os.Getenv("PATH"))
	if _, err := LookBash(); err != nil {
		t.Logf("LookBash: %v", err)
	}
}
