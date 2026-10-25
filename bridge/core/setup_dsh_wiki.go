package core

// DSH-native members get a role wiki too, as the bridge roles do in applyRoleWikis (rolewiki.go): the same programs,
// the same bots.json entry and setup_wiki.py run, in <data_dir>/roles/<project> as the wizard lays roles out. The
// project is the member id the collab plugin will give the member (dsh/collab/roster.mjs newId), so bots.json, the
// gate's bot=<member id> and the member line up. A wiki that cannot be made is reported; the member is added anyway.

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// DSHMemberWiki is one DSH member's wiki step in DSHConfigureResult.
type DSHMemberWiki struct {
	Name  string `json:"name"`
	ID    string `json:"id"`
	Wiki  string `json:"wiki,omitempty"`
	Error string `json:"error,omitempty"`
}

var dshIDClean, dshIDStart = regexp.MustCompile(`[^a-z0-9_-]+`), regexp.MustCompile(`^[a-z0-9]`)

// dshMemberID mirrors dsh/collab/roster.mjs newId for a free slug: lowercase, runs of other characters become "-",
// trimmed, 24 characters, starting with a-z/0-9. "" = the plugin picks a random m-xxxxxx id.
func dshMemberID(name string) string {
	s := strings.Trim(dshIDClean.ReplaceAllString(strings.ToLower(name), "-"), "-")
	if len(s) > 24 {
		s = s[:24]
	}
	if s == "" || !dshIDStart.MatchString(s) {
		return ""
	}
	return s
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

// addDSHMemberWikis makes each member's wiki. Errors are per member (or for all when the programs are not there).
func addDSHMemberWikis(ctx context.Context, dataDir string, members []DSHMember) []DSHMemberWiki {
	out := make([]DSHMemberWiki, len(members))
	taken := map[string]string{} // project -> member name already in bots.json
	if b, err := os.ReadFile(filepath.Join(RoleWikiDir(dataDir), "bots.json")); err == nil {
		var all map[string]struct {
			Name string `json:"name"`
		}
		if json.Unmarshal(b, &all) == nil {
			for k, v := range all {
				taken[k] = v.Name
			}
		}
	}
	roles := make([]plannedRole, len(members))
	for i, m := range members {
		id := dshMemberID(m.Name)
		base := id
		if base == "" {
			base = fmt.Sprintf("dsh-%d", i+1)
		}
		p := base
		for n := 2; taken[p] != "" && !strings.EqualFold(taken[p], m.Name); n++ { // another role's project: next free name
			p = fmt.Sprintf("%s-%d", base, n)
		}
		taken[p] = m.Name
		out[i] = DSHMemberWiki{Name: m.Name, ID: id}
		r := plannedRole{project: p, workDir: filepath.Join(dataDir, "roles", p)}
		r.Name, r.AgentType = m.Name, dshMemberAgentType(m.CLI)
		roles[i] = r
	}
	fail := func(err error) []DSHMemberWiki {
		for i := range out {
			out[i].Error = err.Error()
		}
		return out
	}
	if len(members) == 0 {
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
		lead = members[0].Name
	}
	env := WizardEnv{DataDir: dataDir}
	s, _, err := prepareRoleWikis(ctx, env, lead, roleWikiConfig(dataDir, roles[0], nil, nil))
	if err != nil {
		return fail(err)
	}
	for i, r := range roles {
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
