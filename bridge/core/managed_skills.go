package core

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

var managedSkillName = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

type managedSkillRecord struct {
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	Owner       string          `json:"owner,omitempty"`
	Learned     bool            `json:"learned,omitempty"`
	Version     int             `json:"version"`
	Enabled     map[string]bool `json:"enabled"`
	Uses        map[string]int  `json:"uses,omitempty"`
	UpdatedAt   time.Time       `json:"updated_at"`
}

type managedSkillState struct {
	Skills map[string]managedSkillRecord `json:"skills"`
}

type managedSkill struct {
	managedSkillRecord
	Body string `json:"body,omitempty"`
}

func managedSkillsDir(dataDir string) string { return filepath.Join(dataDir, "skills") }

// ManagedSkillViewDir is the role-specific project skill root consumed by bridge and CLI adapters.
func ManagedSkillViewDir(dataDir, project string) string {
	return filepath.Join(managedSkillsDir(dataDir), "views", project)
}

func readManagedSkillState(dataDir string) (managedSkillState, error) {
	state := managedSkillState{Skills: map[string]managedSkillRecord{}}
	raw, err := os.ReadFile(filepath.Join(managedSkillsDir(dataDir), "state.json"))
	if errors.Is(err, os.ErrNotExist) {
		return state, nil
	}
	if err != nil {
		return state, err
	}
	if err := json.Unmarshal(raw, &state); err != nil {
		return state, fmt.Errorf("decode managed skills state: %w", err)
	}
	if state.Skills == nil {
		state.Skills = map[string]managedSkillRecord{}
	}
	return state, nil
}

func writeManagedSkillState(dataDir string, state managedSkillState) error {
	if err := os.MkdirAll(managedSkillsDir(dataDir), 0o700); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	return AtomicWriteFile(filepath.Join(managedSkillsDir(dataDir), "state.json"), append(raw, '\n'), 0o600)
}

func readManagedSkill(dataDir, name string, state managedSkillRecord) (managedSkill, error) {
	if !managedSkillName.MatchString(name) || state.Name != name {
		return managedSkill{}, os.ErrNotExist
	}
	path := filepath.Join(managedSkillsDir(dataDir), "library", name, "SKILL.md")
	raw, err := os.ReadFile(path)
	if err != nil {
		return managedSkill{}, err
	}
	parsed := parseSkillMD(name, string(raw), filepath.Dir(path))
	if parsed == nil {
		return managedSkill{}, fmt.Errorf("managed skill %q is invalid", name)
	}
	state.Description = parsed.Description
	return managedSkill{managedSkillRecord: state, Body: string(raw)}, nil
}

func writeManagedSkill(dataDir, project, name, owner, body string, approve bool) (managedSkillRecord, error) {
	if !managedSkillName.MatchString(name) || strings.TrimSpace(project) != project || project == "" {
		return managedSkillRecord{}, errors.New("invalid skill name or project")
	}
	parsed := parseSkillMD(name, body, "managed")
	if parsed == nil {
		return managedSkillRecord{}, errors.New("skill body is empty")
	}
	root := managedSkillsDir(dataDir)
	state, err := readManagedSkillState(dataDir)
	if err != nil {
		return managedSkillRecord{}, err
	}
	if !approve {
		pendingDir := filepath.Join(root, "pending", project)
		if err := os.MkdirAll(pendingDir, 0o700); err != nil {
			return managedSkillRecord{}, err
		}
		if err := AtomicWriteFile(filepath.Join(pendingDir, name+".md"), []byte(body), 0o600); err != nil {
			return managedSkillRecord{}, err
		}
		return managedSkillRecord{Name: name, Description: parsed.Description, Owner: project, UpdatedAt: time.Now()}, nil
	}
	previous := state.Skills[name]
	version := previous.Version + 1
	if version == 1 {
		version = 1
	}
	skillDir := filepath.Join(root, "library", name)
	versionDir := filepath.Join(skillDir, "versions", fmt.Sprintf("%d", version))
	if err := os.MkdirAll(versionDir, 0o700); err != nil {
		return managedSkillRecord{}, err
	}
	if err := AtomicWriteFile(filepath.Join(versionDir, "SKILL.md"), []byte(body), 0o600); err != nil {
		return managedSkillRecord{}, err
	}
	if err := AtomicWriteFile(filepath.Join(skillDir, "SKILL.md"), []byte(body), 0o600); err != nil {
		return managedSkillRecord{}, err
	}
	if previous.Enabled == nil {
		previous.Enabled = map[string]bool{}
	}
	previous.Enabled[project] = true
	previous.Name, previous.Description, previous.Version = name, parsed.Description, version
	if previous.Owner == "" {
		previous.Owner = owner
	}
	previous.Learned = owner != "" && owner != "recommended"
	previous.UpdatedAt = time.Now()
	state.Skills[name] = previous
	if err := writeManagedSkillState(dataDir, state); err != nil {
		return managedSkillRecord{}, err
	}
	for role, enabled := range previous.Enabled {
		if enabled {
			if err := refreshManagedSkillView(dataDir, role, state); err != nil {
				return managedSkillRecord{}, err
			}
		}
	}
	return previous, nil
}

func approvePendingSkill(dataDir, project, name string) (managedSkillRecord, error) {
	if !managedSkillName.MatchString(name) || project == "" || filepath.Base(project) != project {
		return managedSkillRecord{}, errors.New("invalid skill name or project")
	}
	pending := filepath.Join(managedSkillsDir(dataDir), "pending", project, name+".md")
	body, err := os.ReadFile(pending)
	if err != nil {
		return managedSkillRecord{}, err
	}
	record, err := writeManagedSkill(dataDir, project, name, project, string(body), true)
	if err != nil {
		return managedSkillRecord{}, err
	}
	if err := os.Remove(pending); err != nil {
		return managedSkillRecord{}, err
	}
	return record, nil
}

func setManagedSkillEnabled(dataDir, project, name string, enabled bool) (managedSkillRecord, error) {
	if !managedSkillName.MatchString(name) || project == "" || filepath.Base(project) != project {
		return managedSkillRecord{}, errors.New("invalid skill name or project")
	}
	state, err := readManagedSkillState(dataDir)
	if err != nil {
		return managedSkillRecord{}, err
	}
	record, ok := state.Skills[name]
	if !ok {
		return managedSkillRecord{}, os.ErrNotExist
	}
	if record.Enabled == nil {
		record.Enabled = map[string]bool{}
	}
	record.Enabled[project] = enabled
	record.UpdatedAt = time.Now()
	state.Skills[name] = record
	if err := writeManagedSkillState(dataDir, state); err != nil {
		return managedSkillRecord{}, err
	}
	if err := refreshManagedSkillView(dataDir, project, state); err != nil {
		return managedSkillRecord{}, err
	}
	return record, nil
}

func deleteManagedSkill(dataDir, name string) error {
	if !managedSkillName.MatchString(name) {
		return errors.New("invalid skill name")
	}
	state, err := readManagedSkillState(dataDir)
	if err != nil {
		return err
	}
	record, ok := state.Skills[name]
	if !ok {
		return os.ErrNotExist
	}
	for project := range record.Enabled {
		if err := os.RemoveAll(filepath.Join(ManagedSkillViewDir(dataDir, project), name)); err != nil {
			return err
		}
	}
	if err := os.RemoveAll(filepath.Join(managedSkillsDir(dataDir), "library", name)); err != nil {
		return err
	}
	delete(state.Skills, name)
	return writeManagedSkillState(dataDir, state)
}

func refreshManagedSkillView(dataDir, project string, state managedSkillState) error {
	root := ManagedSkillViewDir(dataDir, project)
	if err := os.MkdirAll(root, 0o700); err != nil {
		return err
	}
	for name, skill := range state.Skills {
		dst := filepath.Join(root, name)
		if !skill.Enabled[project] {
			if err := os.RemoveAll(dst); err != nil {
				return err
			}
			continue
		}
		src := filepath.Join(managedSkillsDir(dataDir), "library", name)
		if _, err := os.Stat(filepath.Join(src, "SKILL.md")); err != nil {
			return fmt.Errorf("managed skill %s: %w", name, err)
		}
		if err := replaceManagedSkillView(dst, src); err != nil {
			return fmt.Errorf("publish skill %s for %s: %w", name, project, err)
		}
	}
	return nil
}

func replaceManagedSkillView(dst, src string) error {
	if err := os.RemoveAll(dst); err != nil {
		return err
	}
	return copySkillBundle(src, dst)
}

func copySkillBundle(src, dst string) error {
	return filepath.WalkDir(src, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		if rel == "versions" && entry.IsDir() {
			return filepath.SkipDir
		}
		out := filepath.Join(dst, rel)
		if entry.IsDir() {
			return os.MkdirAll(out, 0o700)
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return AtomicWriteFile(out, data, info.Mode().Perm())
	})
}

func listManagedSkills(dataDir string) ([]managedSkill, []managedSkillRecord, error) {
	state, err := readManagedSkillState(dataDir)
	if err != nil {
		return nil, nil, err
	}
	active := make([]managedSkill, 0, len(state.Skills))
	for name, record := range state.Skills {
		skill, err := readManagedSkill(dataDir, name, record)
		if err != nil {
			return nil, nil, err
		}
		active = append(active, skill)
		active[len(active)-1].Body = ""
	}
	sort.Slice(active, func(i, j int) bool { return active[i].Name < active[j].Name })
	pending := make([]managedSkillRecord, 0)
	root := filepath.Join(managedSkillsDir(dataDir), "pending")
	projects, _ := os.ReadDir(root)
	for _, project := range projects {
		if !project.IsDir() {
			continue
		}
		entries, _ := os.ReadDir(filepath.Join(root, project.Name()))
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".md") {
				continue
			}
			name := strings.TrimSuffix(entry.Name(), ".md")
			raw, err := os.ReadFile(filepath.Join(root, project.Name(), entry.Name()))
			if err != nil {
				return nil, nil, err
			}
			parsed := parseSkillMD(name, string(raw), "pending")
			if parsed != nil {
				pending = append(pending, managedSkillRecord{Name: name, Description: parsed.Description, Owner: project.Name()})
			}
		}
	}
	sort.Slice(pending, func(i, j int) bool { return pending[i].Name < pending[j].Name })
	return active, pending, nil
}

func recordManagedSkillUseFromView(skillDir string) {
	name := filepath.Base(skillDir)
	project := filepath.Base(filepath.Dir(skillDir))
	dataDir := filepath.Dir(filepath.Dir(filepath.Dir(filepath.Dir(skillDir))))
	if !managedSkillName.MatchString(name) || project == "" || filepath.Base(project) != project {
		return
	}
	state, err := readManagedSkillState(dataDir)
	if err != nil {
		return
	}
	record, ok := state.Skills[name]
	if !ok || !record.Enabled[project] {
		return
	}
	if record.Uses == nil {
		record.Uses = map[string]int{}
	}
	record.Uses[project]++
	state.Skills[name] = record
	_ = writeManagedSkillState(dataDir, state)
}
