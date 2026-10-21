package discord

import (
	"encoding/hex"
	"fmt"
	"strings"
)

func parsePermissionApprovers(value any) ([]string, error) {
	if value == nil {
		return nil, nil
	}
	raw, ok := value.(string)
	if !ok {
		return nil, fmt.Errorf("discord: permission_approvers must be comma-separated bot IDs")
	}
	var ids []string
	seen := map[string]bool{}
	for _, id := range strings.Split(raw, ",") {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		for _, c := range id {
			if c < '0' || c > '9' {
				return nil, fmt.Errorf("discord: permission_approvers requires numeric bot IDs")
			}
		}
		if len(id) > 20 {
			return nil, fmt.Errorf("discord: permission_approvers ID too long")
		}
		if !seen[id] {
			ids = append(ids, id)
			seen[id] = true
		}
	}
	if len(ids) > 10 {
		return nil, fmt.Errorf("discord: at most 10 permission approvers")
	}
	return ids, nil
}

func (p *Platform) CanApprovePermission(userID string) bool {
	for _, id := range p.permissionApprovers {
		if id == userID {
			return true
		}
	}
	return false
}

func (p *Platform) IsPermissionDelegate() bool { return p.CanApprovePermission(p.botID) }

func (p *Platform) PermissionDelegationTargets() (string, string) {
	var targets []string
	for _, id := range p.permissionApprovers {
		if id != p.botID {
			targets = append(targets, "<@"+id+">")
		}
	}
	if len(targets) == 0 || p.botID == "" {
		return "", ""
	}
	return strings.Join(targets, " "), "<@" + p.botID + ">"
}

func parsePermissionDecision(text string) (string, string, bool) {
	f := strings.Fields(text)
	if len(f) != 3 || f[0] != "/permit" || len(f[1]) != 32 || (f[2] != "allow" && f[2] != "deny") {
		return "", "", false
	}
	if _, err := hex.DecodeString(f[1]); err != nil {
		return "", "", false
	}
	return f[1], f[2], true
}
