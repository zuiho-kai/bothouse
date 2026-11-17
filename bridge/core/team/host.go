// Package team is the team layer of the bridge: the task board file, the workspace exit rules, and
// (step by step, #1627) the team logic that used to be methods on core.Engine.
//
// The package does not import core. What team code needs from the engine it runs in, it asks
// through Host; core implements Host in one file (core/team_host.go), so that file is the whole
// list of what the team layer can reach.
package team

// Host is what the team layer may ask of the engine it runs in. A method is added here only when
// code moved into this package needs it.
type Host interface {
	// InTeam reports whether this engine is a member of a team (team status is configured).
	InTeam() bool
	// IsLead reports whether this engine is the team's lead role right now.
	IsLead() bool
	// IsWorkspaceChat reports whether sessionKey is a team workspace channel.
	IsWorkspaceChat(sessionKey string) bool
	// WorkspaceParent returns the chat channel that owns the workspace channelID.
	WorkspaceParent(channelID string) (parentID string, ok bool)
	// WorksWorkspaceTask reports whether this engine is the role working the task that gave chat
	// channel parent the workspace channelID.
	WorksWorkspaceTask(channelID, parent string) bool
	// RunLeadScript runs the collaboration script name (contrib/lead) for chat and returns its output.
	RunLeadScript(chat, name string, args ...string) ([]byte, error)
}

// Service is the team layer of one engine. It keeps no state of its own yet: every answer comes
// from the Host.
type Service struct {
	host Host
}

// New returns the team layer running on host.
func New(host Host) *Service {
	return &Service{host: host}
}
