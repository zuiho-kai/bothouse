package core

// 插件 (#150 第 b 项): what the install box may name, and what the page shows before the run.
//
// The pre-merge review rejected the first version because its one regex also let `git+https://…`,
// `https://….tgz`, `file:…` and `link:…` through: that is installing arbitrary code, and the page
// never said where it came from. These tests pin the narrow default and the confirm step.

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
)

func TestPluginSpecAcceptsRegistryNamesOnly(t *testing.T) {
	for _, tc := range []struct{ spec, name, kind string }{
		{"demo-bundle", "demo-bundle", pluginKindRegistry},
		{"@scope/plugin", "@scope/plugin", pluginKindRegistry},
		{"@scope/plugin@1.2.3", "@scope/plugin", pluginKindRegistry},
		{"demo-bundle@next", "demo-bundle", pluginKindRegistry},
		{"demo-bundle@^0.2.0", "demo-bundle", pluginKindRegistry},
		{"  demo-bundle  ", "demo-bundle", pluginKindRegistry},
		{"github:u/r", "github:u/r", pluginKindGit},
		{"git+https://host/x", "git+https://host/x", pluginKindGit},
		{"https://host/u/r", "https://host/u/r", pluginKindGit},
		{"https://host/u/r.tgz", "https://host/u/r.tgz", pluginKindTarball},
		{"file:../x", "file:../x", pluginKindPath},
		{"link:/abs/x", "link:/abs/x", pluginKindPath},
		{"/abs/x.tgz", "/abs/x.tgz", pluginKindTarball},
	} {
		got, err := parsePluginSpec(tc.spec)
		if err != nil {
			t.Fatalf("parse %q: %v", tc.spec, err)
		}
		if got.Name != tc.name || got.Kind != tc.kind {
			t.Fatalf("parse %q = %+v, want name %q kind %q", tc.spec, got, tc.name, tc.kind)
		}
	}
}

func TestPluginSpecRefusesWhatRegistryCannotName(t *testing.T) {
	for _, spec := range []string{
		"",
		"-global",
		"Demo-Bundle",         // npm names are lowercase
		".hidden",             // no leading dot
		"@scope",              // a scope alone is not a package
		"demo bundle",         // a space is never part of a name
		"demo-bundle@latest!", // the range is not a range
	} {
		if got, err := parsePluginSpec(spec); err == nil {
			t.Fatalf("parse %q = %+v, want a refusal", spec, got)
		}
	}
}

func TestPluginsInstallRefusesNonRegistryByDefault(t *testing.T) {
	writePluginsProfile(t)
	_, ts, _ := testManagementServer(t, "tok")
	for _, spec := range []string{"git+https://host/x", "https://host/u/r.tgz", "file:../x"} {
		r := mgmtPost(t, ts.URL+"/api/v1/plugins/install", "tok", map[string]any{"spec": spec})
		if r.OK || !strings.Contains(r.Error, "allow_non_registry") {
			t.Fatalf("%s: ok=%v error=%q, want the switch named", spec, r.OK, r.Error)
		}
	}
}

func TestPluginsInstallAllowsNonRegistryWhenSwitchedOn(t *testing.T) {
	writePluginsProfile(t)
	mgmt, ts, _ := testManagementServer(t, "tok")
	mgmt.SetPluginInstallPolicy(func() PluginInstallPolicy { return PluginInstallPolicy{AllowNonRegistry: true} })
	t.Setenv("PATH", t.TempDir()) // no dsh: the spec passes parsing and stops at the real check
	noAppDSH(t)
	r := mgmtPost(t, ts.URL+"/api/v1/plugins/install", "tok", map[string]any{"spec": "git+https://host/x"})
	if r.OK || !strings.Contains(r.Error, "npm i -g @deepseek-ai/dsh") {
		t.Fatalf("ok=%v error=%q, want it to get past the source check", r.OK, r.Error)
	}
}

func TestPluginsInspectSaysWhereItComesFrom(t *testing.T) {
	writePluginsProfile(t)
	// A stand-in registry: the page must show the publisher, version and bundle flag, and the exact
	// URL it asked, without the bridge reaching out to the real npm during a test.
	var asked string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		asked = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"name":"demo-bundle","version":"0.4.2","description":"Demo bundle",
			"_npmUser":{"name":"publisher-x"},"engines":{"dsh":"^0.2.0"},"dsh":{"bundle":{"patch":["./p.yml"]}}}`))
	}))
	defer srv.Close()

	mgmt, ts, _ := testManagementServer(t, "tok")
	mgmt.SetPluginInstallPolicy(func() PluginInstallPolicy { return PluginInstallPolicy{Registry: srv.URL} })

	r := mgmtGet(t, ts.URL+"/api/v1/plugins/inspect?spec=demo-bundle", "tok")
	if !r.OK {
		t.Fatalf("inspect failed: %s", r.Error)
	}
	var got PluginInspection
	if err := json.Unmarshal(r.Data, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.Kind != pluginKindRegistry || !got.Allowed || got.Publisher != "publisher-x" || got.Version != "0.4.2" {
		t.Fatalf("inspect = %+v, want a registry row naming publisher-x at 0.4.2", got)
	}
	if !got.Bundle {
		t.Fatalf("bundle = false, want true for a package declaring dsh.bundle")
	}
	if got.Requires != "engines.dsh ^0.2.0" {
		t.Fatalf("requires=%q, want the engines range", got.Requires)
	}
	// Whether it fits this DSH is checked against a version this test states, not whatever dsh
	// happens to be on PATH: the HTTP route reads the real one, and either answer is honest.
	direct := inspectPluginSpec(context.Background(), pluginSpec{Raw: "demo-bundle", Name: "demo-bundle", Kind: pluginKindRegistry},
		PluginInstallPolicy{Registry: srv.URL}, "0.2.1-rc.5")
	if direct.Compatible == nil || !*direct.Compatible {
		t.Fatalf("compatible=%v for engines.dsh ^0.2.0 at 0.2.1-rc.5, want a match", direct.Compatible)
	}
	if got.Registry != srv.URL+"/" || asked != "/demo-bundle/latest" {
		t.Fatalf("registry=%q asked=%q, want the configured registry and /demo-bundle/latest", got.Registry, asked)
	}
	if got.Required == "" {
		t.Fatalf("the confirm step must say what the plugin may do")
	}
}

func TestPluginsInspectRefusesGitWhileOffAndSaysWhatToDo(t *testing.T) {
	writePluginsProfile(t)
	_, ts, _ := testManagementServer(t, "tok")
	r := mgmtGet(t, ts.URL+"/api/v1/plugins/inspect?spec="+url.QueryEscape("git+https://host/x"), "tok")
	if !r.OK {
		t.Fatalf("inspect should describe a refused spec, not error: %s", r.Error)
	}
	var got PluginInspection
	if err := json.Unmarshal(r.Data, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.Kind != pluginKindGit || got.Allowed || !strings.Contains(got.Reason, "allow_non_registry") {
		t.Fatalf("inspect = %+v, want git refused with the switch named", got)
	}
}

func TestPluginsInspectReportsARegistryMissWithoutBlocking(t *testing.T) {
	writePluginsProfile(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "not found", http.StatusNotFound)
	}))
	defer srv.Close()
	mgmt, ts, _ := testManagementServer(t, "tok")
	mgmt.SetPluginInstallPolicy(func() PluginInstallPolicy { return PluginInstallPolicy{Registry: srv.URL} })
	r := mgmtGet(t, ts.URL+"/api/v1/plugins/inspect?spec=demo-bundle", "tok")
	if !r.OK {
		t.Fatalf("inspect failed: %s", r.Error)
	}
	var got PluginInspection
	_ = json.Unmarshal(r.Data, &got)
	if got.Error == "" || !got.Allowed {
		t.Fatalf("inspect = %+v, want a readable error and the run still allowed", got)
	}
}

func TestDSHRangeAcceptsCommonForms(t *testing.T) {
	for _, tc := range []struct {
		require, version string
		want, understood bool
	}{
		{"^0.2.0", "0.2.1-rc.5", true, true},
		{"^0.3.0", "0.2.1-rc.5", false, true},
		{"~0.2.0", "0.3.0", false, true},
		{">=0.2.0", "0.2.1-rc.5", true, true},
		{"0.2.1-rc.5", "0.2.1-rc.5", true, true},
		{"*", "0.2.1-rc.5", true, true},
		// A shape this build does not evaluate is left to DSH, not guessed at.
		// ">=0.2.1-rc.3 <0.3.0-0" is how real DSH plugins write it: a space-separated AND list.
		{">=0.2.1-rc.3 <0.3.0-0", "0.2.1-rc.5", true, true},
		{">=0.2.1-rc.3 <0.3.0-0", "0.3.0", false, true},
		{">=1 <2 || >=3", "0.2.1-rc.5", false, false},
		{"workspace:^", "0.2.1-rc.5", false, false},
	} {
		ok, understood := dshRangeAccepts(tc.require, tc.version)
		if ok != tc.want || understood != tc.understood {
			t.Fatalf("dshRangeAccepts(%q, %q) = %v,%v; want %v,%v", tc.require, tc.version, ok, understood, tc.want, tc.understood)
		}
	}
}

func TestClassifyPluginFailureNamesIncompatible(t *testing.T) {
	log := "dsh: installation rejected: Plugin @deepseek-ai/dsh-web-app@0.0.1-rc.1 is incompatible with dsh 0.2.1-rc.5: requirements {…}.\ndsh: nothing was installed.\ndsh: to accept the risk, run: dsh plugin --profile web allow-version …"
	if got := classifyPluginFailure(log, false); got != "incompatible" {
		t.Fatalf("classify = %q, want incompatible", got)
	}
	if got := classifyPluginFailure("dsh: pnpm was not found; install pnpm and make it available on PATH.\n", false); got != "pnpm-missing" {
		t.Fatalf("classify = %q, want pnpm-missing", got)
	}
}

func TestPluginsWriteRoutesRefuseWithoutToken(t *testing.T) {
	writePluginsProfile(t)
	// testManagementServer(t, "") builds a server whose authenticate() accepts everyone; the two
	// write routes must still refuse, because such a port cannot tell the owner from anyone else.
	_, ts, _ := testManagementServer(t, "")
	r := mgmtPost(t, ts.URL+"/api/v1/plugins/install", "", map[string]any{"spec": "is-number"})
	if r.OK || !strings.Contains(r.Error, "token") {
		t.Fatalf("install: ok=%v error=%q, want a token refusal", r.OK, r.Error)
	}
	r = mgmtPost(t, ts.URL+"/api/v1/plugins/switch", "", map[string]any{"name": "x", "enabled": false})
	if r.OK || !strings.Contains(r.Error, "token") {
		t.Fatalf("switch: ok=%v error=%q, want a token refusal", r.OK, r.Error)
	}
}

func TestPluginProfileLockWaitsForTheHolder(t *testing.T) {
	dir := t.TempDir()
	manifest := dir + "/package.json"
	ran := false
	if err := withPluginProfileLock(manifest, func() error { ran = true; return nil }); err != nil {
		t.Fatalf("lock: %v", err)
	}
	if !ran {
		t.Fatalf("the operation did not run")
	}
	// The lock is released: a second call is not blocked by the first.
	if err := withPluginProfileLock(manifest, func() error { return nil }); err != nil {
		t.Fatalf("second lock: %v", err)
	}
}

func TestPluginProfileLockTakesOverADeadHolder(t *testing.T) {
	dir := t.TempDir()
	manifest := dir + "/package.json"
	// A pid that cannot be running: probe with an absurd pid; the record says it holds the lock.
	if err := os.WriteFile(manifest+".lock", []byte("999999999\n"), 0o600); err != nil {
		t.Fatalf("seed lock: %v", err)
	}
	if err := withPluginProfileLock(manifest, func() error { return nil }); err != nil {
		t.Fatalf("a lock whose holder is gone should be taken over: %v", err)
	}
}
