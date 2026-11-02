package core

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// The shipped install.sh must link the dsh-web-app that belongs to the running
// dsh, whether it is nested under the dsh package or hoisted beside it. It must
// never borrow a web-app from a different global DSH install, and it must fail
// clearly when the matching web-app is missing (#812).
func TestInstallShResolvesMatchingWebApp(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("install.sh runs under Git Bash on Windows")
	}
	if _, err := exec.LookPath("bash"); err != nil {
		t.Skip("bash not available")
	}
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node not available")
	}

	for _, tc := range []struct {
		name      string
		nested    bool
		hasWebApp bool
	}{
		{name: "nested", nested: true, hasWebApp: true},
		{name: "hoisted", nested: false, hasWebApp: true},
		{name: "missing_local_web_app", nested: false, hasWebApp: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			base := t.TempDir()
			extract := filepath.Join(base, "collab-bundle")
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

			// The dsh shim sits inside the package's bin/ so realpath(dsh)/.. is the
			// package dir, as with a real Unix install.
			rt := filepath.Join(base, "runtime")
			pkgDir := filepath.Join(rt, "node_modules", "@deepseek-ai", "dsh")
			binDir := filepath.Join(pkgDir, "bin")
			write(filepath.Join(pkgDir, "package.json"), `{"name":"@deepseek-ai/dsh","version":"0.2.1-rc.2"}`, 0644)
			capture := filepath.Join(base, "dsh-args")
			write(filepath.Join(binDir, "dsh"), "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$DSH_CAPTURE\"\n", 0755)

			webApp := filepath.Join(pkgDir, "node_modules", "@deepseek-ai", "dsh-web-app")
			if !tc.nested {
				webApp = filepath.Join(rt, "node_modules", "@deepseek-ai", "dsh-web-app")
			}
			if tc.hasWebApp {
				write(filepath.Join(webApp, "package.json"), `{"name":"@deepseek-ai/dsh-web-app","version":"0.2.1-rc.2"}`, 0644)
			}

			// A different global install; the old fallback used to pick this one.
			decoy := filepath.Join(base, "decoy-global", "@deepseek-ai", "dsh", "node_modules", "@deepseek-ai", "dsh-web-app")
			write(filepath.Join(decoy, "package.json"), `{"name":"@deepseek-ai/dsh-web-app","version":"0.1.5"}`, 0644)

			stub := filepath.Join(base, "stub")
			write(filepath.Join(stub, "npm"), "#!/bin/sh\nif [ \"$1\" = root ] && [ \"$2\" = -g ]; then echo \"$DECOY_ROOT\"; fi\n", 0755)
			write(filepath.Join(stub, "pnpm"), "#!/bin/sh\nmkdir -p node_modules\nexit 0\n", 0755)

			home := filepath.Join(base, "home")
			if err := os.MkdirAll(filepath.Join(home, "dsh", "profiles", "web"), 0755); err != nil {
				t.Fatal(err)
			}

			env := make([]string, 0, len(os.Environ())+4)
			for _, kv := range os.Environ() {
				if key, _, ok := strings.Cut(kv, "="); ok {
					switch key {
					case "PATH", "HOME", "DSH_HOME":
						continue
					}
				}
				env = append(env, kv)
			}
			env = append(env,
				"PATH="+stub+":"+binDir+string(os.PathListSeparator)+os.Getenv("PATH"),
				"HOME="+home,
				"DSH_HOME="+filepath.Join(home, "dsh"),
				"DSH_CAPTURE="+capture,
				"DECOY_ROOT="+filepath.Join(base, "decoy-global"),
			)

			cmd := exec.Command("bash", filepath.Join(extract, "install.sh"), "web")
			cmd.Dir = extract
			cmd.Env = env
			out, err := cmd.CombinedOutput()
			captured, _ := os.ReadFile(capture)
			linked := string(captured)

			// macOS temp dirs are reached through /private; compare canonical paths.
			webAppReal, _ := filepath.EvalSymlinks(webApp)
			decoyReal, _ := filepath.EvalSymlinks(decoy)
			if tc.hasWebApp {
				if err != nil {
					t.Fatalf("install failed: %v\n%s", err, out)
				}
				if !strings.Contains(linked, "link:"+webAppReal) {
					t.Fatalf("must link the running dsh web-app %s; linked: %s", webAppReal, linked)
				}
				if strings.Contains(linked, "link:"+decoyReal) {
					t.Fatalf("must not link another install's web-app: %s", linked)
				}
				return
			}
			if err == nil {
				t.Fatalf("must fail when the matching web-app is missing; linked: %s", linked)
			}
			if !strings.Contains(string(out), "dsh-web-app") {
				t.Fatalf("error must name dsh-web-app: %s", out)
			}
			if strings.Contains(linked, "link:"+decoyReal) {
				t.Fatalf("must not fall back to another install: %s", linked)
			}
		})
	}
}