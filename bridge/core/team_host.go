package core

import "github.com/chenhg5/cc-connect/core/team"

// teamHost is the engine as the team layer sees it (team.Host). The team package cannot reach an
// Engine field or method that is not listed here.
type teamHost struct{ e *Engine }

var _ team.Host = teamHost{}

func (h teamHost) InTeam() bool { return h.e != nil && h.e.team != nil && h.e.team.name != "" }

func (h teamHost) IsLead() bool { return h.e.isTeamLead() }

func (h teamHost) IsWorkspaceChat(sessionKey string) bool { return h.e.isTeamWorkspaceChat(sessionKey) }

func (h teamHost) WorkspaceParent(channelID string) (string, bool) {
	return h.e.WorkspaceParent(channelID)
}

func (h teamHost) WorksWorkspaceTask(channelID, parent string) bool {
	return h.e.worksWorkspaceTask(channelID, parent)
}

func (h teamHost) RunLeadScript(chat, name string, args ...string) ([]byte, error) {
	return h.e.runLeadScript(chat, name, args...)
}

// teamLayer returns the team layer (core/team) running on this engine.
func (e *Engine) teamLayer() *team.Service { return team.New(teamHost{e}) }
