package core

// DSH modules use the profile's native Cordis disabled overrides. Dependencies and
// collab data stay in place, so enabling again never removes roles or history (#812).
import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"gopkg.in/yaml.v3"
)

type DSHModuleState struct {
	Installed bool `json:"installed"`
	Disabled  bool `json:"disabled"`
}

// dshModuleProfile reads only the selected profile, never extracting embedded
// resources or initializing DSH. Status and dry runs must leave a fresh HOME empty.
type dshModulePlugin struct {
	ID       string
	Name     string
	Disabled bool
}

func dshPluginName(name string) bool {
	return name == "conest-collab" || name == "bothouse-dsh" || name == "@deepseek-ai/dsh-experimental-client-ui-discord"
}

func readDSHPatch(path string) (*yaml.Node, error) {
	doc := &yaml.Node{Kind: yaml.DocumentNode, Content: []*yaml.Node{{Kind: yaml.SequenceNode}}}
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return doc, nil
	}
	if err != nil {
		return nil, err
	}
	if err := yaml.Unmarshal(raw, doc); err != nil {
		return nil, err
	}
	if len(doc.Content) == 0 {
		doc.Content = []*yaml.Node{{Kind: yaml.SequenceNode}}
	}
	if doc.Content[0].Kind != yaml.SequenceNode {
		return nil, fmt.Errorf("DSH profile patch must be a sequence")
	}
	return doc, nil
}

// Read the bundles DSH actually registers, followed by the user patch. Merely
// declaring a dependency does not load it. Only root insertions create our flat
// plugin entries; ordinary patches match existing IDs and optional name guards.
func dshModuleProfile() (DSHModuleState, []dshModulePlugin, *yaml.Node, error) {
	var state DSHModuleState
	dir := filepath.Join(dshHome(), "profiles", DSHProfile)
	var manifest struct {
		DSH struct{ Profile struct{ Bundles []string } }
	}
	if raw, err := os.ReadFile(filepath.Join(dir, "package.json")); err == nil {
		if err := json.Unmarshal(raw, &manifest); err != nil {
			return state, nil, nil, err
		}
	} else if !os.IsNotExist(err) {
		return state, nil, nil, err
	}
	var layers []*yaml.Node
	for _, bundle := range manifest.DSH.Profile.Bundles {
		if bundle != "conest-collab" && bundle != "bothouse-dsh" {
			continue
		}
		packageDir := filepath.Join(dir, "node_modules", bundle)
		var pkg struct {
			DSH struct{ Bundle struct{ Patch string } }
		}
		raw, err := os.ReadFile(filepath.Join(packageDir, "package.json"))
		if err != nil {
			return state, nil, nil, fmt.Errorf("DSH bundle %s is not installed: %w", bundle, err)
		}
		if err := json.Unmarshal(raw, &pkg); err != nil {
			return state, nil, nil, err
		}
		if pkg.DSH.Bundle.Patch == "" {
			return state, nil, nil, fmt.Errorf("DSH bundle %s has no patch", bundle)
		}
		patchPath := filepath.Join(packageDir, pkg.DSH.Bundle.Patch)
		if _, err := os.Stat(patchPath); err != nil {
			return state, nil, nil, err
		}
		layer, err := readDSHPatch(patchPath)
		if err != nil {
			return state, nil, nil, err
		}
		layers = append(layers, layer)
	}
	doc, err := readDSHPatch(filepath.Join(dir, "cordis.patch.yml"))
	if err != nil {
		return state, nil, nil, err
	}
	layers = append(layers, doc)
	var plugins []dshModulePlugin
	for _, layer := range layers {
		for _, entry := range layer.Content[0].Content {
			if entry.Kind != yaml.MappingNode {
				continue
			}
			id := mapGet(entry, "id")
			if inserted := mapGet(entry, "insert"); inserted != nil {
				// An insertion with an id targets a group. Our plugins are not groups;
				// Cordis skips such a patch, including any disabled value on it.
				if id != nil || inserted.Kind != yaml.SequenceNode {
					continue
				}
				for _, item := range inserted.Content {
					itemID, name := mapGet(item, "id"), mapGet(item, "name")
					if itemID == nil || name == nil || !dshPluginName(name.Value) {
						continue
					}
					for _, p := range plugins {
						if p.ID == itemID.Value {
							return state, nil, nil, fmt.Errorf("duplicate DSH plugin id %s; manage this profile in DSH", p.ID)
						}
					}
					plugin := dshModulePlugin{ID: itemID.Value, Name: name.Value}
					if err := applyDSHDisabled(&plugin, item); err != nil {
						return state, nil, nil, err
					}
					plugins = append(plugins, plugin)
				}
				continue
			}
			if id == nil {
				continue
			}
			for i := range plugins {
				if plugins[i].ID != id.Value {
					continue
				}
				if name := mapGet(entry, "name"); name != nil && name.Value != plugins[i].Name {
					continue
				}
				if err := applyDSHDisabled(&plugins[i], entry); err != nil {
					return state, nil, nil, err
				}
			}
		}
	}
	state.Installed = len(plugins) > 0
	state.Disabled = state.Installed
	for _, p := range plugins {
		state.Disabled = state.Disabled && p.Disabled
	}
	return state, plugins, doc, nil
}

func applyDSHDisabled(plugin *dshModulePlugin, entry *yaml.Node) error {
	if d := mapGet(entry, "disabled"); d != nil {
		if d.Tag != "!!bool" {
			return fmt.Errorf("DSH plugin %s has a dynamic disabled override; manage it in DSH", plugin.ID)
		}
		plugin.Disabled = d.Value == "true"
	}
	return nil
}

func GetDSHModuleState() (DSHModuleState, error) {
	st, _, _, err := dshModuleProfile()
	return st, err
}

// Append a valid final override rather than changing an insertion or a guarded
// patch that Cordis may ignore. Return the actual write decision, not a comparison
// of the aggregate enabled state (which loses mixed-bundle changes).
func setDSHModuleDisabled(disabled bool) (DSHModuleState, bool, error) {
	st, plugins, doc, err := dshModuleProfile()
	if err != nil || !st.Installed {
		return st, false, err
	}
	changed := false
	for _, p := range plugins {
		if p.Disabled == disabled {
			continue
		}
		target := &yaml.Node{Kind: yaml.MappingNode}
		mapSet(target, "id", &yaml.Node{Kind: yaml.ScalarNode, Value: p.ID})
		mapSet(target, "name", &yaml.Node{Kind: yaml.ScalarNode, Value: p.Name})
		mapSet(target, "disabled", &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!bool", Value: strconv.FormatBool(disabled)})
		doc.Content[0].Content = append(doc.Content[0].Content, target)
		changed = true
	}
	if !changed {
		return st, false, nil
	}
	path := filepath.Join(dshHome(), "profiles", DSHProfile, "cordis.patch.yml")
	if before, err := os.ReadFile(path); err == nil {
		// 来源：沿用配置变更的时间戳备份，保留用户原始 patch。
		if err := AtomicWriteFile(path+".bak-"+time.Now().Format("20060102-150405.000000000"), before, 0600); err != nil {
			return st, false, err
		}
	} else if !os.IsNotExist(err) {
		return st, false, err
	}
	if err := writeYAML(path, doc, 0600); err != nil {
		return st, false, err
	}
	st.Disabled = disabled
	return st, true, nil
}

func SetDSHModuleDisabled(disabled bool) (DSHModuleState, error) {
	st, _, err := setDSHModuleDisabled(disabled)
	return st, err
}

type DSHModuleResult struct {
	OK        bool           `json:"ok"`
	Platform  string         `json:"platform"`
	DryRun    bool           `json:"dry_run"`
	Saved     bool           `json:"saved"`
	Error     string         `json:"error,omitempty"`
	DSH       DSHModuleState `json:"dsh"`
	NextSteps []string       `json:"next_steps"`
}

func ApplyDSHModule(ctx context.Context, disable, dryRun bool, lang string) DSHModuleResult {
	st, err := GetDSHModuleState()
	r := DSHModuleResult{Platform: "dsh", DryRun: dryRun, DSH: st, NextSteps: []string{}}
	if err != nil {
		r.Error = err.Error()
		return r
	}
	if !disable && !st.Installed {
		if _, err := LookDSH(); err != nil {
			r.Error = err.Error()
			return r
		}
		if _, issue := dshNodeStatus(ctx); issue != "" {
			r.Error = issue
			return r
		}
		if _, err := LookBash(); err != nil {
			r.Error = err.Error()
			return r
		}
	}
	if dryRun {
		r.OK = true
		r.NextSteps = []string{NewI18n(Language(lang)).T(MsgDSHModulePreview)}
		return r
	}
	if disable || st.Installed {
		r.DSH, r.Saved, err = setDSHModuleDisabled(disable)
	} else {
		var installed DSHStatus
		installed, err = InstallDSHPlugin(ctx, lang, nil)
		if err == nil && !installed.PluginInstalled {
			err = fmt.Errorf("DSH installer finished but the plugin was not detected")
		}
		if err == nil {
			r.DSH, err = GetDSHModuleState()
		}
		if err == nil && !r.DSH.Installed {
			err = fmt.Errorf("DSH installer did not register the bothouse plugin in profile web")
		}
	}
	if err != nil {
		r.Error = err.Error()
		return r
	}
	r.OK = true
	r.Saved = r.Saved || (!st.Installed && r.DSH.Installed)
	if r.DSH.Installed {
		r.NextSteps = []string{NewI18n(Language(lang)).T(MsgDSHModuleRestart)}
	}
	return r
}

// Include direct insertions as well as bundle overrides, preserving user config.
func dshModuleEntries(sequence *yaml.Node) []*yaml.Node {
	var entries []*yaml.Node
	for _, entry := range sequence.Content {
		if entry.Kind != yaml.MappingNode {
			continue
		}
		if inserted := mapGet(entry, "insert"); inserted != nil && inserted.Kind == yaml.SequenceNode {
			entries = append(entries, dshModuleEntries(inserted)...)
		}
		if mapGet(entry, "id") != nil {
			entries = append(entries, entry)
		}
	}
	return entries
}
