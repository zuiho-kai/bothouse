//go:build windows

package core

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/tests/testutil"
	"golang.org/x/sys/windows"
	"gopkg.in/yaml.v3"
)

// Exercise the wizard HTTP route, not a client retry accepting a failed save.
func TestManagementDSHConfigureWindowsLocks(t *testing.T) {
	for _, transient := range []bool{true, false} {
		name := "persistent"
		if transient {
			name = "transient"
		}
		t.Run(name, func(t *testing.T) {
			home := t.TempDir()
			testutil.SetHome(t, home)
			t.Setenv("DSH_HOME", filepath.Join(home, ".dsh"))
			t.Setenv("CONEST_COLLAB_DATA", filepath.Join(home, "collab"))
			t.Setenv("CC_DATA_DIR", filepath.Join(home, "bothouse"))
			path := filepath.Join(dshHome(), "profiles", DSHProfile, "cordis.patch.yml")
			if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
				t.Fatal(err)
			}
			original := "- id: locale\n  config:\n    preference: zh\n"
			if err := os.WriteFile(path, []byte(original), 0o600); err != nil {
				t.Fatal(err)
			}
			h := holdDSHYAML(t, path)
			if transient {
				released := make(chan struct{})
				go func() { time.Sleep(100 * time.Millisecond); windows.CloseHandle(h); close(released) }()
				defer func() { <-released }()
			} else {
				defer windows.CloseHandle(h)
			}
			server := httptest.NewServer(NewManagementServer(0, "", nil).buildHandler(http.NewServeMux()))
			defer server.Close()
			response, err := server.Client().Post(server.URL+"/api/v1/setup/dsh/configure", "application/json", strings.NewReader(`{"members":[{"name":"test","cli":"claude"}]}`))
			if err != nil {
				t.Fatal(err)
			}
			body, err := io.ReadAll(response.Body)
			response.Body.Close()
			if err != nil {
				t.Fatal(err)
			}
			want := http.StatusBadRequest
			if transient {
				want = http.StatusOK
			}
			if response.StatusCode != want {
				t.Fatalf("HTTP %d, want %d: %s", response.StatusCode, want, body)
			}
			saved, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if transient {
				if !strings.Contains(string(saved), "credentialOnboarding: false") || !strings.Contains(string(saved), "maxImageDimension:") {
					t.Fatalf("patch not saved: %s", saved)
				}
				if _, err := os.Stat(dshMembersFile()); err != nil {
					t.Fatalf("members not saved: %v", err)
				}
			} else if string(saved) != original || !strings.Contains(string(body), "attempts") {
				t.Fatalf("failed save changed file or lost error: %s, %s", saved, body)
			}
			t.Logf("POST /api/v1/setup/dsh/configure: %s lock -> HTTP %d", name, response.StatusCode)
		})
	}
}

func holdDSHYAML(t *testing.T, path string) windows.Handle {
	t.Helper()
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		t.Fatal(err)
	}
	// Real Windows reader that allows read/write but denies replacement.
	h, err := windows.CreateFile(p, windows.GENERIC_READ, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil, windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		t.Fatal(err)
	}
	return h
}

func TestWriteYAMLWindowsTransientLock(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cordis.patch.yml")
	if err := os.WriteFile(path, []byte("old: value\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	h := holdDSHYAML(t, path)
	released := make(chan struct{})
	go func() {
		time.Sleep(100 * time.Millisecond)
		windows.CloseHandle(h)
		close(released)
	}()
	defer func() { <-released }()
	var doc yaml.Node
	if err := yaml.Unmarshal([]byte("new: value\n"), &doc); err != nil {
		t.Fatal(err)
	}
	if err := writeYAML(path, &doc, 0o600); err != nil {
		t.Fatalf("transient reader lock must not fail YAML save: %v", err)
	}
	b, err := os.ReadFile(path)
	if err != nil || !strings.Contains(string(b), "new: value") {
		t.Fatalf("saved %q: %v", b, err)
	}
}

func TestWriteYAMLWindowsPersistentLock(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cordis.patch.yml")
	original := "old: value\n"
	if err := os.WriteFile(path, []byte(original), 0o600); err != nil {
		t.Fatal(err)
	}
	h := holdDSHYAML(t, path)
	defer windows.CloseHandle(h)
	var doc yaml.Node
	if err := yaml.Unmarshal([]byte("new: value\n"), &doc); err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	err := writeYAML(path, &doc, 0o600)
	if !errors.Is(err, windows.ERROR_ACCESS_DENIED) && !errors.Is(err, windows.ERROR_SHARING_VIOLATION) {
		t.Fatalf("persistent lock must remain a Windows error: %v", err)
	}
	if !strings.Contains(err.Error(), "attempts") {
		t.Fatalf("retry exhaustion must report its attempt count: %v", err)
	}
	if time.Since(started) > 5*time.Second {
		t.Fatal("persistent lock exceeded bounded retry time")
	}
	b, readErr := os.ReadFile(path)
	if readErr != nil || string(b) != original {
		t.Fatalf("original changed: %q, %v", b, readErr)
	}
	t.Logf("persistent lock returned %v after %s", err, time.Since(started))
}

func TestRenameDSHYAMLWindowsPermanentError(t *testing.T) {
	dir := t.TempDir()
	started := time.Now()
	err := renameDSHYAML(filepath.Join(dir, "missing.tmp"), filepath.Join(dir, "cordis.patch.yml"))
	if !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("missing source error lost: %v", err)
	}
	if strings.Contains(err.Error(), "attempts") || time.Since(started) >= time.Second {
		t.Fatalf("non-lock error must return immediately: %v", err)
	}
}
