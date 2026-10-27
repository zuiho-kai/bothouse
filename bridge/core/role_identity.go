package core

import (
	"fmt"
	"strings"
)

// AgentDisplayName uses the same names as the setup CLI picker.
func AgentDisplayName(agent string) string {
	for _, spec := range cliSpecs {
		if spec.agentType == agent {
			return spec.label
		}
	}
	return agent
}

// NextRoleName picks the first available display name; project IDs remain stable.
func NextRoleName(base string, used []string) string {
	taken := map[string]bool{}
	for _, name := range used {
		taken[strings.ToLower(name)] = true
	}
	name := base
	for n := 2; taken[strings.ToLower(name)]; n++ {
		name = fmt.Sprintf("%s-%d", base, n)
	}
	return name
}

// RenamePersonaIdentity rewrites only the identity references in a persona
// text. A blanket replace corrupts ordinary prose such as 「橘色长发」,
// 「女仆长制服」 or 「一只渡鸦」 when the persona name is also a common word.
func RenamePersonaIdentity(text, oldName, newName string) string {
	if oldName == "" || oldName == newName {
		return text
	}
	for _, pair := range [][2]string{
		{"「" + oldName + "」", "「" + newName + "」"},
		{`"` + oldName + `"`, `"` + newName + `"`},
		{"“" + oldName + "”", "“" + newName + "”"},
		{"# 角色：" + oldName, "# 角色：" + newName},
		{"# Character: " + oldName, "# Character: " + newName},
	} {
		text = strings.ReplaceAll(text, pair[0], pair[1])
	}
	return text
}
