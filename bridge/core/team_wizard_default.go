package core

import "path/filepath"

// WizardTeamDefaults is the team status setup a team made by the setup wizard runs
// with when config.toml has no team_status_dir (#587). The wizard records the team in
// <data_dir>/conest-setup.json but writes no team_status_dir / team_status_inject, so without
// these defaults its lead never gets the team board or workspaces. A single role is a team of one:
// it is its lead, so it gets the board and the workspaces too.
//
// ok is false — and the project keeps running without team status, as before — unless project is
// one of the roles in the recorded Discord / Feishu team or cloud_web team, and — when it is
// in both teams — both teams have the same lead. A role alone in its team gets no defaults while
// the other team has two or more roles and not this one. dir is
// <data_dir>/team, name the role's name from the wizard, and lead reports whether project is that
// team's fallback role (the wizard's default: the first role), which the team status code treats
// as the configured lead (team_status_inject) until lead.json names another.
func WizardTeamDefaults(dataDir, project string) (dir, name string, lead, ok bool) {
	if dataDir == "" || project == "" {
		return "", "", false, false
	}
	s := LoadSetupState(dataDir)
	teams := []struct {
		members  []SetupTeamEntry
		fallback string
	}{{s.Team, s.FallbackRole}, {s.CloudWebTeam, s.CloudWebFallback}}
	// A single role is its team's lead only while the other wizard team is empty or holds it too:
	// next to another team of two or more roles that has not got it, it would be a second lead in
	// the same <data_dir>/team, so it keeps the pre-wizard behaviour.
	for i, team := range teams {
		if len(team.members) == 1 && team.members[0].Project == project {
			other := teams[1-i].members
			if len(other) >= 2 && !teamHas(other, project) {
				return "", "", false, false
			}
		}
	}
	found, foundFallback := false, ""
	for _, team := range teams {
		if len(team.members) == 0 {
			continue
		}
		for _, m := range team.members {
			if m.Project != project {
				continue
			}
			fallback := team.fallback
			if fallback == "" {
				fallback = team.members[0].Project
			}
			if found {
				// The project is in both wizard teams. The defaults apply to the whole project, so
				// they are only safe when both teams have the same lead; otherwise keep the
				// pre-wizard behaviour (no team status).
				if fallback != foundFallback {
					return "", "", false, false
				}
				break
			}
			found, foundFallback = true, fallback
			dir, name, lead = filepath.Join(dataDir, "team"), m.Name, project == fallback
			break
		}
	}
	if !found {
		return "", "", false, false
	}
	return dir, name, lead, true
}

func teamHas(team []SetupTeamEntry, project string) bool {
	for _, m := range team {
		if m.Project == project {
			return true
		}
	}
	return false
}
