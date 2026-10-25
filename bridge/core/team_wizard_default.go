package core

import "path/filepath"

// WizardTeamDefaults is the team status setup a multi-role team made by the setup wizard runs
// with when config.toml has no team_status_dir (#587). The wizard records the team in
// <data_dir>/conest-setup.json but writes no team_status_dir / team_status_inject, so without
// these defaults its lead never gets the team board or workspaces.
//
// ok is false — and the project keeps running without team status, as before — unless project is
// one of at least two roles in the recorded Discord team or cloud_web team. dir is
// <data_dir>/team, name the role's name from the wizard, and lead reports whether project is that
// team's fallback role (the wizard's default: the first role), which the team status code treats
// as the configured lead (team_status_inject) until lead.json names another.
func WizardTeamDefaults(dataDir, project string) (dir, name string, lead, ok bool) {
	if dataDir == "" || project == "" {
		return "", "", false, false
	}
	s := LoadSetupState(dataDir)
	for _, team := range []struct {
		members  []SetupTeamEntry
		fallback string
	}{{s.Team, s.FallbackRole}, {s.CloudWebTeam, s.CloudWebFallback}} {
		if len(team.members) < 2 {
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
			return filepath.Join(dataDir, "team"), m.Name, project == fallback, true
		}
	}
	return "", "", false, false
}
