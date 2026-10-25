package core

import (
 "fmt"
 "strings"
)

// AgentDisplayName uses the same names as the setup CLI picker.
func AgentDisplayName(agent string) string {
 for _, spec := range cliSpecs { if spec.agentType == agent { return spec.label } }
 return agent
}

// NextRoleName picks the first available display name; project IDs remain stable.
func NextRoleName(base string, used []string) string {
 taken := map[string]bool{}
 for _, name := range used { taken[strings.ToLower(name)] = true }
 name := base
 for n := 2; taken[strings.ToLower(name)]; n++ { name = fmt.Sprintf("%s-%d", base, n) }
 return name
}
