// The team rules shared with the Go bridge: team-mode-rules.md and team-exit-rules.json. The one
// copy is bridge/core/team_rules/ (the bridge embeds it from there). An installed plugin has the
// file next to this module (the bridge build and the npm package put it there); a checkout reads
// the bridge copy.
import { existsSync, readFileSync } from 'node:fs';

export function readTeamRulesFile(name) {
  const here = new URL(`./${name}`, import.meta.url);
  const repo = new URL(`../../bridge/core/team_rules/${name}`, import.meta.url);
  return readFileSync(existsSync(here) ? here : repo, 'utf8');
}
