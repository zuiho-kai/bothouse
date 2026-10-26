package core

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// RefreshSetupRoleIdentity keeps wizard-owned records and marked team instructions
// aligned with an explicitly saved project identity. Stable project IDs do not change.
func RefreshSetupRoleIdentity(dataDir string, snapshot WizardSnapshot, project, oldName string) error {
	p, ok := snapshot.project(project)
	if !ok {
		return fmt.Errorf("refresh role identity: project %q not found", project)
	}
	name := p.DisplayName
	if name == "" {
		name = p.Name
	}
	if oldName == "" {
		oldName = p.Name
	}
	statePath := filepath.Join(dataDir, setupStateFile)
	var state SetupState
	raw, err := os.ReadFile(statePath)
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("read setup identity: %w", err)
	}
	if err == nil {
		if err := json.Unmarshal(raw, &state); err != nil {
			return fmt.Errorf("parse setup identity: %w", err)
		}
	}
	changed, cloudChanged := false, false
	for _, team := range [][]SetupTeamEntry{state.Team, state.CloudWebTeam} {
		for i := range team {
			if team[i].Project == project {
				team[i].Name, team[i].AgentType = name, p.AgentType
				changed = true
			}
		}
	}
	for _, member := range state.CloudWebTeam {
		cloudChanged = cloudChanged || member.Project == project
	}
	for _, member := range snapshot.Projects {
		path := PersonaFilePath(member.AgentType, member.WorkDir)
		if member.WorkDir == "" {
			continue
		}
		content, err := os.ReadFile(path)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return fmt.Errorf("read role instructions for %s: %w", member.Name, err)
		}
		text := string(content)
		if member.Name == project {
			text = RenamePersonaIdentity(text, oldName, name)
		}
		if cloudChanged && len(state.CloudWebTeam) > 1 && strings.Contains(text, teamMarker) {
			for _, teammate := range state.CloudWebTeam {
				if teammate.Project != member.Name {
					continue
				}
				lang := state.Language
				if reply, _ := PersonaReplyLanguage(text); reply != "" {
					lang = reply
				}
				text = WithTeam(text, cloudWebTeamLine(lang, state.CloudWebTeam, state.CloudWebFallback, member.Name))
			}
		}
		if text != string(content) {
			if err := AtomicWriteFile(path, []byte(text), 0o644); err != nil {
				return fmt.Errorf("update role instructions for %s: %w", member.Name, err)
			}
		}
	}
	if !changed {
		return nil
	}
	state.UpdatedAt = time.Now().Format(time.RFC3339)
	if err := writeJSONFile(statePath, state, 0o644); err != nil {
		return fmt.Errorf("update setup identity: %w", err)
	}
	gatePath := filepath.Join(dataDir, gateTeamFile)
	var gate map[string]any
	raw, err = os.ReadFile(gatePath)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read gate identity: %w", err)
	}
	if err := json.Unmarshal(raw, &gate); err != nil {
		return fmt.Errorf("parse gate identity: %w", err)
	}
	if subs, ok := gate["subs"].(map[string]any); ok {
		if sub, ok := subs[project].(map[string]any); ok {
			sub["name"] = name
		}
	}
	if lead, ok := gate["lead"].(map[string]any); ok {
		if aliases, ok := lead["aliases"].([]any); ok {
			for _, alias := range aliases {
				if alias == project {
					lead["name"] = name
				}
			}
		}
	}
	if err := writeJSONFile(gatePath, gate, 0o644); err != nil {
		return fmt.Errorf("update gate identity: %w", err)
	}
	return nil
}
