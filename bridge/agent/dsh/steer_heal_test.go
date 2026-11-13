package dsh

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A stock dsh-acp (the hunks' context of dsh/runtime-patches/dsh-acp-steer.patch) gets all three
// edits; a second run changes nothing; an unknown version is left alone.
func TestApplySteerEdits(t *testing.T) {
	stock := "\tasync prompt(params, imageEnabled, requestSignal) {\n" +
		"\t\tthis.assertActive();\n\t\tif (this.inflight !== void 0) throw invalidParams$1(\"a prompt is already in flight for this session\");\n" +
		"\t}\n\t/** Cancel the active prompt, or autonomous work when no ACP prompt exists. */\n\tcancel() {\n\t}\n" +
		"\t\t\t\t\t\tresume: {}\n\t\t\t\t\t}\n\t\t\t\t},\n\t\t\t\tauthMethods: []\n"
	out, ok := applySteerEdits(stock)
	if !ok {
		t.Fatal("stock dsh-acp not patched")
	}
	for _, want := range []string{"return this.steerPrompt(", "async steerPrompt(", "_meta: { \"dsh/steer\": true }", "\tcancel() {"} {
		if !strings.Contains(out, want) {
			t.Fatalf("patched file lacks %q", want)
		}
	}
	if strings.Index(out, "async steerPrompt(") > strings.Index(out, "\tcancel() {") {
		t.Fatal("steerPrompt must go before cancel()")
	}
	if _, ok := applySteerEdits("const x = 1;\n"); ok {
		t.Fatal("unknown version must not be patched")
	}
}

// healSteer finds dsh-acp from `node <pkg>/lib/bin.js` and writes the patch back with a backup.
func TestHealSteerFromNodeArgs(t *testing.T) {
	src := os.Getenv("DSH_ACP_STOCK") // optional: a real stock index.js to check against
	if src == "" {
		t.Skip("DSH_ACP_STOCK not set")
	}
	stock, err := os.ReadFile(src)
	if err != nil {
		t.Fatal(err)
	}
	pkg := filepath.Join(t.TempDir(), "lib", "node_modules", "@deepseek-ai", "dsh")
	js := filepath.Join(pkg, "node_modules", "@deepseek-ai", "dsh-acp", "lib", "index.js")
	if err := os.MkdirAll(filepath.Dir(js), 0o755); err != nil {
		t.Fatal(err)
	}
	os.MkdirAll(filepath.Join(pkg, "lib"), 0o755)
	os.WriteFile(filepath.Join(pkg, "package.json"), []byte(`{"name": "@deepseek-ai/dsh"}`), 0o644)
	os.WriteFile(filepath.Join(pkg, "lib", "bin.js"), nil, 0o644)
	os.WriteFile(js, stock, 0o644)
	healSteer("/usr/local/bin/node", []string{filepath.Join(pkg, "lib", "bin.js"), "--profile", "acp"})
	b, _ := os.ReadFile(js)
	if want := os.Getenv("DSH_ACP_WANT"); want != "" {
		w, _ := os.ReadFile(want)
		if string(w) != string(b) {
			t.Fatal("healed file differs from `patch` output")
		}
	}
	if !strings.Contains(string(b), steerHealMarker) {
		t.Fatal("not healed")
	}
	if _, err := os.Stat(js + ".bak-presteer"); err != nil {
		t.Fatal("no backup")
	}
}
