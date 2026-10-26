package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func readLeadEntry(t *testing.T, dir string) leadEntryFile {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(dir, leadEntryFileName))
	if err != nil {
		t.Fatal(err)
	}
	var v leadEntryFile
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestSeedConfiguredLeadFirstRunThenSwitch(t *testing.T) {
	dir := t.TempDir()
	old := []LeadCandidate{{Project: "gge", Name: "G哥", Lead: true}, {Project: "deep", Name: "肥鱼"}}
	if err := SeedConfiguredLead(dir, old); err != nil {
		t.Fatal(err)
	}
	got := readLeadEntry(t, dir)
	if got.Lead != "gge" || got.Name != "G哥" || !got.Auto || got.At != "" {
		t.Fatalf("first seed = %+v", got)
	}

	// The old switch script changes config.toml and restarts: the configured lead is
	// now deep. The auto baseline may follow, with an at timestamp for the handoff
	// observer to treat it as a switch.
	next := []LeadCandidate{{Project: "gge", Name: "G哥"}, {Project: "deep", Name: "肥鱼", Lead: true}}
	if err := SeedConfiguredLead(dir, next); err != nil {
		t.Fatal(err)
	}
	got = readLeadEntry(t, dir)
	if got.Lead != "deep" || got.Name != "肥鱼" || !got.Auto || got.At == "" {
		t.Fatalf("config switch = %+v", got)
	}
	if _, err := time.Parse(time.RFC3339, got.At); err != nil {
		t.Fatalf("at is not RFC3339: %q", got.At)
	}
}

func TestSeedConfiguredLeadExplicitSelectionWins(t *testing.T) {
	dir := t.TempDir()
	explicit := leadEntryFile{Lead: "cjiang", Name: "C酱"}
	b, _ := json.Marshal(explicit)
	if err := os.WriteFile(filepath.Join(dir, leadEntryFileName), b, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := SeedConfiguredLead(dir, []LeadCandidate{{Project: "deep", Name: "肥鱼", Lead: true}}); err != nil {
		t.Fatal(err)
	}
	got := readLeadEntry(t, dir)
	if got.Lead != "cjiang" || got.Auto {
		t.Fatalf("explicit selection overwritten: %+v", got)
	}
}

func TestSeedConfiguredLeadAmbiguousDoesNothing(t *testing.T) {
	dir := t.TempDir()
	for _, cs := range [][]LeadCandidate{
		{{Project: "a", Lead: true}, {Project: "b", Lead: true}},
		{{Project: "a"}, {Project: "b"}},
	} {
		if err := SeedConfiguredLead(dir, cs); err != nil {
			t.Fatal(err)
		}
		if _, err := os.Stat(filepath.Join(dir, leadEntryFileName)); !os.IsNotExist(err) {
			t.Fatalf("ambiguous candidates wrote lead.json: %v", err)
		}
	}
}

func TestSeedConfiguredLeadKeepsInvalidFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, leadEntryFileName)
	if err := os.WriteFile(path, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	err := SeedConfiguredLead(dir, []LeadCandidate{{Project: "deep", Lead: true}})
	if err == nil || !strings.Contains(err.Error(), "left unchanged") {
		t.Fatalf("invalid file error = %v", err)
	}
	b, _ := os.ReadFile(path)
	if string(b) != "{not json" {
		t.Fatalf("invalid file changed: %q", b)
	}
}

// The persisted file uses the same keys the gate's lead.py and #458's
// readLeadSelectionFull read, including the auto flag that keeps a first-run
// baseline from being announced as a user switch.
func TestLeadEntryFileShape(t *testing.T) {
	dir := t.TempDir()
	if err := SeedConfiguredLead(dir, []LeadCandidate{{Project: "gge", Name: "G哥", Lead: true}}); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(filepath.Join(dir, leadEntryFileName))
	var raw map[string]any
	if err := json.Unmarshal(b, &raw); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"lead", "name", "auto"} {
		if _, ok := raw[k]; !ok {
			t.Fatalf("lead.json missing %q: %s", k, b)
		}
	}
	if _, ok := raw["at"]; ok {
		t.Fatalf("first-run baseline has at: %s", b)
	}
}

// A config-driven switch written by the old switch script (config.toml changes, then a
// restart) reaches #458's observer as a real handoff: the first run is only a baseline,
// the next configured lead becomes a pending handoff from the old one.
func TestConfiguredLeadSwitchReachesLeadHandoff(t *testing.T) {
	dir := t.TempDir()
	first := []LeadCandidate{{Project: "gge", Name: "G哥", Lead: true}, {Project: "deep", Name: "肥鱼"}}
	if err := SeedConfiguredLead(dir, first); err != nil {
		t.Fatal(err)
	}
	observer := &Engine{dataDir: dir, name: "gge"}
	if h := observer.observeLeadSelection(); h != nil {
		t.Fatalf("first baseline announced a handoff: %+v", h)
	}

	next := []LeadCandidate{{Project: "gge", Name: "G哥"}, {Project: "deep", Name: "肥鱼", Lead: true}}
	if err := SeedConfiguredLead(dir, next); err != nil {
		t.Fatal(err)
	}
	h := observer.observeLeadSelection()
	if h == nil || h.From != "gge" || h.To != "deep" || h.Status != LeadHandoffPending {
		t.Fatalf("config switch handoff = %+v", h)
	}
	st, err := ReadLeadHandoffState(dir)
	if err != nil {
		t.Fatal(err)
	}
	if st.Pending == nil || st.Pending.ID != h.ID || st.Lead != "deep" {
		t.Fatalf("persisted handoff state = %+v", st)
	}
}
