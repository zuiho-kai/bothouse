package core

// SupportsRemoteDevelopment reports whether the agent runs CLI turns over SSH.
func SupportsRemoteDevelopment(agentType string) bool {
	return agentType == "zulu" || agentType == "claudecode"
}
