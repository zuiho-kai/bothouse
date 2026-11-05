package core

// 接入应用 (#150): one page that answers "which chat apps can this household reach right now".
// Only reads state. Adding or removing a platform stays in the setup wizard (the add-platform
// deep link this page hands out); turning a module off stays `bothouse module disable` (#812),
// so this file has no writer and no second source of truth for config.toml.

import (
	"net/http"
)

// PlatformModule is one row of the 接入应用 page.
//
// State is "enabled" when at least one project has an active section of this type, "disabled"
// when every section is marked disabled, and "not_configured" when config.toml has none.
type PlatformModule struct {
	Name     string   `json:"name"`
	Label    string   `json:"label"`
	State    string   `json:"state"`
	Enabled  []string `json:"enabled,omitempty"`  // projects with an active section
	Disabled []string `json:"disabled,omitempty"` // projects whose sections are all disabled
	// AddPath is the setup wizard's add-platform entry for this module (SetupWizard add mode).
	AddPath string `json:"add_path"`
}

// moduleRowOrder is the order the page lists apps in: the three chat apps the owner named, then
// DSH itself (the shell the plugins load into).
var moduleRowOrder = []string{"qq", "discord", "feishu", "dsh"}

// moduleRowLabels are the display names; QQ and 飞书 are not translated (the wizard shows them
// as-is too, bridge/web/src/pages/Setup/SetupWizard.tsx platform cards).
var moduleRowLabels = map[string]string{
	"qq":      "QQ",
	"discord": "Discord",
	"feishu":  "飞书 / Lark",
	"dsh":     "DSH",
}

// SetPlatformModules wires the read-only module listing to config.ModuleStates (cmd/cc-connect,
// the only package that imports both config and core).
func (m *ManagementServer) SetPlatformModules(fn func() map[string]PlatformModule) {
	m.platformModules = fn
}

// platformModuleRows builds the page's rows: config.toml modules from the callback, plus DSH,
// whose state is the profile's plugin entries (core/setup_dsh_module.go) rather than a section.
func (m *ManagementServer) platformModuleRows() []PlatformModule {
	fromConfig := map[string]PlatformModule{}
	if m.platformModules != nil {
		fromConfig = m.platformModules()
	}
	rows := make([]PlatformModule, 0, len(moduleRowOrder))
	for _, name := range moduleRowOrder {
		row, ok := fromConfig[name]
		if !ok {
			row = PlatformModule{Name: name}
		}
		row.Name = name
		row.Label = moduleRowLabels[name]
		switch {
		case len(row.Enabled) > 0:
			row.State = "enabled"
		case len(row.Disabled) > 0:
			row.State = "disabled"
		default:
			row.State = "not_configured"
		}
		// The wizard takes the module name as its platform parameter (addPlatformMode).
		row.AddPath = "/setup?add=1&platform=" + name
		rows = append(rows, row)
	}
	// DSH is not a config.toml platform: its row is the installed plugin's own state.
	for i := range rows {
		if rows[i].Name != "dsh" {
			continue
		}
		st, err := GetDSHModuleState()
		switch {
		case err != nil || !st.Installed:
			rows[i].State = "not_configured"
		case st.Disabled:
			rows[i].State = "disabled"
		default:
			rows[i].State = "enabled"
		}
		// DSH is configured on its own page (setup wizard's DSH step), not by a platform param.
		rows[i].AddPath = "/setup?add=1&platform=dsh"
	}
	return rows
}

// handleModules answers GET /api/v1/modules with one row per app the panel shows.
func (m *ManagementServer) handleModules(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		mgmtError(w, http.StatusMethodNotAllowed, "GET only")
		return
	}
	rows := m.platformModuleRows()
	configured := 0
	for _, row := range rows {
		if row.State != "not_configured" {
			configured++
		}
	}
	mgmtJSON(w, http.StatusOK, map[string]any{
		"modules": rows,
		// the page's empty state says this instead of drawing four blank cards
		"configured": configured,
	})
}
