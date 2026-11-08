package core

// 插件配置 (#150 ②a): reading one row's config and saving it back.
//
// The point of these tests is the file, not the JSON: the value that must survive a save is the
// one DSH will read at the next start — including `!!js` expressions and the comments the person
// wrote — so every assertion reads the patch file back.

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writePluginConfigProfile is one DSH profile whose bundle gives a row a config with a `!!js`
// expression and a comment above it, plus a HOME patch that controls a second row globally.
func writePluginConfigProfile(t *testing.T) (home, dir string) {
	t.Helper()
	home = t.TempDir()
	dir = filepath.Join(home, "profiles", "web")
	bundleDir := filepath.Join(dir, "node_modules", "demo-bundle")
	files := map[string]string{
		filepath.Join(dir, "package.json"): `{
  "name": "dsh-profile-web",
  "dependencies": {"demo-bundle": "link:./demo-bundle"},
  "dsh": {"profile": {"bundles": ["demo-bundle"]}}
}
`,
		filepath.Join(dir, "cordis.patch.yml"): `# my own patch layer
- id: untouched
  config:
    keep: 1
`,
		filepath.Join(bundleDir, "package.json"): `{
  "name": "demo-bundle",
  "version": "0.4.2",
  "dsh": {"bundle": {"patch": ["./cordis.patch.yml"]}}
}
`,
		filepath.Join(bundleDir, "cordis.patch.yml"): `- insert:
    - id: demo-tool
      name: demo-tool
    - id: home-tool
      name: home-tool
# where the tool keeps its data
- id: demo-tool
  config:
    dataDir: !!js process.env.DEMO_DATA || (process.env.HOME + '/.demo')
`,
		filepath.Join(home, "cordis.patch.yml"): `- id: home-tool
  config:
    global: yes
`,
	}
	for path, body := range files {
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			t.Fatalf("mkdir %s: %v", filepath.Dir(path), err)
		}
		if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
			t.Fatalf("write %s: %v", path, err)
		}
	}
	t.Setenv("DSH_HOME", home)
	return home, dir
}

func TestPluginConfigReadsTheBundleLayerWithItsJSExpression(t *testing.T) {
	_, _ = writePluginConfigProfile(t)
	got, err := GetDSHPluginConfig("demo-tool")
	if err != nil {
		t.Fatalf("GetDSHPluginConfig: %v", err)
	}
	if got.Layer != pluginConfigLayerBundle || !got.Editable || got.Overridden {
		t.Fatalf("config = %+v, want an editable bundle config that the profile does not override", got)
	}
	// The expression must come back as an expression, not as the string it renders to.
	if !strings.Contains(got.ConfigYAML, "!!js process.env.DEMO_DATA") {
		t.Fatalf("config_yaml = %q, want the !!js expression intact", got.ConfigYAML)
	}
}

func TestPluginConfigSaveWritesTheProfilePatchAndKeepsTheOldFile(t *testing.T) {
	_, dir := writePluginConfigProfile(t)
	after, changed, err := SetDSHPluginConfig("demo-tool", "dataDir: /tmp/demo\nverbose: true\n")
	if err != nil {
		t.Fatalf("SetDSHPluginConfig: %v", err)
	}
	if !changed {
		t.Fatal("changed = false, want the first save to write")
	}
	if after.Layer != pluginConfigLayerProfile || !after.Overridden {
		t.Fatalf("config = %+v, want a profile override after saving", after)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "cordis.patch.yml"))
	if err != nil {
		t.Fatalf("read patch: %v", err)
	}
	text := string(raw)
	// The person's own entry and its comment are still there: this write is additive.
	if !strings.Contains(text, "# my own patch layer") || !strings.Contains(text, "id: untouched") {
		t.Fatalf("patch lost the existing entry:\n%s", text)
	}
	if !strings.Contains(text, "verbose: true") || !strings.Contains(text, "dataDir: /tmp/demo") {
		t.Fatalf("patch missing the saved config:\n%s", text)
	}
	// One `- id: demo-tool` config entry: the save replaces the override instead of stacking another.
	if got := strings.Count(text, "dataDir:"); got != 1 {
		t.Fatalf("patch has %d dataDir keys, want the override to replace the old value:\n%s", got, text)
	}
	// 来源：沿用配置变更的时间戳备份（setDSHModuleDisabled），写前存一份原文件。
	backups, err := filepath.Glob(filepath.Join(dir, "cordis.patch.yml.bak-*"))
	if err != nil || len(backups) != 1 {
		t.Fatalf("backups = %v (%v), want exactly one timestamped copy", backups, err)
	}
	before, err := os.ReadFile(backups[0])
	if err != nil {
		t.Fatalf("read backup: %v", err)
	}
	if !strings.Contains(string(before), "# my own patch layer") {
		t.Fatal("backup is not the file as it was before the save")
	}
}

func TestPluginConfigSaveKeepsJSExpressionsAndComments(t *testing.T) {
	_, dir := writePluginConfigProfile(t)
	_, _, err := SetDSHPluginConfig("demo-tool", "dataDir: !!js process.env.OTHER || '/x'\n")
	if err != nil {
		t.Fatalf("SetDSHPluginConfig: %v", err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "cordis.patch.yml"))
	if err != nil {
		t.Fatalf("read patch: %v", err)
	}
	if !strings.Contains(string(raw), "dataDir: !!js process.env.OTHER || '/x'") {
		t.Fatalf("patch stored the expression as a plain string:\n%s", raw)
	}
	if !strings.Contains(string(raw), "# my own patch layer") {
		t.Fatalf("rewriting the file dropped the person's comment:\n%s", raw)
	}
}

func TestPluginConfigClearRemovesOnlyWhatWeAdded(t *testing.T) {
	_, dir := writePluginConfigProfile(t)
	if _, _, err := SetDSHPluginConfig("demo-tool", "dataDir: /tmp/demo\n"); err != nil {
		t.Fatalf("save: %v", err)
	}
	after, changed, err := SetDSHPluginConfig("demo-tool", "")
	if err != nil {
		t.Fatalf("clear: %v", err)
	}
	if !changed {
		t.Fatal("changed = false, want clearing an override to write")
	}
	// Back to what the bundle layer says, which is what the row ran on before the override.
	if after.Layer != pluginConfigLayerBundle || after.Overridden {
		t.Fatalf("config = %+v, want the bundle value to be in effect again", after)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "cordis.patch.yml"))
	if err != nil {
		t.Fatalf("read patch: %v", err)
	}
	if strings.Contains(string(raw), "dataDir: /tmp/demo") {
		t.Fatalf("cleared override is still in the patch:\n%s", raw)
	}
	if !strings.Contains(string(raw), "id: untouched") {
		t.Fatalf("clearing removed an entry that was not ours:\n%s", raw)
	}
}

func TestPluginConfigClearRemovesAllProfileOverrides(t *testing.T) {
	_, dir := writePluginConfigProfile(t)
	path := filepath.Join(dir, "cordis.patch.yml")
	patch := "# first override\n- id: demo-tool\n  config:\n    dataDir: /old\n  disabled: true\n# second override\n- id: demo-tool\n  config:\n    dataDir: /new\n"
	if err := os.WriteFile(path, []byte(patch), 0600); err != nil {
		t.Fatal(err)
	}
	got, changed, err := SetDSHPluginConfig("demo-tool", "")
	if err != nil || !changed || got.Overridden || got.Layer != pluginConfigLayerBundle {
		t.Fatalf("clear = %+v, changed %v, err %v; want bundle defaults", got, changed, err)
	}
	raw, err := os.ReadFile(path)
	if err != nil || !strings.Contains(string(raw), "disabled: true") || !strings.Contains(string(raw), "# first override") || !strings.Contains(string(raw), "# second override") {
		t.Fatalf("clear lost switch/comments: %s (%v)", raw, err)
	}
}

func TestPluginConfigSaveFillsInAnEntryThatHasNoConfigYet(t *testing.T) {
	_, dir := writePluginConfigProfile(t)
	path := filepath.Join(dir, "cordis.patch.yml")
	// An override that only says "this row exists here", with no config of its own.
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read patch: %v", err)
	}
	withEntry := "- id: demo-tool\n  name: demo-tool\n" + string(before)
	if err := os.WriteFile(path, []byte(withEntry), 0o600); err != nil {
		t.Fatalf("write patch: %v", err)
	}
	if _, changed, err := SetDSHPluginConfig("demo-tool", "verbose: true\n"); err != nil || !changed {
		t.Fatalf("save = (changed %v, err %v), want a write", changed, err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read patch: %v", err)
	}
	// One entry for this id, not two stacked ones: DSH applies the last, so a stray config-less
	// entry below the real one would be harmless — but two entries for the same id in one file is
	// confusing to anyone reading it, and the save knows where to write.
	if got := strings.Count(string(raw), "- id: demo-tool"); got != 1 {
		t.Fatalf("patch has %d demo-tool entries:\n%s", got, raw)
	}
	if !strings.Contains(string(raw), "verbose: true") {
		t.Fatalf("config not written into the existing entry:\n%s", raw)
	}
}

func TestPluginConfigClearKeepsAHandwrittenNoteAboveTheEntry(t *testing.T) {
	_, dir := writePluginConfigProfile(t)
	path := filepath.Join(dir, "cordis.patch.yml")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read patch: %v", err)
	}
	// An override someone wrote by hand, with the note that explains why it exists.
	handwritten := string(raw) + "# 来源：总部授权，只给正式的协作数据目录\n- id: demo-tool\n  config:\n    dataDir: /srv/demo\n"
	if err := os.WriteFile(path, []byte(handwritten), 0o600); err != nil {
		t.Fatalf("write patch: %v", err)
	}
	if _, changed, err := SetDSHPluginConfig("demo-tool", ""); err != nil || !changed {
		t.Fatalf("clear = (changed %v, err %v), want a write", changed, err)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read patch: %v", err)
	}
	if strings.Contains(string(after), "dataDir: /srv/demo") {
		t.Fatalf("the override is still there:\n%s", after)
	}
	// Deleting the person's note would be deleting their explanation, not our override.
	if !strings.Contains(string(after), "# 来源：总部授权") {
		t.Fatalf("clearing removed the handwritten note:\n%s", after)
	}
}

func TestPluginConfigHomeControlledRowIsReadOnly(t *testing.T) {
	home, _ := writePluginConfigProfile(t)
	got, err := GetDSHPluginConfig("home-tool")
	if err != nil {
		t.Fatalf("GetDSHPluginConfig: %v", err)
	}
	if got.Layer != pluginConfigLayerHome || got.Editable {
		t.Fatalf("config = %+v, want a HOME-controlled row that this page cannot write", got)
	}
	if !strings.Contains(got.Reason, filepath.Join(home, "cordis.patch.yml")) {
		t.Fatalf("reason = %q, want it to name the HOME file to edit", got.Reason)
	}
	if _, changed, err := SetDSHPluginConfig("home-tool", "global: no\n"); err == nil || changed {
		t.Fatalf("save = (changed %v, err %v), want a refusal that names the HOME file", changed, err)
	}
}

func TestPluginConfigRefusesBadInput(t *testing.T) {
	_, dir := writePluginConfigProfile(t)
	cases := []struct{ name, text string }{
		{"not yaml", "dataDir: [unclosed\n"},
		{"not a mapping", "- a\n- b\n"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if _, changed, err := SetDSHPluginConfig("demo-tool", c.text); err == nil || changed {
				t.Fatalf("save = (changed %v, err %v), want a refusal", changed, err)
			}
			raw, err := os.ReadFile(filepath.Join(dir, "cordis.patch.yml"))
			if err != nil {
				t.Fatalf("read patch: %v", err)
			}
			if strings.Contains(string(raw), "dataDir: [unclosed") || strings.Contains(string(raw), "process.env.X") {
				t.Fatalf("a refused value reached the patch:\n%s", raw)
			}
		})
	}
	if _, err := GetDSHPluginConfig("no-such-row"); err == nil {
		t.Fatal("GetDSHPluginConfig on an unknown row succeeded; a made-up id must be refused")
	}
}

func TestPluginConfigAcceptsEmptyMappingAndQuotedJSBrackets(t *testing.T) {
	_, _ = writePluginConfigProfile(t)
	for _, text := range []string{"{}", "pattern: !!js new RegExp('[(]')\n", "label: !!js \"'a(b'\"\n"} {
		if _, _, err := SetDSHPluginConfig("demo-tool", text); err != nil {
			t.Errorf("valid config %q rejected: %v", text, err)
		}
	}
}

func TestPluginsConfigRouteNeedsTheTokenAndTheRow(t *testing.T) {
	_, _ = writePluginConfigProfile(t)
	_, ts, _ := testManagementServer(t, "tok")

	got := mgmtGet(t, ts.URL+"/api/v1/plugins/config?id=demo-tool", "tok")
	if !got.OK {
		t.Fatalf("GET config failed: %s", got.Error)
	}
	if bad := mgmtGet(t, ts.URL+"/api/v1/plugins/config?id=nope", "tok"); bad.OK {
		t.Fatal("GET config for an unknown row succeeded")
	}

	// No token: the API cannot tell an owner from anyone else on the machine, so it does not write.
	_, noToken, _ := testManagementServer(t, "")
	if r := mgmtPost(t, noToken.URL+"/api/v1/plugins/config", "", map[string]any{"id": "demo-tool", "config_yaml": "a: 1\n"}); r.OK {
		t.Fatal("POST without a token succeeded")
	}

	ok := mgmtPost(t, ts.URL+"/api/v1/plugins/config", "tok", map[string]any{"id": "demo-tool", "config_yaml": "a: 1\n"})
	if !ok.OK {
		t.Fatalf("POST config failed: %s", ok.Error)
	}
}

// A bundle writes `dsh.bundle.patch` either as one path or as an ordered array. The string form is
// what conest-collab and dsh-base ship, and reading it with the YAML decoder used to fail with
// "cannot unmarshal !!str" — silently, so the whole bundle layer vanished from this page while the
// plugins list still listed its rows.
func TestPluginConfigReadsABundleThatNamesOnePatchFile(t *testing.T) {
	_, dir := writePluginConfigProfile(t)
	pkgPath := filepath.Join(dir, "node_modules", "demo-bundle", "package.json")
	if err := os.WriteFile(pkgPath, []byte(`{
  "name": "demo-bundle",
  "dsh": {"bundle": {"patch": "./cordis.patch.yml"}}
}
`), 0o600); err != nil {
		t.Fatalf("write bundle package.json: %v", err)
	}
	got, err := GetDSHPluginConfig("demo-tool")
	if err != nil {
		t.Fatalf("GetDSHPluginConfig: %v", err)
	}
	if got.Layer != pluginConfigLayerBundle {
		t.Fatalf("layer = %q, want the bundle layer the string form names", got.Layer)
	}
	if !strings.Contains(got.ConfigYAML, "!!js process.env.DEMO_DATA") {
		t.Fatalf("config_yaml = %q, want the bundle config", got.ConfigYAML)
	}
}

// A bundle whose patch list cannot be read must not be reported as "nothing sets this row": that
// answer is indistinguishable from a row with no config, and the panel would offer an empty box that
// a one-field save turns into the row's whole config.
func TestPluginConfigSaysSoWhenABundleCannotBeRead(t *testing.T) {
	_, dir := writePluginConfigProfile(t)
	pkgPath := filepath.Join(dir, "node_modules", "demo-bundle", "package.json")
	if err := os.WriteFile(pkgPath, []byte(`{"name": "demo-bundle", "dsh": {"bundle": {"patch": `), 0o600); err != nil {
		t.Fatalf("write bundle package.json: %v", err)
	}
	if got, err := GetDSHPluginConfig("demo-tool"); err == nil {
		t.Fatalf("GetDSHPluginConfig = %+v, want an error rather than layer=none", got)
	} else if !strings.Contains(err.Error(), "demo-bundle") {
		t.Fatalf("error = %v, want it to name the bundle that cannot be read", err)
	}
}

// A later entry for the same id that carries no `config` says nothing about the config — it must not
// make GET report an empty bundle value, and it must not make a clear a no-op.
func TestPluginConfigIgnoresALaterEntryThatSetsNoConfig(t *testing.T) {
	_, dir := writePluginConfigProfile(t)
	path := filepath.Join(dir, "cordis.patch.yml")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read patch: %v", err)
	}
	// The override first, then a bare entry for the same row: DSH merges the second and leaves the
	// config alone, so the profile layer still says dataDir = /srv/demo.
	two := string(raw) + "- id: demo-tool\n  config:\n    dataDir: /srv/demo\n- id: demo-tool\n  name: demo-tool\n"
	if err := os.WriteFile(path, []byte(two), 0o600); err != nil {
		t.Fatalf("write patch: %v", err)
	}
	got, err := GetDSHPluginConfig("demo-tool")
	if err != nil {
		t.Fatalf("GetDSHPluginConfig: %v", err)
	}
	if got.Layer != pluginConfigLayerProfile || !strings.Contains(got.ConfigYAML, "/srv/demo") {
		t.Fatalf("config = %+v, want the profile value the config-less entry does not clear", got)
	}
	if _, changed, err := SetDSHPluginConfig("demo-tool", ""); err != nil || !changed {
		t.Fatalf("clear = (changed %v, err %v), want the override removed", changed, err)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read patch: %v", err)
	}
	if strings.Contains(string(after), "/srv/demo") {
		t.Fatalf("cleared override is still in the patch:\n%s", after)
	}
	if got, err := GetDSHPluginConfig("demo-tool"); err != nil || got.Layer != pluginConfigLayerBundle {
		t.Fatalf("config after clear = %+v (%v), want the bundle value in effect", got, err)
	}
}

// `disabled` is the person's switch. Clearing a config must not delete the entry that carries it and
// quietly turn the plugin back on.
func TestPluginConfigClearKeepsTheDisabledSwitch(t *testing.T) {
	_, dir := writePluginConfigProfile(t)
	path := filepath.Join(dir, "cordis.patch.yml")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read patch: %v", err)
	}
	turnedOff := string(raw) + "- id: demo-tool\n  disabled: true\n  config:\n    dataDir: /srv/demo\n"
	if err := os.WriteFile(path, []byte(turnedOff), 0o600); err != nil {
		t.Fatalf("write patch: %v", err)
	}
	if _, changed, err := SetDSHPluginConfig("demo-tool", ""); err != nil || !changed {
		t.Fatalf("clear = (changed %v, err %v), want the config removed", changed, err)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read patch: %v", err)
	}
	if strings.Contains(string(after), "/srv/demo") {
		t.Fatalf("config is still there:\n%s", after)
	}
	// The row must still be off: that is what the person set, not part of the override.
	if !strings.Contains(string(after), "disabled: true") {
		t.Fatalf("clearing the config dropped the disabled switch, turning the plugin back on:\n%s", after)
	}
	if off, known := disabledRowIDs(dir)["demo-tool"]; !known || !off {
		t.Fatal("the plugins list would now compose demo-tool as enabled")
	}
}

// Saving the identical text again is not a change. Without this, every save leaves a `.bak-<time>`
// copy of a file that did not change (the reviewer counted 8 files after 8 saves), and a page that
// saves on every click would fill the profile with them.
func TestPluginConfigSecondIdenticalSaveWritesNothing(t *testing.T) {
	_, dir := writePluginConfigProfile(t)
	if _, changed, err := SetDSHPluginConfig("demo-tool", "verbose: true\n"); err != nil || !changed {
		t.Fatalf("first save = (changed %v, err %v), want a write", changed, err)
	}
	if _, changed, err := SetDSHPluginConfig("demo-tool", "verbose: true\n"); err != nil || changed {
		t.Fatalf("second save = (changed %v, err %v), want no write", changed, err)
	}
	backups, err := filepath.Glob(filepath.Join(dir, "cordis.patch.yml.bak-*"))
	if err != nil {
		t.Fatalf("glob backups: %v", err)
	}
	if len(backups) != 1 {
		t.Fatalf("backups = %v, want only the one from the save that changed the file", backups)
	}
}
