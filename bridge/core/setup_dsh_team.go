package core

// DSH-native members in the gate's team file: the gate knows a member only by its key in gate-team.json
// (contrib/gate/lead.py state / identity / playbook), and a DSH member asks /context with bot=dsh:<member id>
// (dsh/collab/gate-context.mjs). So each imported member is written into the file the wizard writes
// (gateTeamJSON, same fields: name, aliases, id, workspace) with kind "dsh", keyed "dsh-<id>" so it never
// clashes with a wizard project key (lead.member finds it by id). kind "dsh" keeps it out of the gate's
// Discord routing (gate.py SUBS/NAMES). With no team file (only DSH is set up) a new one is made with the
// first member as the lead, so the gate does not fall back to team.example.json. The bridge wizard rewrites
// the file whole; keepDSHGateTeamEntries puts the kind "dsh" entries back.

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// dshTeamMember is a member's gate-team.json entry, as gateTeamJSON writes one.
func dshTeamMember(dataDir string, m DSHImportedMember) map[string]any {
	return map[string]any{"name": m.Name, "aliases": []string{m.ID}, "id": m.ID, "workspace": filepath.Join(dataDir, "roles", m.ID), "kind": "dsh"}
}

func isDSHEntry(v any) bool {
	m, ok := v.(map[string]any)
	return ok && m["kind"] == "dsh"
}

// keepDSHGateTeamEntries copies the kind "dsh" entries of the team file at path (if any) into gt, the file
// the bridge wizard is about to write: subs not already keyed in gt are added; a DSH lead stays lead when gt
// has none, otherwise it goes in as a sub "dsh-<id>".
func keepDSHGateTeamEntries(path string, gt map[string]any) {
	b, err := os.ReadFile(path)
	if err != nil {
		return
	}
	var old map[string]any
	if json.Unmarshal(b, &old) != nil {
		return
	}
	subs, _ := gt["subs"].(map[string]any)
	if subs == nil {
		subs = map[string]any{}
	}
	if l := old["lead"]; isDSHEntry(l) {
		if gt["lead"] == nil {
			gt["lead"] = l
		} else if id, _ := l.(map[string]any)["id"].(string); id != "" && subs["dsh-"+id] == nil {
			subs["dsh-"+id] = l
		}
	}
	oldSubs, _ := old["subs"].(map[string]any)
	for k, v := range oldSubs {
		if isDSHEntry(v) && subs[k] == nil {
			subs[k] = v
		}
	}
	gt["subs"] = subs
}

// addDSHMembersToGateTeam adds the imported members (those with an id) to <data_dir>/gate-team.json as
// "dsh-<id>"; DSH members already there (by id) are left as they are. changed = the file was written.
func addDSHMembersToGateTeam(dataDir string, members []DSHImportedMember) (changed bool, err error) {
	if dataDir == "" {
		return false, nil
	}
	path := filepath.Join(dataDir, gateTeamFile)
	var gt map[string]any
	if b, err := os.ReadFile(path); err == nil {
		if err := json.Unmarshal(b, &gt); err != nil {
			return false, err
		}
	} else if !os.IsNotExist(err) {
		return false, err
	}
	known := map[string]bool{}
	subs, _ := gt["subs"].(map[string]any)
	if subs == nil {
		subs = map[string]any{}
	}
	// ids of the DSH entries already in the file (a Discord bot's id is another name space)
	if l, ok := gt["lead"].(map[string]any); ok && isDSHEntry(l) {
		if id, _ := l["id"].(string); id != "" {
			known[id] = true
		}
	}
	for _, v := range subs {
		if s, ok := v.(map[string]any); ok && isDSHEntry(s) {
			if id, _ := s["id"].(string); id != "" {
				known[id] = true
			}
		}
	}
	for _, m := range members {
		if m.ID == "" || m.ID != filepath.Base(m.ID) || m.ID == "." || m.ID == ".." || known[m.ID] {
			continue
		}
		known[m.ID] = true
		if gt == nil {
			gt = map[string]any{"lead": dshTeamMember(dataDir, m)}
		} else {
			subs["dsh-"+m.ID] = dshTeamMember(dataDir, m)
		}
		changed = true
	}
	if !changed {
		return false, nil
	}
	gt["subs"] = subs
	return true, writeJSONFile(path, gt, 0o644)
}

// registerDSHMembersInGateTeam writes the members into the team file and restarts the gate this process
// runs (it reads the file only at startup).
func registerDSHMembersInGateTeam(dataDir string, members []DSHImportedMember) error {
	changed, err := addDSHMembersToGateTeam(dataDir, members)
	if err != nil || !changed {
		return err
	}
	if g := activeGateFor(dataDir); g != nil {
		g.Reload(true)
	}
	return nil
}
