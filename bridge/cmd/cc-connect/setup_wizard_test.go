package main

import (
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"github.com/chenhg5/cc-connect/config"
)

func TestDSHResumeStartupLink(t *testing.T) {
	for _, configured := range []bool{false, true} {
		u, err := url.Parse(setupEntryLink(9820, "test+token", configured))
		if err != nil {
			t.Fatal(err)
		}
		want := "/setup"
		if configured {
			want = "/setup?platform=dsh"
		}
		if u.Query().Get("next") != want || u.Query().Get("token") != "test+token" {
			t.Fatalf("startup link = %v, want next %s", u, want)
		}
	}
}

// M2: the first-run config enables the web admin on this machine only, with a token.
func TestBootstrapSetupConfigLoopbackWithToken(t *testing.T) {
	p := filepath.Join(t.TempDir(), "config.toml")
	if err := bootstrapSetupConfig(p); err != nil {
		t.Fatal(err)
	}
	cfg, err := config.LoadForSetup(p)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Management.Enabled == nil || !*cfg.Management.Enabled || cfg.Management.Host != "127.0.0.1" || len(cfg.Management.Token) < 16 {
		t.Fatalf("management = %+v", cfg.Management)
	}
	if fi, _ := os.Stat(p); fi.Mode().Perm() != 0o600 {
		t.Fatalf("config perm = %v", fi.Mode().Perm())
	}
}
