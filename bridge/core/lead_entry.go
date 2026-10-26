package core

// Config-driven lead entry (#462). The deployment's existing switch script changes
// config.toml (team_status_inject) and gate-team.json, then restarts the bridge. That made
// each engine's configured lead change, but it never wrote the shared lead.json the bridge,
// the gate and DSH read. This file normalizes that explicit config choice into lead.json.
//
// It deliberately does not store a second handoff record: #458's observer watches
// lead.json and builds the persisted task handoff from the existing task/workspace/[ask]
// files. With no lead.json yet, the first run records the current configured lead with
// auto:true and no "at" (not a switch). A later configured-lead change while auto:true is a
// real switch: write the new lead with an "at" timestamp so the observer can tell it apart.
// A lead.json written by the gate, DSH or `handoff switch` has no auto flag and always wins.

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const leadEntryFileName = "lead.json"

// LeadCandidate is one project's config.toml lead flag. Exactly one Lead=true is the
// configured primary role; none or several is ambiguous and changes nothing.
type LeadCandidate struct {
	Project string
	Name    string
	Lead    bool
}

type leadEntryFile struct {
	Lead string `json:"lead"`
	Name string `json:"name,omitempty"`
	At   string `json:"at,omitempty"`
	Auto bool   `json:"auto,omitempty"`
}

func configuredLead(candidates []LeadCandidate) (LeadCandidate, bool) {
	var out LeadCandidate
	found := 0
	for _, c := range candidates {
		if c.Project == "" || !c.Lead {
			continue
		}
		out = c
		found++
	}
	return out, found == 1
}

// SeedConfiguredLead writes the configured lead into <data_dir>/lead.json when the file is
// absent, and follows later config-driven changes only while the existing selection is
// auto:true. Explicit selections from the gate (`lead me`), DSH or `handoff switch` are
// never overwritten. Existing invalid files are left untouched and reported.
func SeedConfiguredLead(dataDir string, candidates []LeadCandidate) error {
	if dataDir == "" {
		return nil
	}
	cand, ok := configuredLead(candidates)
	if !ok {
		return nil
	}
	path := filepath.Join(dataDir, leadEntryFileName)
	b, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("lead entry: read %s: %w", path, err)
	}
	if os.IsNotExist(err) {
		// First run on a legacy team: record the current lead as the baseline. at stays
		// empty, so neither the gate identity note nor #458 treats it as a user switch.
		return writeLeadEntry(path, leadEntryFile{Lead: cand.Project, Name: cand.Name, Auto: true})
	}
	var cur leadEntryFile
	if err := json.Unmarshal(b, &cur); err != nil {
		return fmt.Errorf("lead entry: %s is not valid JSON; left unchanged: %w", path, err)
	}
	cur.Lead = strings.TrimSpace(cur.Lead)
	if cur.Lead == "" {
		return fmt.Errorf("lead entry: %s has no lead; left unchanged", path)
	}
	if !cur.Auto {
		return nil // explicit selection wins over config
	}
	if cur.Lead == cand.Project {
		return nil
	}
	return writeLeadEntry(path, leadEntryFile{
		Lead: cand.Project,
		Name: cand.Name,
		At:   time.Now().UTC().Format(time.RFC3339),
		Auto: true,
	})
}

func writeLeadEntry(path string, v leadEntryFile) error {
	b, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("lead entry: encode: %w", err)
	}
	if err := AtomicWriteFile(path, b, 0o600); err != nil {
		return fmt.Errorf("lead entry: write %s: %w", path, err)
	}
	return nil
}
