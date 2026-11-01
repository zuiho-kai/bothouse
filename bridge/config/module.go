package config

// Platform modules (#812): a platform is "on" when config.toml has a section of its type that
// is not disabled. `bothouse module disable` only marks sections `disabled = true` (credentials and
// options stay); `module add` clears the mark. Personas, wiki, sessions and cron live in other
// files and are never touched here.

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"time"

	"github.com/BurntSushi/toml"
)

// ModulePlatformTypes maps a module name to the [[projects.platforms]] types it covers.
var ModulePlatformTypes = map[string][]string{
	"qq":        {"qq"},
	"discord":   {"discord"},
	"feishu":    {"feishu", "lark"},
	"cloud_web": {"cloud_web"},
}

// ModuleState is one module as config.toml has it.
type ModuleState struct {
	Enabled  []string `json:"enabled"`  // projects with an active section of this module
	Disabled []string `json:"disabled"` // projects whose sections of this module are all disabled
}

// ModuleStates reads which projects use each module. A module no project mentions is absent.
func ModuleStates(cfg *Config) map[string]ModuleState {
	out := map[string]ModuleState{}
	for mod, types := range ModulePlatformTypes {
		var st ModuleState
		for _, p := range cfg.Projects {
			on, off := false, false
			for _, pc := range p.Platforms {
				if !containsString(types, pc.Type) {
					continue
				}
				if pc.Disabled {
					off = true
				} else {
					on = true
				}
			}
			switch {
			case on:
				st.Enabled = append(st.Enabled, p.Name)
			case off:
				st.Disabled = append(st.Disabled, p.Name)
			}
		}
		if len(st.Enabled)+len(st.Disabled) > 0 {
			out[mod] = st
		}
	}
	return out
}

// SetModuleDisabled marks every section of the module disabled (or clears the mark), one
// read-modify-write under configMu on the TOML document like ApplyWizardProjects, so keys this
// build does not know survive; the previous file is copied to config.toml.bak-<time> first.
// It returns the projects whose sections changed (none: nothing written, backup "").
func SetModuleDisabled(module string, disabled bool) (changed []string, backup string, err error) {
	types, ok := ModulePlatformTypes[module]
	if !ok {
		return nil, "", fmt.Errorf("unknown module %q", module)
	}
	configMu.Lock()
	defer configMu.Unlock()
	if ConfigPath == "" {
		return nil, "", fmt.Errorf("config path not set")
	}
	raw, err := os.ReadFile(ConfigPath)
	if errors.Is(err, fs.ErrNotExist) { // a fresh install: no module is configured, nothing to change
		return nil, "", nil
	}
	if err != nil {
		return nil, "", fmt.Errorf("read config: %w", err)
	}
	doc := map[string]any{}
	if err := toml.Unmarshal(raw, &doc); err != nil {
		return nil, "", fmt.Errorf("parse config: %w", err)
	}
	projects, err := tableList(doc, "projects")
	if err != nil {
		return nil, "", err
	}
	for _, p := range projects {
		platforms, err := tableList(p, "platforms")
		if err != nil {
			return nil, "", err
		}
		hit := false
		for _, pl := range platforms {
			t, _ := pl["type"].(string)
			if !containsString(types, t) {
				continue
			}
			was, _ := pl["disabled"].(bool)
			if was == disabled {
				continue
			}
			if disabled {
				pl["disabled"] = true
			} else {
				delete(pl, "disabled")
			}
			hit = true
		}
		if hit {
			p["platforms"] = platforms
			name, _ := p["name"].(string)
			changed = append(changed, name)
		}
	}
	if len(changed) == 0 {
		return nil, "", nil
	}
	doc["projects"] = projects
	backup = backupPath(ConfigPath, time.Now())
	if err := atomicWrite(backup, raw, 0o600); err != nil {
		return nil, "", fmt.Errorf("backup config: %w", err)
	}
	return changed, backup, saveConfig(doc)
}
