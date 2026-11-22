package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/config"
	"github.com/chenhg5/cc-connect/core"
)

func TestModuleListDSHProfiles(t *testing.T) {
	for _, tc := range []struct {
		name, web, desktop, want string
	}{
		{name: "none", want: "dsh          not configured"},
		{name: "web only", web: "enabled", want: "dsh          enabled (DSH profile web)"},
		{name: "desktop only", desktop: "enabled", want: "dsh          enabled (DSH profile desktop)"},
		{name: "desktop disabled", desktop: "disabled", want: "dsh          disabled (DSH profile desktop)"},
		{name: "broken web", web: "broken", desktop: "enabled", want: "dsh          enabled (DSH profile desktop)"},
		{name: "both enabled", web: "enabled", desktop: "enabled", want: "dsh          enabled (DSH profiles web, desktop)"},
		{name: "mixed", web: "disabled", desktop: "enabled", want: "dsh          enabled (DSH profile desktop); disabled (DSH profile web)"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			home := t.TempDir()
			t.Setenv("DSH_HOME", home)
			previousConfig := config.ConfigPath
			t.Cleanup(func() { config.ConfigPath = previousConfig })
			config.ConfigPath = filepath.Join(home, "missing.toml")

			for profile, status := range map[string]string{core.DSHProfile: tc.web, core.DSHDesktopProfile: tc.desktop} {
				if status == "" {
					continue
				}
				dir := filepath.Join(home, "profiles", profile)
				if err := os.MkdirAll(dir, 0o700); err != nil {
					t.Fatal(err)
				}
				patch := "- insert:\n    - id: collab\n      name: conest-collab\n"
				switch status {
				case "disabled":
					patch += "      disabled: true\n"
				case "broken":
					patch = "["
				}
				if err := os.WriteFile(filepath.Join(dir, "cordis.patch.yml"), []byte(patch), 0o600); err != nil {
					t.Fatal(err)
				}
			}

			var listErr error
			output := captureStdout(t, func() { listErr = moduleList() })
			if listErr != nil {
				t.Fatalf("module list: %v", listErr)
			}
			if !strings.Contains(output, tc.want+"\n") {
				t.Errorf("module list output:\n%s\nwant row %q", output, tc.want)
			}
		})
	}
}
