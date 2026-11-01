package core

// DSH modules use the profile's native Cordis disabled overrides. Dependencies and
// collab data stay in place, so enabling again never removes roles or history (#812).
import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
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
func dshModuleProfile() (DSHModuleState, []string, *yaml.Node, error) {
	var state DSHModuleState
	dir := filepath.Join(dshHome(), "profiles", DSHProfile)
	var manifest struct {
		Dependencies map[string]json.RawMessage `json:"dependencies"`
	}
	if raw, err := os.ReadFile(filepath.Join(dir, "package.json")); err == nil {
		if err := json.Unmarshal(raw, &manifest); err != nil {
			return state, nil, nil, fmt.Errorf("DSH profile package.json: %w", err)
		}
	} else if !os.IsNotExist(err) {
		return state, nil, nil, err
	}
	var ids []string
	if _, ok := manifest.Dependencies["conest-collab"]; ok {
		ids = append(ids, "conest-collab", "conest-channels-ui")
	}
	if _, ok := manifest.Dependencies["bothouse-dsh"]; ok {
		ids = append(ids, "bothouse-dsh")
	}
	doc := &yaml.Node{Kind: yaml.DocumentNode, Content: []*yaml.Node{{Kind: yaml.SequenceNode}}}
	if raw, err := os.ReadFile(filepath.Join(dir, "cordis.patch.yml")); err == nil {
		if err := yaml.Unmarshal(raw, doc); err != nil {
			return state, nil, nil, fmt.Errorf("DSH profile patch: %w", err)
		}
	} else if !os.IsNotExist(err) {
		return state, nil, nil, err
	}
	if len(doc.Content) == 0 {
		doc.Content = []*yaml.Node{{Kind: yaml.SequenceNode}}
	}
	if doc.Content[0].Kind != yaml.SequenceNode {
		return state, nil, nil, fmt.Errorf("DSH profile patch must be a sequence")
	}
	// Legacy installs may declare the plugin directly in their profile rather than a bundle.
	for _, entry := range dshModuleEntries(doc.Content[0]) {
		id, name := mapGet(entry, "id"), mapGet(entry, "name")
		if id == nil || name == nil {
			continue
		}
		if name.Value == "conest-collab" || name.Value == "bothouse-dsh" || name.Value == "@deepseek-ai/dsh-experimental-client-ui-discord" {
			if !slices.Contains(ids, id.Value) {
				ids = append(ids, id.Value)
			}
		}
	}
	state.Installed = len(ids) > 0
	state.Disabled = state.Installed
	for _, id := range ids {
		disabled := false
		for _, entry := range dshModuleEntries(doc.Content[0]) {
			if n := mapGet(entry, "id"); n != nil && n.Value == id {
				if d := mapGet(entry, "disabled"); d != nil {
					if d.Tag != "!!bool" {
						return state, nil, nil, fmt.Errorf("DSH plugin %s has a dynamic disabled override; manage it in DSH", id)
					}
					disabled = d.Value == "true"
				}
			}
		}
		state.Disabled = state.Disabled && disabled
	}
	return state, ids, doc, nil
}

func GetDSHModuleState() (DSHModuleState, error) {
	st, _, _, err := dshModuleProfile()
	return st, err
}

// SetDSHModuleDisabled changes only known plugin overrides in the web profile.
// Cordis applies the user profile layer after bundle defaults; no package removal
// or server restart is needed here. The running DSH may need restarting.
func SetDSHModuleDisabled(disabled bool) (DSHModuleState, error) {
	st, ids, doc, err := dshModuleProfile()
	if err != nil || !st.Installed {
		return st, err
	}
	changed := false
	for _, id := range ids {
		var target *yaml.Node
		for _, entry := range dshModuleEntries(doc.Content[0]) {
			if n := mapGet(entry, "id"); n != nil && n.Value == id {
				target = entry
			}
		}
		if target != nil {
			if old := mapGet(target, "disabled"); old != nil && old.Tag == "!!bool" && old.Value == strconv.FormatBool(disabled) {
				continue
			}
		} else if !disabled {
			continue
		}
		changed = true
		if target == nil {
			target = &yaml.Node{Kind: yaml.MappingNode}
			mapSet(target, "id", &yaml.Node{Kind: yaml.ScalarNode, Value: id})
			doc.Content[0].Content = append(doc.Content[0].Content, target)
		}
		mapSet(target, "disabled", &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!bool", Value: strconv.FormatBool(disabled)})
	}
	if !changed {
		return st, nil
	}
	path := filepath.Join(dshHome(), "profiles", DSHProfile, "cordis.patch.yml")
	if before, err := os.ReadFile(path); err == nil {
		// 来源：沿用配置变更的时间戳备份，保留用户原始 patch。
		if err := AtomicWriteFile(path+".bak-"+time.Now().Format("20060102-150405.000000000"), before, 0600); err != nil {
			return st, err
		}
	} else if !os.IsNotExist(err) {
		return st, err
	}
	if err := writeYAML(path, doc, 0600); err != nil {
		return st, err
	}
	st.Disabled = disabled
	return st, nil
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
		if _, err := exec.LookPath("node"); err != nil {
			r.Error = "node not found on PATH; install Node >= 22.12.0 before installing DSH"
			return r
		}
		if _, err := LookBash(); err != nil {
			r.Error = err.Error()
			return r
		}
	}
	if dryRun {
		r.OK = true
		r.NextSteps = []string{"Run without --dry-run to install or enable the DSH plugin in profile web."}
		return r
	}
	if disable || st.Installed {
		r.DSH, err = SetDSHModuleDisabled(disable)
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
	r.Saved = r.DSH.Installed && r.DSH != st
	if r.DSH.Installed {
		r.NextSteps = []string{"Restart your DSH web profile to apply; roles, history and other platform settings are preserved."}
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
