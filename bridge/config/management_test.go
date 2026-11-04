package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestTrayManagementAcceptsDSHOnlyConfig(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.toml")
	t.Setenv("TRAY_TEST_TOKEN", "test-secret")
	body := "[management]\nenabled = true\nhost = '127.0.0.1'\nport = 19820\ntoken = '${TRAY_TEST_TOKEN}'\n"
	if err := os.WriteFile(path, []byte(body), 0600); err != nil {
		t.Fatal(err)
	}
	mgmt, err := LoadManagement(path)
	if err != nil {
		t.Fatal(err)
	}
	if mgmt.Enabled == nil || !*mgmt.Enabled || mgmt.Host != "127.0.0.1" || mgmt.Port != 19820 || mgmt.Token != "test-secret" {
		t.Fatalf("management settings not preserved: enabled=%v host=%q port=%d", mgmt.Enabled, mgmt.Host, mgmt.Port)
	}
	if _, err := LoadPermissive(path); err == nil {
		t.Fatal("bridge configuration validation was unexpectedly weakened")
	}
}

func TestTrayManagementReportsInvalidConfig(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.toml")
	if _, err := LoadManagement(path); err == nil {
		t.Fatal("missing config accepted")
	}
	if err := os.WriteFile(path, []byte("[management\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadManagement(path); err == nil {
		t.Fatal("invalid TOML accepted")
	}
}
