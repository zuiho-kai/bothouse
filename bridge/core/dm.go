package core

import (
	"fmt"
	"strings"
)

// dmUser is the person `bothouse send --dm` writes to: the first explicit ID in
// admin_from, i.e. the project owner already configured there. No new config key; "*"
// names no one.
func (e *Engine) dmUser() string {
	e.userRolesMu.RLock()
	af := e.adminFrom
	e.userRolesMu.RUnlock()
	for _, id := range strings.Split(af, ",") {
		if id = strings.TrimSpace(id); id != "" && id != "*" {
			return id
		}
	}
	return ""
}

// isDMOwner reports whether userID is named explicitly in admin_from (the DM owner is the
// first such ID). Unlike isAdmin, "*" grants nothing: a wildcard would let anyone who can
// DM the bot bypass the gate.
func (e *Engine) isDMOwner(userID string) bool {
	if userID == "" {
		return false
	}
	e.userRolesMu.RLock()
	af := e.adminFrom
	e.userRolesMu.RUnlock()
	for _, id := range strings.Split(af, ",") {
		if id = strings.TrimSpace(id); id != "" && id != "*" && strings.EqualFold(id, userID) {
			return true
		}
	}
	return false
}

// OpenDMSession opens (or reuses) the private chat between this bot and the user named by
// admin_from on the first platform that supports it, and returns its session key. Sending to
// that key then goes through the normal send path (ReconstructReplyCtx), and the user's reply
// in the chat lands in the same session.
func (e *Engine) OpenDMSession() (string, error) {
	user := e.dmUser()
	if user == "" {
		return "", fmt.Errorf("--dm: admin_from has no user ID to message")
	}
	for _, p := range e.platforms {
		if o, ok := p.(DirectMessageOpener); ok {
			return o.OpenDM(user)
		}
	}
	return "", fmt.Errorf("--dm: no platform in this project can open a private chat")
}
