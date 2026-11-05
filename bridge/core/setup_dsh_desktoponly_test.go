package core

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// #161 ①: a desktop-only DeepSeek Harness ships dsh.cmd under LOCALAPPDATA and nothing named
// `dsh`, and Git Bash's `command -v dsh` never matches a .cmd, so the installer used to stop
// with "dsh not found on PATH" on a machine that had DSH installed.
// Runs wherever bash does: LOCALAPPDATA is just a directory prefix, so a Unix temp dir with the
// same layout proves the resolution without a Windows host.
func TestInstallShFindsDesktopDshCmd(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("install.sh runs under Git Bash on Windows")
	}
	for _, name := range []string{"bash", "cat", "cmp", "find", "head", "grep", "sed"} {
		if _, err := exec.LookPath(name); err != nil {
			t.Skipf("%s not available: %v", name, err)
		}
	}

	// otherInstall: what `npm root -g` reports. Empty means no npm-global DSH at all; otherwise
	// it is a second, differently versioned DSH whose web-app must not be borrowed.
	for _, tc := range []struct {
		name         string
		otherInstall bool
	}{
		{name: "desktop only"},
		{name: "desktop plus another dsh in npm global", otherInstall: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			base := t.TempDir()
			extract := filepath.Join(base, "bundle")
			if _, err := ExtractEmbeddedDSH(extract); err != nil {
				t.Fatal(err)
			}

			write := func(path, body string, mode os.FileMode) {
				t.Helper()
				if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(path, []byte(body), mode); err != nil {
					t.Fatal(err)
				}
			}

			// The desktop-only layout LookDSH already knows about.
			localAppData := filepath.Join(base, "localappdata")
			capture := filepath.Join(base, "dsh-args")
			desktopCmd := filepath.Join(localAppData, "Programs", "DeepSeek Harness", "resources", "runtime", "cli", "bin", "dsh.cmd")
			write(desktopCmd, "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$DSH_CAPTURE\"\n", 0755)

			// Only stubs and base system dirs on PATH: no `dsh` anywhere, exactly like a machine
			// that installed the desktop app and nothing else.
			stub := filepath.Join(base, "stub")
			write(filepath.Join(stub, "node"), "#!/bin/sh\nexit 0\n", 0755)
			write(filepath.Join(stub, "pnpm"), "#!/bin/sh\nmkdir -p node_modules\nexit 0\n", 0755)
			npmRoot := filepath.Join(base, "npmroot")
			if tc.otherInstall {
				decoy := filepath.Join(npmRoot, "@deepseek-ai", "dsh")
				write(filepath.Join(decoy, "package.json"), `{"name":"@deepseek-ai/dsh","version":"9.9.9"}`, 0644)
				write(filepath.Join(decoy, "node_modules", "@deepseek-ai", "dsh-web-app", "package.json"),
					`{"name":"@deepseek-ai/dsh-web-app","version":"9.9.9"}`, 0644)
			}
			write(filepath.Join(stub, "npm"), "#!/bin/sh\ncase \"$1\" in root) printf '%s\\n' \""+npmRoot+"\" ;; *) exit 1 ;; esac\n", 0755)

			home := filepath.Join(base, "home")
			if err := os.MkdirAll(filepath.Join(home, "dsh", "profiles", "web"), 0755); err != nil {
				t.Fatal(err)
			}

			env := make([]string, 0, len(os.Environ())+6)
			for _, kv := range os.Environ() {
				if key, _, ok := strings.Cut(kv, "="); ok {
					switch key {
					case "PATH", "HOME", "DSH_HOME", "LOCALAPPDATA", "APPDATA", "ProgramFiles":
						continue
					}
				}
				env = append(env, kv)
			}
			env = append(env,
				"PATH="+stub+":/usr/bin:/bin",
				"HOME="+home,
				"DSH_HOME="+filepath.Join(home, "dsh"),
				"LOCALAPPDATA="+localAppData,
				"APPDATA="+filepath.Join(base, "appdata"),
				"DSH_CAPTURE="+capture,
			)

			cmd := exec.Command("bash", filepath.Join(extract, "install.sh"), "web")
			cmd.Dir = extract
			cmd.Env = env
			out, err := cmd.CombinedOutput()
			if err != nil {
				t.Fatalf("installer stopped without a dsh on PATH even though the desktop dsh.cmd exists: %v\n%s", err, out)
			}
			if !strings.Contains(string(out), "== dsh: "+desktopCmd) {
				t.Fatalf("installer did not report the desktop dsh.cmd it resolved:\n%s", out)
			}
			// The plugin step must drive that same executable, not a bare `dsh` lookup.
			linked, _ := os.ReadFile(capture)
			if !strings.Contains(string(linked), "plugin --profile web add") {
				t.Fatalf("plugin step did not run through the resolved dsh.cmd; captured: %q", linked)
			}
			// A .cmd launcher is the desktop app: it carries its own runtime in app.asar, so the
			// only dsh package npm can point at belongs to another install. Linking its web-app
			// makes dsh refuse the whole install over the version skew (#161 ①).
			if strings.Contains(string(linked), npmRoot) {
				t.Fatalf("borrowed another install's web-app for the desktop dsh; captured: %q", linked)
			}
		})
	}
}
