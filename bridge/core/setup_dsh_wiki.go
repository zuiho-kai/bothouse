package core

// DSH-native members get a role wiki too, as the bridge roles do in applyRoleWikis (rolewiki.go): the same programs,
// the same bots.json entry and setup_wiki.py run, in <data_dir>/roles/<member id> as the wizard lays roles out. The
// id is the one the collab plugin gave the member: its importWizard (dsh/collab/roster.mjs) writes each role's id
// into wizard-members.imported.json, and the wikis are made from that file, so bots.json, the gate's
// bot=<member id> and the member line up. A wiki that cannot be made is reported; the member is there anyway.

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"
)

// DSHMemberWiki is one DSH member's wiki step.
type DSHMemberWiki struct {
	Name  string `json:"name"`
	ID    string `json:"id"`
	Wiki  string `json:"wiki,omitempty"`
	Error string `json:"error,omitempty"`
}

// DSHImportedMember is a wizard role after the collab plugin added it: ID is its member id ("" = not added).
type DSHImportedMember struct {
	DSHMember
	ID string `json:"id,omitempty"`
}

// dshImportedFile: wizard-members.json once the plugin has imported it (roster.mjs importWizard).
func dshImportedFile() string { return filepath.Join(collabDataDir(), "wizard-members.imported.json") }

// readDSHImported reads the plugin's imported roles; false = the plugin has not imported them yet.
func readDSHImported() ([]DSHImportedMember, bool) {
	b, err := os.ReadFile(dshImportedFile())
	if err != nil {
		return nil, false
	}
	var f struct {
		Members []DSHImportedMember `json:"members"`
	}
	if json.Unmarshal(b, &f) != nil {
		return nil, false
	}
	return f.Members, true
}

// makeDSHMemberWikisOnImport waits (up to wait) for the plugin, started by `dsh web`, to import the wizard roles
// and give them ids, then makes their wikis. It runs after the wizard's open step, off the request.
func makeDSHMemberWikisOnImport(dataDir string, wait time.Duration) []DSHMemberWiki {
	deadline := time.Now().Add(wait)
	for {
		if members, ok := readDSHImported(); ok {
			out := addDSHMemberWikis(context.Background(), dataDir, members)
			for _, x := range out {
				if x.Error != "" {
					slog.Warn("dsh member wiki not made", "member", x.Name, "id", x.ID, "error", x.Error)
				}
			}
			return out
		}
		if time.Now().After(deadline) {
			slog.Warn("dsh member wikis not made: the collab plugin did not import the wizard roles", "file", dshImportedFile())
			return nil
		}
		time.Sleep(500 * time.Millisecond)
	}
}

// dshMemberAgentType: the wiki engines follow the member's CLI (roleWikiEngines); a DSH-model member is "dsh".
func dshMemberAgentType(cli string) string {
	switch cli {
	case "claude":
		return "claudecode"
	case "codex", "gemini":
		return cli
	}
	return "dsh"
}

// addDSHMemberWikis makes each member's wiki in roles/<member id>. A member without an id (the plugin could not
// add it) gets an error, as do all when the programs are not there. Re-runs keep the existing entries.
func addDSHMemberWikis(ctx context.Context, dataDir string, members []DSHImportedMember) []DSHMemberWiki {
	out := make([]DSHMemberWiki, len(members))
	var roles []plannedRole
	var idx []int
	for i, m := range members {
		out[i] = DSHMemberWiki{Name: m.Name, ID: m.ID}
		if m.ID == "" || m.ID != filepath.Base(m.ID) || m.ID == "." || m.ID == ".." {
			out[i].Error = "the collab plugin gave this role no member id"
			continue
		}
		r := plannedRole{project: m.ID, workDir: filepath.Join(dataDir, "roles", m.ID)}
		r.Name, r.AgentType = m.Name, dshMemberAgentType(m.CLI)
		roles, idx = append(roles, r), append(idx, i)
	}
	if len(roles) == 0 {
		return out
	}
	fail := func(err error) []DSHMemberWiki {
		for _, i := range idx {
			out[i].Error = err.Error()
		}
		return out
	}
	if dataDir == "" {
		return fail(fmt.Errorf("no data directory: the role wikis were not made"))
	}
	if RoleWikiFS == nil {
		return fail(fmt.Errorf("the wiki programs are not built into this binary"))
	}
	lead := dshFallbackLead(dataDir)
	if lead == "" {
		lead = roles[0].Name
	}
	env := WizardEnv{DataDir: dataDir}
	s, _, err := prepareRoleWikis(ctx, env, lead, roleWikiConfig(dataDir, roles[0], nil, nil))
	if err != nil {
		return fail(err)
	}
	for j, r := range roles {
		i := idx[j]
		if err := os.MkdirAll(r.workDir, 0o755); err != nil {
			out[i].Error = err.Error()
			continue
		}
		wiki, err := s.addRole(ctx, r, lead, roleWikiConfig(dataDir, r, nil, nil))
		if err != nil {
			out[i].Error = err.Error()
			continue
		}
		out[i].Wiki = wiki
	}
	return out
}
