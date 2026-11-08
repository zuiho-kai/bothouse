package core

// 插件配置 (#150 ②a): 在面板里读一份插件自己的 config，改完存回 profile 的 patch。
//
// 为什么是 YAML 文本而不是表单：插件的 config 由插件自己校验，面板不知道字段；而且用户的 patch
// 里有 `!!js` 表达式（例如 conest-collab 的 dataDir），按字符串读出来再写回去会悄悄变成字面量，
// 配置就坏了。这里原样给文本、原样收文本，`!!js` 一个字符都不动（yaml.v3 的 Node 保留标签和注释，
// 实测 roundtrip：/Users/xinyangzhai/agents-demo/notes/closeout360-evidence/plugin-config-probe）。
//
// 写的是 DSH 自己的文件：$DSH_HOME/profiles/<profile>/cordis.patch.yml（user layer）。和
// setDSHModuleDisabled 同一套约定：改最后一处覆盖、写前留带时间戳的 .bak-、0600。

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// Which layer set a row's config. The order is DSH's apply order: bundle patches, then the
// profile patch, then HOME — the last one that says anything is what runs.
const (
	pluginConfigLayerProfile = "profile"
	pluginConfigLayerBundle  = "bundle"
	pluginConfigLayerHome    = "home"
	pluginConfigLayerNone    = "none"
)

// DSHPluginConfig is one row's config as the panel needs it: the text to edit, which layer it came
// from, and whether saving here would actually change anything.
type DSHPluginConfig struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Layer: "profile" (the file this saves to), "bundle" (the plugin's own patch, editable by
	// saving an override here), "home" ($DSH_HOME/cordis.patch.yml, applies to every profile),
	// "none" (nothing sets it: the row runs on its code defaults).
	Layer string `json:"layer"`
	// Editable is false for a HOME-controlled value: a profile write there would look saved and
	// change nothing. The modules page refuses the same case (validateDSHModuleChange).
	Editable bool   `json:"editable"`
	Reason   string `json:"reason,omitempty"`
	// ConfigYAML is the config in effect, as YAML text; "" when Layer is "none".
	ConfigYAML string `json:"config_yaml"`
	// Overridden: this profile's patch sets the row's config itself, so saving replaces it and
	// clearing the text removes it.
	Overridden bool `json:"overridden"`
}

// pluginConfigLayers reads the layers that can set a row's config, in DSH's apply order.
//
// Both package.json files are read as JSON, with the same helpers the plugins list uses
// (readPluginManifest and json.Unmarshal into dshBundlePatch). Decoding them as YAML is what made
// the string form of `dsh.bundle.patch` disappear from this page while the plugins list still
// listed the rows: one decoder, so the two pages cannot disagree about which layers exist.
func pluginConfigLayers() (dir string, bundles []*yaml.Node, profile, home *yaml.Node, err error) {
	dir = dshProfileDir()
	manifest, _, err := readPluginManifest(dir)
	if err != nil {
		return dir, nil, nil, nil, err
	}
	anchor := dshInstallAnchor()
	for _, name := range manifest.DSH.Profile.Bundles {
		pkgDir := resolveDSHBundle(name, anchor, dir)
		var pkg struct {
			DSH struct {
				Bundle struct {
					Patch dshBundlePatch `json:"patch"`
				} `json:"bundle"`
			} `json:"dsh"`
		}
		raw, err := os.ReadFile(filepath.Join(pkgDir, "package.json"))
		if err != nil {
			if os.IsNotExist(err) {
				// A bundle that is not on disk sets nothing. The plugins list already says
				// "files-missing" on that row, so this page does not fail over it.
				continue
			}
			return dir, nil, nil, nil, fmt.Errorf("bundle %s 的 package.json 读不了: %w", name, err)
		}
		// JSON, not YAML: `dsh.bundle.patch` is written either as one path ("patch": "./x.yml",
		// which conest-collab and dsh-base both use) or as an ordered array (dsh-web-app), and
		// dshBundlePatch only has UnmarshalJSON. Decoding it as YAML makes the string form fail
		// with "cannot unmarshal !!str" — silently, and then the whole layer is missing from this
		// page while the plugin list (also JSON) happily lists its rows. Same decoder as
		// listDSHPlugins, so the two pages cannot disagree about which bundles have a patch.
		if err := json.Unmarshal(raw, &pkg); err != nil {
			// Not skipped: if a bundle's patch list cannot be read, this page cannot say what a
			// row's config is, and saying "nothing set it" would be a made-up answer.
			return dir, nil, nil, nil, fmt.Errorf("bundle %s 的 package.json 读不懂: %w", name, err)
		}
		for _, rel := range pkg.DSH.Bundle.Patch {
			layer, err := readDSHPatch(filepath.Join(pkgDir, rel))
			if err != nil {
				return dir, nil, nil, nil, fmt.Errorf("bundle %s 的 patch %s: %w", name, rel, err)
			}
			bundles = append(bundles, layer)
		}
	}
	if profile, err = readDSHPatch(filepath.Join(dir, "cordis.patch.yml")); err != nil {
		return dir, nil, nil, nil, err
	}
	if home, err = readDSHPatch(filepath.Join(dshHome(), "cordis.patch.yml")); err != nil {
		return dir, nil, nil, nil, err
	}
	return dir, bundles, profile, home, nil
}

// pluginConfigRow finds the row a config request names. Only a row this profile actually loads is
// accepted: a made-up id would be a patch DSH warns about and skips.
func pluginConfigRow(id string) (DSHPluginRow, bool) {
	for _, p := range listDSHPlugins().Plugins {
		for _, row := range p.Rows {
			if row.ID == id {
				return row, true
			}
		}
	}
	return DSHPluginRow{}, false
}

// configEntry finds the row's config as one layer applies it, plus the entries a save may touch.
//
// Two different questions, and they do not always have the same answer:
//
//   - cfg is "what this layer says the config is": the last entry for this id that actually sets
//     a `config`. An entry without one says nothing about the config — it does not clear it — so it
//     must not knock out a value set further up. (Inserted rows are the exception DSH makes
//     implicitly: an insert is the row's definition, so its own config is the value.)
//   - owner is the entry cfg came from, i.e. the one to rewrite or to strip when clearing.
//   - entry is "where a save should land when nothing sets a config yet": the last entry for this
//     id, with or without a config. Writing the config there keeps one entry per id instead of
//     stacking another below it, and DSH applies the last matching patch anyway.
//
// `name` is an optional guard: DSH skips a patch whose name does not match the target, so this does too.
func configEntry(layer *yaml.Node, id, name string) (entry *yaml.Node, cfg *yaml.Node, owner *yaml.Node) {
	if layer == nil || len(layer.Content) == 0 {
		return nil, nil, nil
	}
	for _, e := range layer.Content[0].Content {
		if e.Kind != yaml.MappingNode {
			continue
		}
		if inserted := mapGet(e, "insert"); inserted != nil {
			if inserted.Kind != yaml.SequenceNode {
				continue
			}
			for _, item := range inserted.Content {
				itemID, itemName := mapGet(item, "id"), mapGet(item, "name")
				if itemID == nil || itemID.Value != id {
					continue
				}
				if itemName != nil && name != "" && itemName.Value != name {
					continue
				}
				// The entry is remembered even when it sets no config: a save should add
				// the config key there rather than append a second entry for the same id.
				entry = item
				if c := mapGet(item, "config"); c != nil {
					cfg, owner = c, item
				}
			}
			continue
		}
		entryID := mapGet(e, "id")
		if entryID == nil || entryID.Value != id {
			continue
		}
		if guard := mapGet(e, "name"); guard != nil && name != "" && guard.Value != name {
			continue
		}
		// An entry with no `config` says nothing about the config; it does not clear it, so only
		// a real `config` replaces cfg. The entry itself is still where a save writes.
		entry = e
		if c := mapGet(e, "config"); c != nil {
			cfg, owner = c, e
		}
	}
	return entry, cfg, owner
}

// nodeToYAMLText renders one node as YAML at DSH's own indentation, keeping !!js tags.
func nodeToYAMLText(n *yaml.Node) (string, error) {
	var buf strings.Builder
	enc := yaml.NewEncoder(&buf)
	enc.SetIndent(2) // 来源：DSH 自己写的 cordis.patch.yml 是 2 空格缩进（~/.dsh/profiles/web/cordis.patch.yml）
	if err := enc.Encode(n); err != nil {
		return "", err
	}
	if err := enc.Close(); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// GetDSHPluginConfig reads one row's config in effect and which layer set it.
func GetDSHPluginConfig(id string) (DSHPluginConfig, error) {
	_, bundles, profile, home, err := pluginConfigLayers()
	if err != nil {
		return DSHPluginConfig{}, err
	}
	row, ok := pluginConfigRow(id)
	if !ok {
		return DSHPluginConfig{}, fmt.Errorf("插件配置：这份 profile 里没有 id 为 %s 的行", id)
	}
	out := DSHPluginConfig{ID: row.ID, Name: row.Name, Layer: pluginConfigLayerNone, Editable: true}
	for _, layer := range bundles {
		_, cfg, _ := configEntry(layer, id, row.Name)
		if cfg == nil {
			continue
		}
		if out.ConfigYAML, err = nodeText(cfg); err != nil {
			return DSHPluginConfig{}, err
		}
		out.Layer = pluginConfigLayerBundle
	}
	if _, cfg, _ := configEntry(profile, id, row.Name); cfg != nil {
		if out.ConfigYAML, err = nodeText(cfg); err != nil {
			return DSHPluginConfig{}, err
		}
		out.Layer, out.Overridden = pluginConfigLayerProfile, true
	}
	if _, cfg, _ := configEntry(home, id, row.Name); cfg != nil {
		if out.ConfigYAML, err = nodeText(cfg); err != nil {
			return DSHPluginConfig{}, err
		}
		out.Layer = pluginConfigLayerHome
		out.Editable = false
		out.Reason = "这条配置由 HOME 的 " + filepath.Join(dshHome(), "cordis.patch.yml") + " 全局决定，在这里存了也不生效；要改请改那一份。"
	}
	if out.ConfigYAML == "" {
		out.Layer = pluginConfigLayerNone
	}
	return out, nil
}

// nodeText renders a config node for the panel. A failure to render is reported, not turned into
// "": an empty string means "nothing sets this" to the panel, and saying that about a value we
// simply could not print would invite someone to overwrite it with a one-field config.
func nodeText(n *yaml.Node) (string, error) {
	text, err := nodeToYAMLText(n)
	if err != nil {
		return "", fmt.Errorf("插件配置：这段配置读出来了但打印不出来: %w", err)
	}
	return strings.TrimSuffix(text, "\n"), nil
}

// SetDSHPluginConfig stores the edited text as this row's config in the profile patch; empty text
// removes the override. Nothing else about the row changes.
//
// The text is not re-typed: whatever YAML the person wrote is parsed into a Node, so `!!js` stays an
// expression. Expression syntax and field schemas belong to DSH/the plugin; counting brackets
// here would incorrectly reject valid strings and regular expressions. No expression is executed.
func SetDSHPluginConfig(id, configYAML string) (DSHPluginConfig, bool, error) {
	// The whole read-modify-write runs under DSH's profile lock, as handlePluginsSwitch does:
	// DSH's own Plugins page and `dsh plugin add` write this same file, and reading outside the
	// lock would let one of them add an entry after our snapshot and have it silently dropped.
	var out DSHPluginConfig
	changed := false
	err := withPluginProfileLock(filepath.Join(dshProfileDir(), "package.json"), func() error {
		state, changed1, err := setDSHPluginConfigLocked(id, configYAML)
		out, changed = state, changed1
		return err
	})
	return out, changed, err
}

func setDSHPluginConfigLocked(id, configYAML string) (DSHPluginConfig, bool, error) {
	state, err := GetDSHPluginConfig(id)
	if err != nil {
		return DSHPluginConfig{}, false, err
	}
	if !state.Editable {
		return state, false, fmt.Errorf("%s", state.Reason)
	}
	var cfg *yaml.Node
	if text := strings.TrimSpace(configYAML); text != "" {
		var parsed yaml.Node
		if err := yaml.Unmarshal([]byte(text), &parsed); err != nil {
			return state, false, fmt.Errorf("这段配置不是合法的 YAML：%w", err)
		}
		if len(parsed.Content) == 0 {
			return state, false, fmt.Errorf("这段配置是空的；要恢复默认请留空再存")
		}
		cfg = parsed.Content[0]
		if cfg.Kind != yaml.MappingNode {
			return state, false, fmt.Errorf("插件的 config 必须是一组「字段: 值」，这段不是")
		}
	}
	dir, _, _, _, err := pluginConfigLayers()
	if err != nil {
		return state, false, err
	}
	path := filepath.Join(dir, "cordis.patch.yml")
	doc, err := readDSHPatch(path)
	if err != nil {
		return state, false, err
	}
	last, _, owner := configEntry(doc, id, state.Name)
	// Rewrite or strip the entry that actually carries the config; only when nothing does yet do
	// we fall back to the last entry for this id (which is where a new config belongs).
	target := owner
	if target == nil {
		target = last
	}
	changed := false
	switch {
	case cfg == nil && target == nil:
		return state, false, nil
	case cfg == nil:
		// Clearing drops the config key. The entry itself goes only when it is a bare
		// `- id: … / name: …` with no comment and no other setting on it — an entry someone
		// wrote by hand usually carries a note above it (「来源：…」), and removing that would
		// delete the person's explanation, not our override. An entry left without a config is a
		// no-op for DSH, so keeping it is always safe; deleting someone's `disabled` is not.
		// DSH permits several patches for the same row. Clear every profile override,
		// otherwise an older config becomes active instead of the advertised bundle default.
		for {
			_, _, owner := configEntry(doc, id, state.Name)
			if owner == nil {
				break
			}
			for i := 0; i+1 < len(owner.Content); i += 2 {
				if owner.Content[i].Value == "config" {
					owner.Content = append(owner.Content[:i], owner.Content[i+2:]...)
					changed = true
					break
				}
			}
			dropEntryIfUncommented(doc.Content[0], owner)
		}
	case target == nil:
		added := &yaml.Node{Kind: yaml.MappingNode}
		mapSet(added, "id", &yaml.Node{Kind: yaml.ScalarNode, Value: id})
		if state.Name != "" {
			mapSet(added, "name", &yaml.Node{Kind: yaml.ScalarNode, Value: state.Name})
		}
		mapSet(added, "config", cfg)
		doc.Content[0].Content = append(doc.Content[0].Content, added)
		changed = true
	default:
		mapSet(target, "config", cfg)
		changed = true
	}
	if !changed {
		return state, false, nil
	}
	// The whole file is re-emitted from the parsed document, so comments, `!!js` tags and entry
	// order survive (see the probe); indentation is pinned to DSH's so a one-field save is a
	// one-field diff.
	text, err := nodeToYAMLText(doc.Content[0])
	if err != nil {
		return state, false, err
	}
	before, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return state, false, err
	}
	// Saving the same text again is not a change: comparing the rendered file with what is on disk
	// keeps a repeated save (or a save of an identical value) from leaving another copy behind.
	if string(before) == text {
		return state, false, nil
	}
	if err == nil {
		// 来源：沿用配置变更的时间戳备份（setDSHModuleDisabled），保留用户原始 patch。
		if err := AtomicWriteFile(path+".bak-"+time.Now().Format("20060102-150405.000000000"), before, 0600); err != nil {
			return state, false, err
		}
	}
	if err := AtomicWriteFile(path, []byte(text), 0600); err != nil {
		return state, false, err
	}
	after, err := GetDSHPluginConfig(id)
	return after, true, err
}

// entryHasOnlyOurFields reports whether a patch entry carries nothing but the fields a save would
// have written itself, so dropping it loses no setting. Only `id` and `name` qualify: `id` is the
// row, `name` is the guard we add. `disabled` is emphatically not ours — it is the person's
// switch, whether the modules page wrote it or they typed it, and deleting the entry would turn a
// plugin they turned off back on. A config-less entry is a no-op for DSH, so keeping it costs
// nothing.
func entryHasOnlyOurFields(entry *yaml.Node) bool {
	for i := 0; i+1 < len(entry.Content); i += 2 {
		switch entry.Content[i].Value {
		case "id", "name":
		default:
			return false
		}
	}
	return true
}

// dropEntryIfUncommented removes an entry only when it is exactly what a save would have written
// itself: no comment anywhere on it, and nothing but id/name inside. An entry someone wrote by
// hand usually carries a note above it (「来源：…」) — deleting that note is worse than leaving
// `- id: x` behind, which DSH merges nothing into and ignores. Same for any real setting left on
// the entry (see entryHasOnlyOurFields).
func dropEntryIfUncommented(seq *yaml.Node, entry *yaml.Node) {
	if entry.HeadComment != "" || entry.LineComment != "" || entry.FootComment != "" {
		return
	}
	if !entryHasOnlyOurFields(entry) {
		return
	}
	for i, e := range seq.Content {
		if e == entry {
			seq.Content = append(seq.Content[:i:i], seq.Content[i+1:]...)
			return
		}
	}
}

// ── HTTP ──────────────────────────────────────────────────────

// handlePluginsConfig is the 插件配置 (#150 ②a) route: GET ?id= reads one row's config,
// POST writes it. Both need the management token's writes gate for the POST; GET is read-only.
func (m *ManagementServer) handlePluginsConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		state, err := GetDSHPluginConfig(r.URL.Query().Get("id"))
		if err != nil {
			mgmtError(w, http.StatusBadRequest, err.Error())
			return
		}
		mgmtJSON(w, http.StatusOK, state)
	case http.MethodPost:
		if !m.requirePluginWrites(w) {
			return
		}
		var req struct {
			ID     string `json:"id"`
			Config string `json:"config_yaml"`
		}
		if !decodeBody(w, r, &req) {
			return
		}
		state, changed, err := SetDSHPluginConfig(req.ID, req.Config)
		if err != nil {
			mgmtError(w, http.StatusBadRequest, err.Error())
			return
		}
		mgmtJSON(w, http.StatusOK, map[string]any{
			"changed": changed,
			// The value only lands on the next DSH start, like every other profile edit here.
			"restart_required": changed,
			"config":           state,
		})
	default:
		mgmtError(w, http.StatusMethodNotAllowed, "GET or POST")
	}
}
